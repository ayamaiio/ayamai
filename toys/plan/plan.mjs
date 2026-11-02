#!/usr/bin/env node
// plan - a small, dependency-free issue tracker for this project.
// Storage is an append-only JSONL event log at .plan/events.jsonl.
// Read it with cat. Diff it with git. Move it with cp.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MODES } from "../../packages/core/modes.mjs";
import { fileURLToPath } from "node:url";

const STATUSES = ["todo", "doing", "blocked", "done", "retired"];
const GLYPH = { todo: "-", doing: ">", blocked: "!", done: "x", retired: "·" };

/** Open is not done and not retired. One predicate, so nothing disagrees. */
const isOpen = (issue) => issue.status !== "done" && issue.status !== "retired";
const DIR = process.env.PLAN_DIR ? path.resolve(process.env.PLAN_DIR) : path.join(process.cwd(), ".plan");
const FILE = path.join(DIR, "events.jsonl");

const now = () => new Date().toISOString();

async function load(file = FILE) {
  let text = "";
  try { text = await readFile(file, "utf8"); } catch { return new Map(); }
  const issues = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.t === "add") {
      issues.set(e.id, {
        id: e.id, title: e.title, body: e.body ?? "", project: e.project ?? "",
        priority: e.priority ?? 3, labels: e.labels ?? [], files: e.files ?? [], mode: e.mode ?? "",
        from: e.from ?? null, status: "todo",
        assignee: null, leaseUntil: null,
        created: e.ts, updated: e.ts,
      });
    } else if (e.t === "set" && issues.has(e.id)) {
      Object.assign(issues.get(e.id), e.fields, { updated: e.ts });
    } else if (e.t === "rm") {
      issues.delete(e.id);
    }
  }
  return issues;
}

async function record(event) {
  await mkdir(DIR, { recursive: true });
  await appendFile(FILE, JSON.stringify(event) + "\n");
}

function parse(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split("=");
      flags[key] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true);
    } else positional.push(a);
  }
  return { flags, positional };
}


/** The repo root: the catalogue and git both live beside this script, whatever PLAN_DIR says. */
const ROOT = path.resolve(import.meta.dirname, "../..");
function repoRoot() {
  return process.env.PLAN_ROOT ?? ROOT;
}

