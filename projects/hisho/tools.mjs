// What an agent can ask hisho to do.
//
// Every handler is (input) => { text, meta } and every call is audited by the
// server, not by the handler, so nothing can be done quietly.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { providerById, readStore, runPrompt } from "../../packages/llm/index.mjs";
import { buildContext } from "./context.mjs";
import { REPO, RETURN_LIMIT, audit, listDir, planTool, readText, run, writeText } from "./security.mjs";

const clip = (text) => {
  const value = String(text ?? "");
  return value.length > RETURN_LIMIT ? `${value.slice(0, RETURN_LIMIT)}\n… truncated` : value;
};

function diffSummary(before, after) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let added = 0;
  let removed = 0;
  const counts = new Map();
  for (const line of oldLines) counts.set(line, (counts.get(line) ?? 0) - 1);
  for (const line of newLines) counts.set(line, (counts.get(line) ?? 0) + 1);
  for (const value of counts.values()) {
    if (value > 0) added += value;
    if (value < 0) removed -= value;
  }
  return `+${added} -${removed} (${oldLines.length} → ${newLines.length} lines)`;
}

export const TOOLS = [
  {
    name: "context",
    description: "The brief: what ayamai is, how it fits, what is running, what is open. Call this first.",
    inputSchema: { type: "object", properties: { taskId: { type: "number" }, question: { type: "string" } } },
    handler: async (input) => ({ text: await buildContext({ taskId: input?.taskId ?? null, question: input?.question ?? "" }) }),
  },
  {
    name: "project.list",
    description: "The catalog: ayamai, gehirn, yoru, seiri, kata, hisho.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const raw = readFileSync(path.join(REPO, "catalog.json"), "utf8");
      const catalog = JSON.parse(raw);
      return { text: catalog.entries.map((entry) => `${entry.id.padEnd(10)} ${String(entry.kind).padEnd(9)} ${entry.summary}`).join("\n") };
    },
  },
  {
    name: "project.status",
    description: "Which services answer right now.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const response = await fetch("http://127.0.0.1:25222/health.json").catch(() => null);
      if (!response?.ok) return { text: "the door is not answering on 25222" };
      const data = await response.json();
      return { text: data.services.map((service) => `${service.up ? "up  " : "DOWN"} ${service.name} :${service.port}${service.ms != null ? ` ${service.ms} ms` : ""}`).join("\n") };
    },
  },
  {
    name: "file.read",
    description: "Read a file in the repo. Use offset/limit for long files.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, offset: { type: "number" }, limit: { type: "number" } }, required: ["path"] },
    handler: async (input) => {
      const read = readText(input.path, { offset: input.offset, limit: input.limit });
      if (!read.ok) return { text: `refused: ${read.error}` };
      return { text: clip(`# ${read.rel} (${read.from}-${read.to} of ${read.lines})\n${read.text}`), meta: { rel: read.rel } };
    },
  },
  {
    name: "file.list",
    description: "List a directory in the repo.",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    handler: async (input) => {
      const listing = listDir(input?.path ?? "");
      if (!listing.ok) return { text: `refused: ${listing.error}` };
      return { text: listing.entries.map((row) => `${row.dir ? "dir " : "file"} ${row.name}${row.dir ? "" : ` (${Math.max(1, Math.round(row.size / 1024))} KB)`}`).join("\n") || "(empty)" };
    },
  },
  {
    name: "search",
    description: "Regex search across repo text files. Capped at 200 hits.",
    inputSchema: { type: "object", properties: { pattern: { type: "string" }, glob: { type: "string" } }, required: ["pattern"] },
    handler: async (input) => {
      const pattern = new RegExp(String(input.pattern ?? ""), "i");
      const hits = [];
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (hits.length >= 200) return;
          if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) { walk(abs); continue; }
          if (!/\.(mjs|js|ts|tsx|json|md|css|sh|yml)$/.test(entry.name)) continue;
          if (statSync(abs).size > 512 * 1024) continue;
          let text = "";
          try { text = readFileSync(abs, "utf8"); } catch { continue; }
          text.split("\n").forEach((line, index) => {
            if (hits.length < 200 && pattern.test(line)) hits.push(`${path.relative(REPO, abs)}:${index + 1}: ${line.trim().slice(0, 160)}`);
          });
        }
      };
      walk(REPO);
      return { text: hits.join("\n") || "no matches", meta: { hits: hits.length } };
    },
  },
  {
    name: "file.write",
    description: "Write a file in the repo. Returns the diff summary.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    handler: async (input) => {
      const written = writeText(input.path, input.content);
      if (!written.ok) return { text: `refused: ${written.error}` };
      return { text: `${written.created ? "created" : "wrote"} ${written.rel} · ${diffSummary(written.before, written.after)}`, meta: { rel: written.rel } };
    },
  },
  {
    name: "idea.capture",
    description: "Capture an idea for later without turning it into plan items.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, project: { type: "string" } }, required: ["text"] },
    handler: async (input) => {
      const text = String(input.text ?? "").trim();
      if (!text) return { text: "refused: an idea needs some text" };
      if (text.length > 2000) return { text: "refused: keep it under 2000 characters" };
      const response = await fetch("http://127.0.0.1:4460/api/ideas", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cockpit": "1" },
        body: JSON.stringify({ action: "capture", text, project: String(input.project ?? ""), mode: "quick" }),
      }).catch(() => null);
      if (!response?.ok) return { text: "failed: seiri is not answering" };
      const data = await response.json();
      return { text: data.ok ? `captured as idea #${data.id}` : `failed: ${data.error}` };
    },
  },
  {
    name: "idea.list",
    description: "Recent ideas and what they became.",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    handler: async (input) => {
      const response = await fetch("http://127.0.0.1:4460/seiri/api/state").catch(() => null);
      if (!response?.ok) return { text: "failed: seiri is not answering" };
      const data = await response.json();
      const limit = Number(input?.limit) > 0 ? Number(input.limit) : 10;
      return { text: (data.ideas?.ideas ?? []).slice(0, limit).map((idea) => `idea #${idea.id} · ${idea.status}${idea.planIds?.length ? ` → ${idea.planIds.map((id) => `#${id}`).join(", ")}` : ""} · ${idea.text.slice(0, 80)}`).join("\n") || "no ideas yet" };
    },
  },
  {
    name: "plan.next",
    description: "Claim the highest-priority open item. Sets it doing and leases it to you.",
    inputSchema: { type: "object", properties: { by: { type: "string" }, project: { type: "string" }, ttl: { type: "string" } }, required: ["by"] },
    handler: async (input) => {
      const args = ["next", "--by", String(input.by)];
      if (input.project) args.push("--project", String(input.project));
      if (input.ttl) args.push("--ttl", String(input.ttl));
      const result = await planTool(args);
      return { text: result.out || result.error };
    },
  },
  {
    name: "plan.claim",
    description: "Claim a specific item by id. Refuses if someone else holds a live lease.",
    inputSchema: { type: "object", properties: { id: { type: "number" }, by: { type: "string" }, ttl: { type: "string" } }, required: ["id", "by"] },
    handler: async (input) => {
      const id = Number(input.id);
      if (!Number.isInteger(id) || id <= 0) return { text: "refused: id must be a positive integer" };
      const args = ["claim", String(id), "--by", String(input.by)];
      if (input.ttl) args.push("--ttl", String(input.ttl));
      const result = await planTool(args);
      return { text: result.out || result.error };
    },
  },
  {
    name: "plan.release",
    description: "Give a claimed item back to the queue.",
    inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
    handler: async (input) => {
      const id = Number(input.id);
      if (!Number.isInteger(id) || id <= 0) return { text: "refused: id must be a positive integer" };
      const result = await planTool(["release", String(id)]);
      return { text: result.out || result.error };
    },
  },
  {
    name: "plan.list",
    description: "Open plan items, optionally filtered by project or status.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, status: { type: "string" } } },
    handler: async (input) => {
      const args = ["list", "--json"];
      if (input?.project) args.push("--project", String(input.project));
      if (input?.status) args.push("--status", String(input.status));
      const result = await planTool(args);
      try {
        const items = JSON.parse(result.out || "[]");
        return { text: items.map((item) => `#${item.id} ${item.status.padEnd(7)} P${item.priority} ${item.project || "-"} — ${item.title}${item.assignee ? ` [${item.assignee}]` : ""}`).join("\n") || "none open" };
      } catch { return { text: result.out || result.error }; }
    },
  },
  {
    name: "plan.done",
    description: "Mark an item done and append your summary to its body.",
    inputSchema: { type: "object", properties: { id: { type: "number" }, summary: { type: "string" } }, required: ["id"] },
    handler: async (input) => {
      const id = Number(input.id);
      if (!Number.isInteger(id)) return { text: "refused: id must be a number" };
      const show = await planTool(["show", String(id), "--json"]);
      let body = "";
      try { body = JSON.parse(show.out)?.body ?? ""; } catch { body = ""; }
      const appended = `${body}${body ? "\n\n" : ""}---\n${input.summary ?? "done"}`;
      const result = await planTool(["set", String(id), "--status", "done", "--body", appended]);
      return { text: result.out || result.error };
    },
  },
  {
    name: "plan.update",
    description: "Change an item's status, priority or project.",
    inputSchema: { type: "object", properties: { id: { type: "number" }, status: { type: "string" }, priority: { type: "number" }, project: { type: "string" } }, required: ["id"] },
    handler: async (input) => {
      const args = ["set", String(Number(input.id))];
      if (input.status) args.push("--status", String(input.status));
      if (input.priority) args.push("--priority", String(Number(input.priority)));
      if (input.project) args.push("--project", String(input.project));
      const result = await planTool(args);
      return { text: result.out || result.error };
    },
  },
  {
    name: "run",
    description: "Run an allowlisted command: test, verify, docs-check, git-status, git-diff, git-log.",
    inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    handler: async (input) => {
      const result = await run(String(input.command));
      if (!result.ok) return { text: `refused: ${result.error}\nallowed: ${result.allowed.join(", ")}` };
      return { text: clip(result.output) };
    },
  },
];

