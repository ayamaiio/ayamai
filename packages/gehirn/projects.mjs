// The same facts the terminal `status` command prints: where the work is, how
// far the vault is from full, what is still open in the plan store.
//
// Both surfaces read these exact sources. Cache the slow ones; never let a
// `du` block a health check.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOME = homedir();
const VAULT = "/mnt/y/ayamai";
const TTL = 30_000;

let cache = { at: 0, value: null };

function run(command, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 1 << 20 }, (error, stdout) =>
      resolve(error ? "" : String(stdout)));
  });
}

/** Open items in a plan store, from its events log. Pure — tested directly. */
export function planOpen(eventsText) {
  const items = new Map();
  for (const line of String(eventsText ?? "").split("\n")) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.t === "add") items.set(event.id, { status: "todo" });
    else if (event.t === "set" && items.has(event.id)) Object.assign(items.get(event.id), event.fields);
    else if (event.t === "rm") items.delete(event.id);
  }
  return [...items.values()].filter((item) => item.status !== "done").length;
}

function planFile(repo) {
  const file = path.join(repo, ".plan", "events.jsonl");
  if (!existsSync(file)) return -1;
  try { return planOpen(readFileSync(file, "utf8")); } catch { return -1; }
}

async function repos() {
  const found = await run("find", [HOME, "-maxdepth", "3", "-type", "d", "-name", ".git",
    "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.nvm/*"]);
  const dirs = found.split("\n").filter(Boolean).map((entry) => entry.replace(/\/\.git$/, "")).sort();
  const rows = [];
  for (const dir of dirs.slice(0, 12)) {
    const [branch, status, last] = await Promise.all([
      run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]),
      run("git", ["-C", dir, "status", "--porcelain"]),
      run("git", ["-C", dir, "log", "-1", "--format=%cr"]),
    ]);
    rows.push({
      name: path.basename(dir),
      branch: branch.trim() || "?",
      dirty: status.split("\n").filter(Boolean).length,
      last: last.trim().replace(/ ago$/, "") || "no commits",
      open: planFile(dir),
    });
  }
  return rows;
}

// df, not du: walking a 9p mount takes minutes and tells us nothing df does not.
async function vault() {
  const df = await run("df", ["-h", "/mnt/y"]);
  const parts = df.split("\n")[1]?.trim().split(/\s+/) ?? [];
  return { used: parts[2] ?? "?", free: parts[3] ?? "?", total: parts[1] ?? "?" };
}

export async function projects() {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value;
  const [rows, disk] = await Promise.all([repos(), vault()]);
  const value = {
    repos: rows,
    vault: disk,
    at: Date.now(),
  };
  cache = { at: Date.now(), value };
  return value;
}
