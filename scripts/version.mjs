#!/usr/bin/env node
// Stamp one dated version across the catalog and every manifest.
//
//   node scripts/version.mjs                # show what is there
//   node scripts/version.mjs --bump         # today's date (or .N if taken)
//   node scripts/version.mjs --set 2026.11.02 [--dry-run]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { agree, calver, nextVersion, versionsOf } from "../packages/core/version.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const CATALOG = path.join(REPO, "catalog.json");

/** Every manifest a release cares about: projects and their children. */
export function manifestFiles(repo = REPO) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const next = path.join(dir, entry.name);
      const file = path.join(next, "project.json");
      if (existsSync(file)) out.push(path.relative(repo, file));
      walk(next, depth + 1);
    }
  };
  walk(path.join(repo, "projects"), 1);
  return out.sort();
}

function readAll(repo = REPO) {
  const catalog = JSON.parse(readFileSync(path.join(repo, "catalog.json"), "utf8"));
  const files = manifestFiles(repo);
  const manifests = files.map((file) => ({ file, ...JSON.parse(readFileSync(path.join(repo, file), "utf8")) }));
  return { catalog, files, manifests };
}

export function stamp(version, { repo = REPO, dry = false } = {}) {
  const { catalog, files, manifests } = readAll(repo);
  const changes = [];
  for (const entry of catalog.entries ?? []) {
    if (entry.version !== version) changes.push({ file: "catalog.json", id: entry.id, from: entry.version, to: version });
    entry.version = version;
  }
  for (const manifest of manifests) {
    if (manifest.version !== version) changes.push({ file: manifest.file, id: manifest.id, from: manifest.version, to: version });
  }
  if (!dry) {
    writeFileSync(path.join(repo, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
    for (const file of files) {
      const full = path.join(repo, file);
      const data = JSON.parse(readFileSync(full, "utf8"));
      data.version = version;
      writeFileSync(full, JSON.stringify(data, null, 2) + "\n");
    }
  }
  return { changes, catalog, manifests };
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const setIndex = args.indexOf("--set");
  const { catalog, manifests } = readAll();
  const versions = versionsOf({ catalog, manifests });

  const current = agree(versions);
  const wanted = setIndex >= 0 ? String(args[setIndex + 1] ?? "") : args.includes("--bump") ? nextVersion(current.version, new Date()) : null;

  if (!wanted) {
    console.log(current.ok ? `version ${current.version} — every project agrees` : `versions disagree: ${current.versions.join(", ")}`);
    for (const entry of versions.filter((item) => !current.ok && item.version !== current.versions[0])) console.log(`  ${entry.file}  ${entry.id}  ${entry.version}`);
    return;
  }

  const { changes } = stamp(wanted, { dry });
  if (!changes.length) { console.log(`already at ${wanted}`); return; }
  for (const change of changes) console.log(`${change.file.padEnd(46)} ${String(change.id).padEnd(10)} ${change.from} → ${change.to}`);
  console.log(`\n${changes.length} version(s) ${dry ? "would change" : "changed"} → ${wanted}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
