// What is stale: for each project, when it was last touched and how much is open.
//
// The repositories panel answers "what state is the working tree in". This
// answers a different question — "has anyone touched this lately" — which is the
// one that goes unanswered until a project has been quiet for a month.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { NEGLECTED_DAYS, summarise } from "../core/staleness.mjs";

export { NEGLECTED_DAYS, summarise };
import path from "node:path";

export const TTL = 60_000;

let cache = { at: 0, value: null };

const run = (command, args, cwd) => new Promise((resolve) => {
  execFile(command, args, { cwd, timeout: 5000, maxBuffer: 1 << 20 }, (error, stdout) => resolve(error ? "" : String(stdout).trim()));
});



/** Pure: open items per project, from the plan event log. */
export function openByProject(eventsText) {
  const items = new Map();
  for (const line of String(eventsText ?? "").split("\n")) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.t === "add") items.set(event.id, { project: event.project ?? "", status: "todo" });
    else if (event.t === "set" && items.has(event.id)) Object.assign(items.get(event.id), event.fields);
    else if (event.t === "rm") items.delete(event.id);
  }
  const counts = {};
  for (const item of items.values()) {
    if (item.status === "done" || item.status === "retired") continue;
    const key = item.project || "platform";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Pure: the last release on the record, or null. */
export function lastPublish(recordText) {
  const lines = String(recordText ?? "").trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry?.tag) return { tag: entry.tag, version: entry.version ?? null, at: entry.at ?? null };
    } catch { continue; }
  }
  return null;
}

/** IO: one git call per project, one read of the plan log, one of the publish record. */
export async function collect({ repo, entries = [], data } = {}) {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value;

  let events = "";
  try { events = readFileSync(path.join(repo, ".plan", "events.jsonl"), "utf8"); } catch { events = ""; }
  let record = "";
  try { record = readFileSync(path.join(data, "publish.jsonl"), "utf8"); } catch { record = ""; }

  const open = openByProject(events);
  const publish = lastPublish(record);
  const now = Date.now();

  const projects = [];
  for (const entry of entries) {
    const dir = entry.path ? path.join(repo, entry.path) : repo;
    const raw = existsSync(dir) ? await run("git", ["log", "-1", "--format=%ct%x09%h%x09%s", "--", "."], dir) : "";
    const [seconds, sha, subject] = raw ? raw.split("\t") : [];
    projects.push(summarise({
      id: entry.id,
      name: entry.name,
      now,
      lastCommit: seconds ? { at: Number(seconds), sha, subject } : null,
      open: open[entry.id] ?? 0,
      lastPublish: publish,
    }));
  }

  // most neglected first: the panel is for finding what has gone quiet
  projects.sort((a, b) => (b.days ?? 1e9) - (a.days ?? 1e9));
  const value = { at: now, projects, publish, neglected: projects.filter((project) => project.neglected).length };
  cache = { at: now, value };
  return value;
}
