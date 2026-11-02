#!/usr/bin/env node
// One-time tidying: the plan store's old areas become the catalog's names.
//
//   node scripts/plan-projects.mjs          # report only
//   node scripts/plan-projects.mjs --apply  # append the relabelling events
//
// The store is an append-only log, so this never rewrites history: it adds one
// `set` event per item. Running it twice appends nothing.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");

/** Pure: the areas the media era invented, mapped to the projects that exist. */
export const MAP = {
  box: "yoru",
  library: "yoru",
  product: "yoru",
  gb: "ayamai",
  tooling: "ayamai",
  // The platform project was renamed when the organization took that name.
  ayamai: "platform",
};

/** The ids come from the catalog, so a rename never leaves a stale copy here. */
export function catalogIds(repo = path.resolve(import.meta.dirname, "..")) {
  try { return JSON.parse(readFileSync(path.join(repo, "catalog.json"), "utf8")).entries.map((entry) => entry.id); }
  catch { return []; }
}

export function mapProject(name, ids = catalogIds()) {
  const value = String(name ?? "").trim();
  if (!value) return null;
  if (ids.includes(value)) return null;   // already right
  return MAP[value] ?? null;
}

function plan(...args) {
  return execFileSync(process.execPath, [path.join(REPO, "toys/plan/plan.mjs"), ...args], { cwd: REPO, encoding: "utf8" });
}

function main() {
  const apply = process.argv.includes("--apply");
  const items = JSON.parse(plan("list", "--all", "--json") || "[]");
  const ids = catalogIds();
  const moves = items.map((item) => ({ id: item.id, from: item.project, to: mapProject(item.project, ids) })).filter((move) => move.to);

  if (!moves.length) { console.log("nothing to relabel"); return; }
  for (const move of moves) console.log(`#${move.id}  ${move.from || "(none)"} → ${move.to}`);

  if (!apply) { console.log(`\n${moves.length} item(s) would change — rerun with --apply`); return; }
  for (const move of moves) plan("set", String(move.id), "--project", move.to);
  console.log(`\nrelabelled ${moves.length} item(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
