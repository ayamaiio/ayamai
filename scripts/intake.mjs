#!/usr/bin/env node
// intake - capture a request now, decide what it means later.
//
//   intake add <text>            record a request verbatim
//   intake list [--all]          what is waiting, oldest first
//   intake show <id>             one request, in full
//   intake promote <id> [...]    turn it into a plan issue
//   intake drop <id>             decide not to do it
//
// Storage is an append-only JSONL log so nothing is ever silently rewritten.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIR = process.env.INTAKE_DIR ? path.resolve(process.env.INTAKE_DIR) : path.join(REPO, ".intake");
const FILE = path.join(DIR, "requests.jsonl");
const PLAN = path.join(REPO, "toys/plan/plan.mjs");

const now = () => new Date().toISOString();
const pad = (s, n) => String(s).padEnd(n);

async function load() {
  let text = "";
  try { text = await readFile(FILE, "utf8"); } catch { return new Map(); }
  const items = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.t === "add") items.set(e.id, { id: e.id, text: e.text, at: e.at, cwd: e.cwd, project: e.project ?? null, status: "open", planId: null });
    else if (e.t === "promote" && items.has(e.id)) Object.assign(items.get(e.id), { status: "promoted", planId: e.planId, project: e.project, at2: e.at });
    else if (e.t === "drop" && items.has(e.id)) Object.assign(items.get(e.id), { status: "dropped" });
    else if (e.t === "reopen" && items.has(e.id)) Object.assign(items.get(e.id), { status: "open", planId: null });
  }
  return items;
}

async function record(event) {
  await mkdir(DIR, { recursive: true });
  await appendFile(FILE, JSON.stringify(event) + "\n");
}

function parse(argv) {
  const flags = {}; const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=");
      flags[k] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true);
    } else positional.push(a);
  }
  return { flags, positional };
}

function usage() {
  console.log(`intake - requests captured now, decided later

  intake add <text>            record a request verbatim
  intake list [--all]          what is waiting, oldest first
  intake show <id>             one request in full
  intake promote <id> [--project P] [--priority N] [--title T]
                               turn it into a plan issue and link them
  intake drop <id>             not doing it
  intake path                  where the log lives`);
}

async function main(argv) {
  const { flags, positional } = parse(argv);
  const [command, ...rest] = positional;
  const items = await load();
  if (!command || command === "help") { usage(); return; }

  if (command === "path") { console.log(FILE); return; }

  if (command === "add") {
    const text = rest.join(" ").trim();
    if (!text) throw new Error("add needs the request text");
    const id = items.size ? Math.max(...items.keys()) + 1 : 1;
    await record({ t: "add", id, at: now(), text, cwd: process.cwd(), project: typeof flags.project === "string" ? flags.project : null });
    console.log(`captured #${id}: ${text.length > 70 ? text.slice(0, 70) + "…" : text}`);
    return;
  }

  if (command === "list") {
    const show = flags.all ? [...items.values()] : [...items.values()].filter((i) => i.status === "open");
    if (!show.length) { console.log("nothing waiting"); return; }
    for (const i of show.sort((a, b) => a.id - b.id)) {
      const mark = i.status === "promoted" ? `→ plan #${i.planId}` : i.status === "dropped" ? "dropped" : "open";
      console.log(`${pad(`#${i.id}`, 5)} ${pad(i.at.slice(0, 10), 12)} ${pad(mark, 14)} ${i.text.slice(0, 78)}`);
    }
    return;
  }

  if (command === "show") {
    const id = Number(String(rest[0] ?? "").replace("#", ""));
    const item = items.get(id);
    if (!item) throw new Error(`no request ${rest[0]}`);
    console.log(`#${item.id}  ${item.at}`);
    console.log(`status:  ${item.status}${item.planId ? ` (plan #${item.planId})` : ""}`);
    console.log(`captured in: ${item.cwd}`);
    console.log(`\n${item.text}`);
    return;
  }

  if (command === "promote") {
    const id = Number(String(rest[0] ?? "").replace("#", ""));
    const item = items.get(id);
    if (!item) throw new Error(`no request ${rest[0]}`);
    if (item.status === "promoted") throw new Error(`already promoted to plan #${item.planId}`);

    const project = typeof flags.project === "string" ? flags.project : item.project ?? "general";
    const priority = Number(flags.priority ?? 3);
    const title = typeof flags.title === "string" ? flags.title : item.text.split("\n")[0].slice(0, 80);
    const body = `Captured ${item.at.slice(0, 10)} from ${item.cwd}.\n\n${item.text}`;

    const out = execFileSync(process.execPath, [PLAN, "add", title, "--project", project, "--priority", String(priority), "--body", body], { encoding: "utf8" });
    const match = /added #(\d+)/.exec(out);
    const planId = match ? Number(match[1]) : null;
    await record({ t: "promote", id, at: now(), planId, project });
    console.log(`request #${id} → plan #${planId}  (${project}, P${priority})`);
    return;
  }

  if (command === "drop") {
    const id = Number(String(rest[0] ?? "").replace("#", ""));
    if (!items.has(id)) throw new Error(`no request ${rest[0]}`);
    await record({ t: "drop", id, at: now() });
    console.log(`dropped #${id}`);
    return;
  }

  if (command === "reopen") {
    const id = Number(String(rest[0] ?? "").replace("#", ""));
    if (!items.has(id)) throw new Error(`no request ${rest[0]}`);
    await record({ t: "reopen", id, at: now() });
    console.log(`reopened #${id}`);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`intake: ${error.message}`);
  process.exitCode = 1;
});
