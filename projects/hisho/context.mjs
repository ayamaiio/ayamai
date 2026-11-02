// The brief an agent arrives with.
//
// Pure rendering so the shape can be tested; gathering the facts is separate and
// may fail without taking the brief down.
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

import { REPO, planTool } from "./security.mjs";
import { loadRegistry } from "../../packages/core/registry.mjs";
import { modeBlock, modeById } from "../../packages/core/modes.mjs";

export const BUDGET = 6000;

const CAPS = { identity: 700, architecture: 900, operations: 700, rules: 700, mode: 260, state: 400, queue: 500, task: 1200 };

function section(name, text, cap) {
  const clean = String(text ?? "")
    // The excerpts carry their own headings; inside the brief they are noise.
    .split("\n").filter((line) => !line.startsWith("#") && line.trim()).join("\n")
    .trim();
  if (!clean) return "";
  const clipped = clean.length > cap * 4 ? `${clean.slice(0, cap * 4)}…` : clean;
  return `## ${name}\n${clipped}`;
}

function readDoc(relative, lines) {
  try { return readFileSync(path.join(REPO, relative), "utf8").split("\n").slice(0, lines).join("\n"); } catch { return ""; }
}

/** Pure: parts in, markdown out, every section capped. */
export function renderContext(parts = {}) {
  const blocks = [
    "# ayamai context",
    `machine: ${parts.hostname ?? "this machine"} · repo: ${REPO}`,
    section("what this is", parts.identity, CAPS.identity),
    section("how it fits", parts.architecture, CAPS.architecture),
    section("running it", parts.operations, CAPS.operations),
    section("rules", parts.rules, CAPS.rules),
    section("mode", parts.mode, CAPS.mode),
    section("now", parts.state, CAPS.state),
    section("open work", parts.queue, CAPS.queue),
    section("your task", parts.task, CAPS.task),
    parts.question ? section("the question", parts.question, 800) : "",
  ].filter(Boolean);
  return blocks.join("\n\n") + "\n";
}

/** Gather the facts. Anything that fails contributes a line, never an exception. */
export async function gather({ taskId = null, question = "", mode = "" } = {}) {
  const listing = await planTool(["list", "--all", "--json"]);
  let items = [];
  try { items = JSON.parse(listing.out || "[]"); } catch { items = []; }

  // The item's own stance wins only when the caller did not name one.
  const asked = String(mode ?? "").trim();
  if (!asked && taskId) {
    const item = items.find((candidate) => String(candidate.id) === String(taskId));
    if (item?.mode) mode = item.mode;
  }

  const open = items.filter((item) => item.status !== "done" && item.status !== "retired");
  const queue = open.slice(0, 10)
    .map((item) => `- #${item.id} P${item.priority} ${item.project || "-"} — ${item.title}${item.assignee ? ` (${item.assignee})` : ""}`)
    .join("\n");

  const task = taskId ? items.find((item) => String(item.id) === String(taskId)) : null;

  // The catalog is the truth about what exists; prose drifts.
  let projects = "";
  try {
    const catalog = JSON.parse(readFileSync(path.join(REPO, "catalog.json"), "utf8"));
    const routes = [];
    for (const project of loadRegistry(REPO).projects) {
      for (const route of project.routes) routes.push([project.id, route.prefix]);
    }
    const orgs = catalog.organizations ?? [];
    projects = catalog.entries.map((entry) => {
      const found = routes.find(([id]) => id === entry.id);
      const port = loadRegistry(REPO).projects.find((p) => p.id === entry.id)?.services?.[0]?.port;
      const org = orgs.find((candidate) => candidate.id === entry.org);
      const owned = org ? `, ${org.id} org by ${org.owner}` : "";
      return `${entry.id} (${entry.kind}${owned})${found ? ` — ${found[1]}${port ? ` on ${port}` : ""}` : ""}: ${entry.summary}`;
    }).join("\n");
  } catch { projects = ""; }

  return {
    hostname: hostname(),
    identity: readDoc("docs/PRODUCT.md", 40),
    architecture: readDoc("docs/ARCHITECTURE.md", 60),
    operations: readDoc("docs/OPERATIONS.md", 50),
    rules: readDoc("AGENTS.md", 45),
    // The stance this agent was asked for; engineering when nobody said.
    mode: modeBlock(modeById(mode)),
    state: [
      `projects: ${projects.replace(/\n/g, " | ")}`,
      `open plan items: ${open.length}`,
      `doing: ${items.filter((item) => item.status === "doing").length}`,
      `blocked: ${items.filter((item) => item.status === "blocked").length}`,
    ].join("\n"),
    queue,
    task: task ? `#${task.id} · P${task.priority} · ${task.project || "-"}${task.mode ? ` · ${task.mode}` : ""} · ${task.title}\n\n${task.body || "(no body)"}` : "",
    question,
  };
}

export async function buildContext(options = {}) {
  const parts = await gather(options);
  return renderContext(parts);
}
