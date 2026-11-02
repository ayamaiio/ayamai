#!/usr/bin/env node
// No dead links in the documentation.
//
//   node scripts/check-docs.mjs
//
// Walks the forward-facing docs, resolves every relative markdown link, and
// proves that every `docs` entry in catalog.json exists. Archive links resolve
// too — but they are only allowed one level down, so history cannot quietly
// become the canon.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const SEEDS = ["README.md", "DESIGN.md", "AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", "LICENSE.md", "docs/PRODUCT.md", "docs/ARCHITECTURE.md", "docs/OPERATIONS.md"];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "archive") continue; // archived files are not maintained
      files.push(...walk(full));
    } else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files;
}

const files = [...new Set([...SEEDS.map((file) => path.join(ROOT, file)).filter((file) => existsSync(file)), ...walk(path.join(ROOT, "docs"))])];

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const problems = [];
const archives = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(LINK)) {
    const href = match[1];
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const clean = href.split("#")[0];
    if (!clean) continue;
    const resolved = path.resolve(path.dirname(file), clean);
    if (!existsSync(resolved)) {
      problems.push(`${path.relative(ROOT, file)}: ${href}`);
      continue;
    }
    // A forward-facing page should not lean on the archive for its facts.
    const relative = path.relative(ROOT, resolved);
    if (relative.startsWith("docs/archive") && !file.endsWith("archive/README.md")) archives.push(`${path.relative(ROOT, file)} → ${href}`);
  }
}

// The catalog's docs must exist, or gehirn shows a dead button.
const catalogFile = path.join(ROOT, "catalog.json");
if (existsSync(catalogFile)) {
  const catalog = JSON.parse(readFileSync(catalogFile, "utf8"));
  for (const entry of catalog.entries ?? []) {
    const entries = [entry.path, ...(entry.docs ?? [])];
    for (const doc of entry.docs ?? []) {
      const base = String(doc).startsWith("docs/") ? ROOT : path.resolve(ROOT, entry.path ?? ".");
      if (!existsSync(path.resolve(base, String(doc)))) problems.push(`catalog.json: ${entry.id} → ${doc}`);
    }
    if (!existsSync(path.resolve(ROOT, entry.path ?? "."))) problems.push(`catalog.json: ${entry.id} path ${entry.path}`);
    void entries;
  }
}

console.log(`checked ${files.length} documents`);
if (archives.length) {
  console.log(`\nlinks into the archive (history, not canon):`);
  for (const line of archives) console.log(`  ${line}`);
}
if (problems.length) {
  console.error(`\n${problems.length} broken reference(s):`);
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}
console.log("no dead links");