TOOLS.push({
  name: "model.ask",
  description:
    "Ask ayamai's configured model (deepseek by default) using the stored key. The brief is attached unless you pass context:false. Use this when you have no model of your own.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      context: { type: "boolean", description: "attach the project brief (default true)" },
      provider: { type: "string", description: "deepseek, openai, anthropic, openrouter, groq, ollama" },
      maxTokens: { type: "number" },
    },
    required: ["prompt"],
  },
  handler: async (input) => {
    const store = readStore();
    const id = String(input.provider ?? store.active ?? "deepseek");
    const provider = providerById(id);
    if (!provider) return { text: `refused: unknown provider "${id}"` };
    const entry = store.keys?.[id];
    if (provider.keyed && !entry?.apiKey) return { text: `refused: no key for ${id} — add one in gehirn's model console` };
    const asked = String(input.prompt ?? "").trim();
    if (!asked) return { text: "refused: prompt is required" };

    const brief = input.context === false ? "" : `${await buildContext({ question: asked })}\n---\n\n`;
    const result = await runPrompt({
      providerId: id,
      prompt: `${brief}${asked}`,
      model: entry?.model ?? provider.model,
      baseURL: entry?.baseURL ?? provider.baseURL,
      apiKey: entry?.apiKey ?? "",
      temperature: 0.7,
      maxTokens: Number(input.maxTokens) > 0 ? Number(input.maxTokens) : 1024,
    });
    if (!result.ok) return { text: `failed: ${result.error}` };
    const tokens = (result.usage?.prompt ?? 0) + (result.usage?.completion ?? 0);
    return { text: `${result.text}\n\n(${result.model} · ${result.ms} ms · ${tokens} tokens)` };
  },
});