function safeRun(argv, cwd = repoRoot()) {
  try {
    return execFileSync(argv[0], argv.slice(1), {
      cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return ""; }
}

/** Pure: a title reduced to what makes two follow-ups "the same". */
export function titleKey(title) {
  return String(title ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Pure: the body a follow-up is filed with. */
export function followupBody({ body, acceptance, from, subject }) {
  const parts = [];
  if (body) parts.push(String(body).trim());
  if (acceptance) parts.push(`Acceptance: ${String(acceptance).trim()}`);
  if (from) parts.push(`Raised by ${from}${subject ? ` — ${subject}` : ""}`);
  return parts.join("\n\n");
}

function knownProjects() {
  try {
    const catalog = JSON.parse(readFileSync(path.join(repoRoot(), "catalog.json"), "utf8"));
    return (catalog.entries ?? []).map((entry) => entry.id);
  } catch { return null; }
}

function readStdin() {
  return new Promise((resolve) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { body += chunk; });
    process.stdin.on("end", () => resolve(body));
    process.stdin.on("error", () => resolve(body));
  });
}

/**
 * File the follow-ups a change revealed. Batch input, all-or-nothing, and
 * idempotent: the same follow-up filed twice is one item, not two.
 */
async function fileFollowups({ flags, issues }) {
  const fallbackProject = typeof flags.project === "string" ? flags.project : "";
  const ref = typeof flags.from === "string" ? flags.from : "HEAD";
  const dryRun = Boolean(flags["dry-run"]);

  if (process.stdin.isTTY) throw new Error("followup reads a JSON array on stdin");
  const raw = await readStdin();
  let batch;
  try { batch = JSON.parse(raw || "[]"); } catch (error) { throw new Error(`followup needs JSON on stdin: ${error.message}`); }
  if (!Array.isArray(batch)) throw new Error("followup needs a JSON array");
  if (!batch.length) { console.log("nothing to file"); return; }

  const projects = knownProjects();
  const modes = new Set(MODES.map((mode) => mode.id));
  const errors = [];
  const prepared = [];

  for (const [index, item] of batch.entries()) {
    const where = `item ${index + 1}`;
    const title = String(item?.title ?? "").trim();
    if (!title) { errors.push(`${where}: title is required`); continue; }

    const project = String(item.project ?? fallbackProject ?? "").trim();
    if (!project) errors.push(`${where}: a project is required (--project <id>)`);
    else if (projects && !projects.includes(project)) {
      errors.push(`${where}: unknown project "${project}" — known: ${projects.join(", ")}`);
    }

    const priority = item.priority ?? 3;
    if (!Number.isInteger(priority) || priority < 1 || priority > 4) errors.push(`${where}: priority must be 1-4`);

    const mode = String(item.mode ?? "").trim().toLowerCase();
    if (mode && !modes.has(mode)) errors.push(`${where}: unknown mode "${mode}" — known: ${[...modes].join(", ")}`);

    prepared.push({
      title, project, priority, mode,
      body: item.body ?? "",
      acceptance: item.acceptance ?? "",
      files: Array.isArray(item.files) ? item.files.map(String) : [],
      labels: Array.isArray(item.labels) ? item.labels.map(String) : [],
    });
  }

  if (errors.length) {
    for (const error of errors) console.error(`  ${error}`);
    throw new Error(`${errors.length} problem${errors.length === 1 ? "" : "s"} — nothing was filed`);
  }

  const sha = safeRun(["git", "rev-parse", "--short=7", ref]) || (flags.from ? String(flags.from) : "");
  const subject = sha ? safeRun(["git", "log", "-1", "--format=%s", ref]) : "";

  const open = [...issues.values()].filter((issue) => issue.status !== "done" && issue.status !== "retired");
  const seen = new Set(prepared.map((item) => `${item.project}\u0000${titleKey(item.title)}`));
  const filed = [];
  const skipped = [];

  for (const item of prepared) {
    const key = `${item.project}\u0000${titleKey(item.title)}`;
    const existing = open.find((issue) => issue.project === item.project && titleKey(issue.title) === titleKey(item.title));
    if (existing) { skipped.push({ item, id: existing.id }); continue; }
    if (seen.has(key)) seen.delete(key); // the first occurrence wins; the rest fall through as duplicates
    filed.push(item);
  }

  // a second identical title in the same batch is a duplicate of the first
  const unique = [];
  const batchKeys = new Set();
  for (const item of filed) {
    const key = `${item.project}\u0000${titleKey(item.title)}`;
    if (batchKeys.has(key)) { skipped.push({ item, id: null }); continue; }
    batchKeys.add(key);
    unique.push(item);
  }

  if (dryRun) {
    for (const item of unique) {
      console.log(`would file  ${item.project.padEnd(9)} P${item.priority}  ${item.title}`);
    }
    for (const skip of skipped) console.log(`skip        ${skip.id ? `#${skip.id}` : "duplicate"}  ${skip.item.title}`);
    console.log(`${unique.length} would be filed · ${skipped.length} skipped`);
    return;
  }

  let nextId = issues.size ? Math.max(...issues.keys()) + 1 : 1;
  for (const item of unique) {
    const id = nextId++;
    await record({
      t: "add",
      id,
      ts: now(),
      title: item.title,
      body: followupBody({ body: item.body, acceptance: item.acceptance, from: sha, subject }),
      project: item.project,
      priority: item.priority,
      mode: item.mode,
      files: item.files,
      labels: [...new Set([...item.labels, "followup"])],
      from: sha || null,
    });
    console.log(`filed   ${("#" + id).padEnd(5)} ${item.project.padEnd(9)} P${item.priority}  ${item.title}`);
  }
  for (const skip of skipped) {
    console.log(`skip    ${(skip.id ? `#${skip.id}` : "dup").padEnd(5)} ${skip.item.project.padEnd(9)}      ${skip.item.title}`);
  }
  console.log(`${unique.length} filed · ${skipped.length} skipped`);
}

const label = (i) => `#${i.id}`;
const pad = (s, n) => String(s).padEnd(n);

function printTable(issues) {
  if (!issues.length) { console.log("no issues"); return; }
  const rows = issues.map((i) => [label(i), GLYPH[i.status], `P${i.priority}`, i.project || "-", i.title]);
  const head = ["ID", "ST", "PRI", "PROJECT", "TITLE"];
  const widths = head.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)));
  const fmt = (r) => r.map((v, c) => pad(v, widths[c])).join("  ").trimEnd();
  console.log(fmt(head));
  for (const r of rows) console.log(fmt(r));
}

/** A lease is live only while it has not expired: a dead agent cannot wedge the queue. */
function leased(issue) {
  return Boolean(issue.assignee) && Number(issue.leaseUntil ?? 0) > Date.now();
}

function ttlMs(value) {
  const match = /^(\d+)([smh])$/.exec(String(value ?? "30m"));
  if (!match) throw new Error("--ttl must look like 30m, 2h or 90s");
  const scale = { s: 1000, m: 60_000, h: 3_600_000 }[match[2]];
  return Number(match[1]) * scale;
}

function order(a, b) {
  const rank = { doing: 0, blocked: 1, todo: 2, done: 3 };
  return rank[a.status] - rank[b.status] || a.priority - b.priority || a.id - b.id;
}

function usage() {
  console.log(`plan - issue tracking for this project

  plan add <title> [--body T] [--project P] [--priority 1-4] [--labels a,b] [--files p,q] [--mode M]
  plan list [--all] [--status S] [--project P] [--json]
  plan show <id> [--json]
  plan set <id> [--status S] [--priority N] [--project P] [--title T] [--body T] [--labels a,b] [--files p,q] [--mode M]
  plan followup [--project P] [--from REF] [--dry-run]   file the work a change revealed
                                              reads a JSON array on stdin
  plan retire <id...> | --all [--note T]   keep the record, close the item
  plan rm <id>
  plan projects
  plan export                  markdown to stdout
  plan path                    print the event log path
  plan dirty [--repo P]        which plan each uncommitted file belongs to
  plan next --by A [--project P] [--ttl 30m]   claim the highest priority open item
  plan claim <id> --by A [--ttl 30m]           claim one item
  plan release <id>                            give it back
  plan hook install            close plans from commit messages ("fix #3")

  statuses: ${STATUSES.join(", ")}
  priority: 1 highest, 4 lowest (default 3)`);
}

async function main(argv) {
  const { flags, positional } = parse(argv);
  const [command, ...rest] = positional;
  const issues = await load();

  if (!command || flags.help || command === "help") { usage(); return; }

  if (command === "path") { console.log(FILE); return; }

  if (command === "add") {
    const title = rest.join(" ").trim();
    if (!title) throw new Error("add requires a title");
    const id = issues.size ? Math.max(...issues.keys()) + 1 : 1;
    const priority = flags.priority ? Number(flags.priority) : 3;
    if (!Number.isInteger(priority) || priority < 1 || priority > 4) throw new Error("priority must be 1-4");
    await record({
      t: "add", id, ts: now(), title,
      body: typeof flags.body === "string" ? flags.body : "",
      project: typeof flags.project === "string" ? flags.project : "",
      priority,
      labels: typeof flags.labels === "string" ? flags.labels.split(",").map((s) => s.trim()).filter(Boolean) : [],
      files: typeof flags.files === "string" ? flags.files.split(",").map((s) => s.trim()).filter(Boolean) : [],
      // The stance this item wants: engineering · art · cto · product · incident · research
      mode: typeof flags.mode === "string" ? flags.mode.trim().toLowerCase() : "",
      from: typeof flags.from === "string" ? flags.from : null,
    });
    console.log(`added #${id}  ${title}`);
    return;
  }

  if (command === "claim") {
    const id = Number(rest[0]);
    const by = String(flags.by ?? "").trim();
    if (!Number.isInteger(id) || !issues.has(id)) throw new Error("claim requires a known id");
    if (!by) throw new Error("claim requires --by <agent>");
    const issue = issues.get(id);
    if (leased(issue) && issue.assignee !== by) throw new Error(`#${id} is held by ${issue.assignee}`);
    const until = Date.now() + ttlMs(flags.ttl);
    await record({ t: "set", id, ts: now(), fields: { assignee: by, leaseUntil: until, status: "doing" } });
    console.log(`claimed #${id} as ${by} until ${new Date(until).toISOString()}`);
    return;
  }

  if (command === "release") {
    const id = Number(rest[0]);
    if (!Number.isInteger(id) || !issues.has(id)) throw new Error("release requires a known id");
    await record({ t: "set", id, ts: now(), fields: { assignee: null, leaseUntil: null } });
    console.log(`released #${id}`);
    return;
  }

  if (command === "next") {
    const by = String(flags.by ?? "").trim();
    if (!by) throw new Error("next requires --by <agent>");
    let pool = [...issues.values()].filter((issue) => isOpen(issue) && !leased(issue));
    if (flags.project) pool = pool.filter((issue) => issue.project === flags.project);
    pool.sort((a, b) => a.priority - b.priority || a.id - b.id);
    if (!pool.length) { console.log("none open"); return; }
    const pick = pool[0];
    const until = Date.now() + ttlMs(flags.ttl);
    await record({ t: "set", id: pick.id, ts: now(), fields: { assignee: by, leaseUntil: until, status: "doing" } });
    console.log(`claimed #${pick.id}  ${pick.title}`);
    return;
  }

  if (command === "list") {
    let rows = [...issues.values()];
    if (flags.status) rows = rows.filter((i) => i.status === flags.status);
    if (flags.project) rows = rows.filter((i) => i.project === flags.project);
    if (!flags.all && !flags.status) rows = rows.filter(isOpen);
    rows.sort(order);
    if (flags.json) { console.log(JSON.stringify(rows, null, 2)); return; }
    printTable(rows);
    return;
  }

  if (command === "projects") {
    if (flags.json) {
      const counts = new Map();
      for (const i of issues.values()) {
        const key = i.project || "";
        const entry = counts.get(key) ?? { id: key, open: 0, doing: 0, blocked: 0, done: 0 };
        entry[i.status] = (entry[i.status] ?? 0) + 1;
        if (isOpen(i)) entry.open += 1;
        counts.set(key, entry);
      }
      console.log(JSON.stringify([...counts.values()].sort((a, b) => b.open - a.open || a.id.localeCompare(b.id)), null, 2));
      return;
    }
    const counts = new Map();
    for (const i of issues.values()) {
      const key = i.project || "-";
      counts.set(key, (counts.get(key) ?? 0) + (i.status === "done" ? 0 : 1));
    }
    if (!counts.size) { console.log("no projects"); return; }
    for (const [name, open] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${pad(name, 22)} ${open} open`);
    return;
  }

  if (command === "show") {
    const id = Number(String(rest[0] ?? "").replace("#", ""));
    const issue = issues.get(id);
    if (!issue) throw new Error(`no issue ${rest[0]}`);
    if (flags.json) { console.log(JSON.stringify(issue, null, 2)); return; }
    console.log(`${label(issue)}  ${issue.title}`);
    console.log(`status: ${issue.status}   priority: P${issue.priority}   project: ${issue.project || "-"}`);
    if (issue.mode) console.log(`mode: ${issue.mode}`);
    if (issue.labels.length) console.log(`labels: ${issue.labels.join(", ")}`);
    if (issue.files?.length) console.log(`files: ${issue.files.join(", ")}`);
    console.log(`created: ${issue.created}   updated: ${issue.updated}`);
    if (issue.body) console.log(`\n${issue.body}`);
    return;
  }

  if (command === "set") {
    const id = Number(String(rest[0] ?? "").replace("#", ""));
    if (!issues.has(id)) throw new Error(`no issue ${rest[0]}`);
    const fields = {};
    if (flags.status) {
      if (!STATUSES.includes(flags.status)) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
      fields.status = flags.status;
    }
    if (flags.priority) {
      const p = Number(flags.priority);
      if (!Number.isInteger(p) || p < 1 || p > 4) throw new Error("priority must be 1-4");
      fields.priority = p;
    }
    if (typeof flags.project === "string") fields.project = flags.project;
    if (typeof flags.title === "string") fields.title = flags.title;
    if (typeof flags.body === "string") fields.body = flags.body;
    if (typeof flags.labels === "string") fields.labels = flags.labels.split(",").map((s) => s.trim()).filter(Boolean);
    if (typeof flags.files === "string") fields.files = flags.files.split(",").map((s) => s.trim()).filter(Boolean);
    if (typeof flags.mode === "string") fields.mode = flags.mode.trim().toLowerCase();
    if (!Object.keys(fields).length) throw new Error("set needs at least one field");
    await record({ t: "set", id, ts: now(), fields });
    console.log(`updated #${id}  ${Object.keys(fields).join(", ")}`);
    return;
  }

  if (command === "retire") {
    const ids = rest.map((value) => Number(String(value).replace("#", ""))).filter(Number.isInteger);
    const pool = flags.all ? [...issues.keys()] : ids;
    if (!pool.length) throw new Error("retire needs ids, or --all");
    const note = typeof flags.note === "string" && flags.note
      ? flags.note
      : `retired ${now().slice(0, 10)} — pre-foundation backlog`;
    let retired = 0;
    for (const id of pool) {
      const issue = issues.get(id);
      if (!issue) throw new Error(`no issue ${id}`);
      if (issue.status === "retired") continue;
      const body = issue.body ? `${issue.body}\n\n${note}` : note;
      await record({ t: "set", id, ts: now(), fields: { status: "retired", body } });
      retired += 1;
    }
    console.log(retired ? `retired ${retired} item${retired === 1 ? "" : "s"}` : "nothing to retire");
    return;
  }

  if (command === "followup") {
    await fileFollowups({ flags, issues });
    return;
  }

  if (command === "rm") {
    const id = Number(String(rest[0] ?? "").replace("#", ""));
    if (!issues.has(id)) throw new Error(`no issue ${rest[0]}`);
    await record({ t: "rm", id, ts: now() });
    console.log(`removed #${id}`);
    return;
  }

  if (command === "export") {
    const groups = new Map();
    for (const i of [...issues.values()].sort(order)) {
      const key = i.project || "Unscoped";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    console.log("# Plans\n");
    for (const [project, items] of groups) {
      console.log(`## ${project}\n`);
      for (const i of items) console.log(`- [${i.status === "done" ? "x" : " "}] **${label(i)}** ${i.title} _(P${i.priority}${i.status !== "todo" ? `, ${i.status}` : ""})_`);
      console.log("");
    }
    return;
  }


  if (command === "hook") {
    const action = rest[0];
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const hooks = path.join(top, ".git", "hooks");
    const target = path.join(hooks, "post-commit");
    if (action === "install") {
      const planBin = fileURLToPath(import.meta.url);
      const script = `#!/usr/bin/env bash
# Installed by: plan hook install
set -u
top="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -d "$top/.plan" ] || exit 0
export PLAN_DIR="$top/.plan"
msg="$(git log -1 --pretty=%B 2>/dev/null)" || exit 0
for n in $(printf '%s\\n' "$msg" | grep -oE '#[0-9]+' | tr -d '#' | sort -u); do
  if printf '%s' "$msg" | grep -qiE "(close[sd]?|fix(es|ed)?|done|resolve[sd]?) #$n"; then
    "${process.execPath}" "${planBin}" set "$n" --status done >/dev/null 2>&1 && echo "plan: #$n -> done"
  elif printf '%s' "$msg" | grep -qiE "(start(s|ed)?|wip|begin) #$n"; then
    "${process.execPath}" "${planBin}" set "$n" --status doing >/dev/null 2>&1 && echo "plan: #$n -> doing"
  fi
done
`;
      await mkdir(hooks, { recursive: true });
      await writeFile(target, script, { mode: 0o755 });
      console.log(`installed ${target}`);
      return;
    }
    if (action === "show") {
      console.log(`hook path: ${target}`);
      console.log(`installed: ${existsSync(target) ? "yes" : "no"}`);
      return;
    }
    throw new Error("hook expects install or show");
  }

  if (command === "dirty") {
    const repo = typeof flags.repo === "string"
      ? path.resolve(flags.repo)
      : execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const scoped = await load(path.join(repo, ".plan", "events.jsonl"));
    let porcelain = "";
    try { porcelain = execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }); } catch { return; }
    const changed = porcelain.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
    const owned = [...scoped.values()].filter((i) => isOpen(i) && i.files?.length);
    const find = (file) => owned.find((i) => i.files.some((f) => (f.endsWith("/") ? file.startsWith(f) : file === f)));
    if (flags.json) {
      console.log(JSON.stringify(changed.map((file) => {
        const issue = find(file);
        return { file, id: issue?.id ?? null, title: issue?.title ?? null };
      })));
      return;
    }
    for (const file of changed) {
      const issue = find(file);
      console.log(issue ? `${pad(file, 52)} #${issue.id} ${issue.title}` : `${pad(file, 52)} -`);
    }
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`plan: ${error.message}`);
  process.exitCode = 1;
});
