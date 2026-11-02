// The agent: the one local API a tool talks to.
//
//   GET  /agent/capabilities
//   GET  /agent/context
//   POST /agent/task          { intent, input, projectId?, model? } → { id }
//   GET  /agent/task/:id      → { status, result, error }
//
// It is not a chatbot endpoint. Every intent is a named capability, so a tool
// can ask for "run this prompt" or "tell me the state of this project" without
// inventing its own way into the machine.
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { dataRoot, loadRegistry } from "../core/registry.mjs";
import { runPrompt, readStore, publicState } from "../llm/index.mjs";

const PORT = Number(process.env.AGENT_PORT ?? 4491);
const HOST = process.env.AGENT_HOST ?? "127.0.0.1";
const REPO = process.env.AYAMAI_REPO ?? path.resolve(import.meta.dirname, "../..");
const DATA = dataRoot();

/** Intents a tool may ask for. Anything else is refused with the list. */
export const CAPABILITIES = [
  { intent: "llm.prompt", description: "ask the configured model a question", input: "{ prompt, attachContext?, model? }" },
  { intent: "project.status", description: "what is registered and what is running", input: "{}" },
  { intent: "page.capture", description: "store a page the tool is looking at", input: "{ url, title, text }" },
];

export function validateTask(body) {
  const intent = String(body?.intent ?? "");
  const known = CAPABILITIES.find((capability) => capability.intent === intent);
  if (!known) return { ok: false, error: `unknown intent "${intent}"`, capabilities: CAPABILITIES.map((entry) => entry.intent) };
  if (intent === "llm.prompt" && !String(body?.input?.prompt ?? "").trim()) {
    return { ok: false, error: "llm.prompt needs input.prompt" };
  }
  if (intent === "page.capture" && !String(body?.input?.url ?? "").trim()) {
    return { ok: false, error: "page.capture needs input.url" };
  }
  return { ok: true, intent };
}

/** Constant-time-ish comparison, good enough for a loopback token. */
export function tokenMatches(expected, given) {
  const a = String(expected ?? "");
  const b = String(given ?? "");
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function loadToken() {
  mkdirSync(DATA, { recursive: true });
  const file = path.join(DATA, "agent-token");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch { /* first run */ }
  const token = randomUUID();
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
  return token;
}

const TOKEN = loadToken();
const tasks = new Map();

function contextBrief() {
  const { projects, invalid } = loadRegistry(REPO);
  const lines = [`machine: ${process.platform}/${process.arch}`];
  for (const project of projects) {
    const routes = (project.routes ?? []).map((route) => route.prefix).join(",");
    lines.push(`project ${project.id} ${project.version ?? ""} routes=${routes} services=${(project.services ?? []).length}`);
  }
  for (const bad of invalid) lines.push(`broken manifest ${bad.file}: ${bad.errors[0]}`);
  return lines.join("\n");
}

async function execute(task) {
  const input = task.input ?? {};
  if (task.intent === "project.status") {
    const { projects, invalid } = loadRegistry(REPO);
    return { projects: projects.map(({ id, version, routes, services }) => ({ id, version, routes, services: services.map((service) => service.id) })), invalid };
  }
  if (task.intent === "page.capture") {
    const dir = path.join(DATA, "captures");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${task.id}.json`);
    writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), url: input.url, title: input.title ?? "", text: String(input.text ?? "").slice(0, 200_000) }, null, 2), { mode: 0o600 });
    return { saved: file, url: input.url };
  }
  if (task.intent === "llm.prompt") {
    const store = readStore();
    const state = publicState(store);
    const provider = state.active;
    const entry = store.keys?.[provider];
    if (!entry) return { error: `no key for ${provider ?? "any provider"} — add one in the cockpit` };
    const prompt = input.attachContext ? `${contextBrief()}\n\n${input.prompt}` : String(input.prompt);
    const result = await runPrompt({
      providerId: provider,
      prompt,
      model: input.model ?? entry.model,
      baseURL: entry.baseURL,
      apiKey: entry.apiKey,
    });
    return result.ok ? { text: result.text, model: result.model, ms: result.ms, usage: result.usage } : { error: result.message };
  }
  return { error: "nothing ran" };
}

function send(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-ayamai-token",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; if (raw.length > limit) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve(null); } });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") { send(res, 204, {}); return; }

  const token = req.headers["x-ayamai-token"];
  if (!tokenMatches(TOKEN, token)) {
    send(res, 401, { error: "missing or wrong x-ayamai-token", tokenFile: path.join(DATA, "agent-token") });
    return;
  }

  if (req.method === "GET" && url.pathname === "/agent/capabilities") { send(res, 200, { capabilities: CAPABILITIES }); return; }
  if (req.method === "GET" && url.pathname === "/agent/context") { send(res, 200, { context: contextBrief(), llm: publicState() }); return; }

  if (req.method === "POST" && url.pathname === "/agent/task") {
    const body = await readBody(req);
    const checked = validateTask(body);
    if (!checked.ok) { send(res, 400, checked); return; }
    const task = { id: randomUUID(), intent: checked.intent, input: body.input ?? {}, projectId: body.projectId ?? null, status: "running", at: Date.now() };
    tasks.set(task.id, task);
    try {
      task.result = await execute(task);
      task.status = task.result?.error ? "failed" : "done";
    } catch (error) {
      task.status = "failed";
      task.result = { error: String(error?.message ?? error) };
    }
    task.ms = Date.now() - task.at;
    send(res, 202, { id: task.id, status: task.status, result: task.result });
    return;
  }

  const match = url.pathname.match(/^\/agent\/task\/([0-9a-f-]+)$/);
  if (req.method === "GET" && match) {
    const task = tasks.get(match[1]);
    if (!task) { send(res, 404, { error: "no such task" }); return; }
    send(res, 200, task);
    return;
  }

  send(res, 404, { error: "no such route" });
});

/** Open the agent. A direct run calls this; tests only import the rules. */
export function start() {
  server.listen(PORT, HOST, () => {
    console.log(`agent: http://${HOST}:${PORT}  token in ${path.join(DATA, "agent-token")}`);
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) start();