export const RESOURCES = [
  { uri: "ayamai://docs/PRODUCT.md", name: "PRODUCT", file: "docs/PRODUCT.md" },
  { uri: "ayamai://docs/ARCHITECTURE.md", name: "ARCHITECTURE", file: "docs/ARCHITECTURE.md" },
  { uri: "ayamai://docs/OPERATIONS.md", name: "OPERATIONS", file: "docs/OPERATIONS.md" },
  { uri: "ayamai://AGENTS.md", name: "AGENTS", file: "AGENTS.md" },
  { uri: "ayamai://catalog.json", name: "catalog", file: "catalog.json" },
];

export function findTool(name) {
  return TOOLS.find((tool) => tool.name === name);
}

export async function callTool(name, input) {
  const tool = findTool(name);
  if (!tool) return { ok: false, text: `unknown tool "${name}"`, allowed: TOOLS.map((entry) => entry.name) };
  const started = Date.now();
  try {
    const result = await tool.handler(input ?? {});
    // A refusal is an answer, but it is not success.
    const refused = String(result?.text ?? "").startsWith("refused");
    audit({ tool: name, args: Object.keys(input ?? {}), ok: !refused, ms: Date.now() - started, meta: result?.meta ?? null });
    return { ok: !refused, text: result?.text ?? "" };
  } catch (error) {
    audit({ tool: name, args: Object.keys(input ?? {}), ok: false, ms: Date.now() - started, error: String(error?.message ?? error) });
    return { ok: false, text: `failed: ${String(error?.message ?? error)}` };
  }
}
