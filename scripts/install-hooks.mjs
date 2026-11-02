#!/usr/bin/env node
// Write the pre-push guard into this checkout. Idempotent; will not clobber a
// hook someone else wrote unless forced.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const HOOK = path.join(REPO, ".git/hooks/pre-push");
const BODY = `#!/bin/sh
# ayamaiio is release-only: normal pushes go to the local mirror.
exec node "$(git rev-parse --show-toplevel)/scripts/hook-pre-push.mjs" "$@"
`;

const force = process.argv.includes("--force");
mkdirSync(path.dirname(HOOK), { recursive: true });

if (existsSync(HOOK) && !force) {
  const current = readFileSync(HOOK, "utf8");
  if (current.includes("hook-pre-push.mjs")) { console.log("hook already installed"); process.exit(0); }
  if (!current.includes("ayamai")) {
    console.error("a different pre-push hook exists; rerun with --force to replace it");
    process.exit(1);
  }
}

writeFileSync(HOOK, BODY);
chmodSync(HOOK, 0o755);
console.log(`installed ${path.relative(REPO, HOOK)}`);
