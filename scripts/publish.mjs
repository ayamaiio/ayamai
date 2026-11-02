#!/usr/bin/env node
// ayamai publish — the only way anything reaches ayamaiio.
//
//   node scripts/publish.mjs --dry-run     # show the summary, touch nothing
//   node scripts/publish.mjs               # summary, then type the name to confirm
//   node scripts/publish.mjs --yes         # the same without typing
//
// What it does: squash the working tree into ONE commit, push that to the org,
// tag it, cut a release. History stays here and on the local mirror.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { allowPush, commitMessage, nextReleaseTag, proposedVersion, summary } from "../packages/core/publish.mjs";
import { agree, versionsOf } from "../packages/core/version.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const RECORD = path.join(process.env.AYAMAI_DATA ?? path.join(process.env.HOME ?? ".", ".local/share/ayamai"), "publish.jsonl");

const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
const tryGit = (...args) => { try { return git(...args); } catch { return ""; } };

function fail(message) {
  console.error(`publish: ${message}`);
  process.exit(1);
}

function lastRelease() {
  const tags = tryGit("tag", "--list", "release/*", "--sort=-creatordate");
  return tags.split("\n").filter(Boolean)[0] ?? null;
}

function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  return tryGit("log", "--oneline", range).split("\n").filter(Boolean);
}

function filesSince(tag) {
  // With no release yet, the honest count is the tree itself.
  if (!tag) return tryGit("ls-tree", "-r", "--name-only", "HEAD").split("\n").filter(Boolean).length;
  return tryGit("diff", "--name-only", `${tag}..HEAD`).split("\n").filter(Boolean).length;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const yes = args.includes("--yes") || args.includes("--dry");
  const orgUrl = tryGit("remote", "get-url", "origin");
  const verdict = allowPush({ url: orgUrl, env: { AYAMAI_PUBLISH: "1" } });
  if (!verdict.ok) fail(verdict.error);

  if (tryGit("status", "--porcelain")) fail("the tree is dirty — commit or stash first; a release is a snapshot of committed work");

  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const catalog = JSON.parse(readFileSync(path.join(REPO, "catalog.json"), "utf8"));
  // Every project ships as one snapshot, so every project carries one version.
  const manifests = git("ls-files", "projects/*/project.json", "projects/*/*/project.json").split("\n").filter(Boolean)
    .map((file) => ({ file, ...JSON.parse(readFileSync(path.join(REPO, file), "utf8")) }));
  const verdictVersion = agree(versionsOf({ catalog, manifests }));
  if (!verdictVersion.ok) {
    fail(`versions disagree: ${verdictVersion.versions.join(", ")} — run: ayamai version --bump`);
  }
  const version = proposedVersion(catalog);
  const tag = nextReleaseTag(tryGit("tag", "--list", "release/*").split("\n").filter(Boolean), new Date());
  const prior = lastRelease();

  console.log(summary({ name: tag, version, branch, commits: commitsSince(prior), files: filesSince(prior), lastRelease: prior }));
  console.log("");

  if (dry) { console.log("dry run — nothing was pushed"); return; }

  if (!yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await rl.question(`type the release name to push (${tag}): `)).trim();
    rl.close();
    if (typed !== tag) fail("not confirmed — nothing was pushed");
  }

  // One commit, no history: the tree as it is, parented to nothing.
  const tree = git("write-tree");
  const commit = execFileSync("git", ["commit-tree", tree, "-m", commitMessage(tag, version)], { cwd: REPO, encoding: "utf8" }).trim();
  execFileSync("git", ["push", "--force-with-lease", "origin", `${commit}:refs/heads/main`], {
    cwd: REPO, stdio: "inherit", env: { ...process.env, AYAMAI_PUBLISH: "1" },
  });
  tryGit("tag", "-f", tag, commit);
  execFileSync("git", ["push", "--force", "origin", `refs/tags/${tag}`], { cwd: REPO, stdio: "inherit", env: { ...process.env, AYAMAI_PUBLISH: "1" } });

  let release = "not created";
  try {
    release = execFileSync("gh", ["release", "create", tag, "--repo", "ayamaiio/ayamai", "--title", tag, "--notes", `version ${version}\nsnapshot of ${branch}`], { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    release = `run: gh release create ${tag} --repo ayamaiio/ayamai`;
  }

  try {
    mkdirSync(path.dirname(RECORD), { recursive: true });
    appendFileSync(RECORD, JSON.stringify({ at: new Date().toISOString(), tag, version, commit, branch }) + "\n");
  } catch { /* the record is a courtesy */ }

  // The public page should never claim an older version than the release.
  if (args.includes("--site")) {
    try {
      execFileSync(process.execPath, [path.join(REPO, "scripts/deploy-site.mjs")], { cwd: REPO, stdio: "inherit" });
    } catch {
      console.error("publish: the release is out, but the site did not deploy — run: node scripts/deploy-site.mjs");
    }
  }

  console.log(`\npublished ${tag} → ${commit.slice(0, 7)}`);
  console.log(`release: ${release}`);
}

main().catch((error) => fail(String(error?.message ?? error).split("\n")[0]));
