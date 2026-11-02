#!/usr/bin/env node
// Move the pixiv agent between the repository and the folder that runs it.
//
//   node scripts/pixiv-agent-sync.mjs --check    compare, change nothing
//   node scripts/pixiv-agent-sync.mjs            copy the repository's version over
//
// The agent runs on Windows because playwright-core and the Brave profile live
// there. The repository is the source of truth; this is the one file that moves,
// verified by hash, so drift is impossible to miss.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
export const SOURCE = path.join(REPO, "packages/agent/pixiv/service.mjs");
export const PIN = path.join(REPO, "packages/agent/pixiv/service.sha256");
/** Where the agent actually runs: next to playwright-core, where gehirn starts it. */
export const RUNTIME = process.env.AYAMAI_AGENT_DIR ?? "/mnt/c/Users/admin/ayamai-agent";
export const RUNNING = path.join(RUNTIME, "agent-service.mjs");

export function digest(file) {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex").trim();
  } catch {
    return null;
  }
}

/** Pure: what the two copies are, and whether they agree. */
export function compare({ source, running } = {}) {
  const repo = digest(source ?? SOURCE);
  const deployed = digest(running ?? RUNNING);
  const pinned = (() => {
    try { return readFileSync(PIN, "utf8").trim(); } catch { return null; }
  })();
  return {
    repo,
    deployed,
    pinned,
    pinnedMatchesRepo: Boolean(repo && pinned && repo === pinned),
    inSync: Boolean(repo && deployed && repo === deployed),
    deployedExists: Boolean(deployed),
  };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  if (!existsSync(SOURCE)) {
    console.error("the repository copy is missing: " + path.relative(REPO, SOURCE));
    return 1;
  }
  const state = compare();
  console.log("  repo     " + (state.repo ? state.repo.slice(0, 16) : "missing"));
  console.log("  pinned   " + (state.pinned ? state.pinned.slice(0, 16) : "missing") + (state.pinnedMatchesRepo ? "" : "  (does not match the file - update service.sha256)"));
  console.log("  running  " + (state.deployed ? state.deployed.slice(0, 16) : "missing") + "  " + RUNNING);

  if (checkOnly) {
    if (!state.pinnedMatchesRepo) return 1;
    if (!state.inSync) {
      console.error("\nthe running copy is not the repository's. Run: node scripts/pixiv-agent-sync.mjs");
      return 1;
    }
    console.log("\nthey agree.");
    return 0;
  }

  if (!state.pinnedMatchesRepo) {
    console.error("\nrefusing to deploy: service.sha256 does not match service.mjs");
    return 1;
  }
  copyFileSync(SOURCE, RUNNING);
  const after = compare();
  if (!after.inSync) {
    console.error("\nthe copy does not verify after writing.");
    return 1;
  }
  console.log("\ndeployed. Restart the agent for it to take effect.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) process.exit(main());
