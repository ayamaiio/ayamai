#!/usr/bin/env node
// One test command, every suite, any platform.
//
//   node scripts/test.mjs            # everything the project ships
//   node scripts/test.mjs platform   # one group: platform · products · tools · ui · docs
//
// Globs are expanded here rather than by the shell, so `pnpm test` behaves the
// same on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");

const GROUPS = {
  platform: ["packages"],
  products: ["projects"],
  tools: ["scripts"],
  ui: ["ui", "site"],
  docs: ["docs"],
};

/** Every *.test.mjs at the top level of a directory or one level below it. */
export function discover(dir, base = dir, depth = 0) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      if (depth < 2) out.push(...discover(full, base, depth + 1));
    } else if (entry.name.endsWith(".test.mjs")) {
      out.push(path.relative(REPO, full).replace(/\\/g, "/"));
    }
  }
  return out.sort();
}

function filesFor(names) {
  const files = [];
  for (const name of names) {
    const group = GROUPS[name];
    if (!group) { console.error(`unknown group: ${name} (try ${Object.keys(GROUPS).join(", ")})`); process.exit(2); }
    for (const dir of group) files.push(...discover(path.join(REPO, dir)));
  }
  return files;
}

const asked = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const names = asked.length ? asked : Object.keys(GROUPS);
const files = filesFor(names);

if (!files.length) { console.error("no tests found"); process.exit(1); }
console.log(`${files.length} test files · ${names.join(", ")}\n`);

const run = spawnSync(process.execPath, ["--test", ...files], { cwd: REPO, stdio: "inherit" });
process.exit(run.status ?? 1);
