import test from "node:test";
import assert from "node:assert/strict";

import { ORG, isOrgRemote, allowPush, releaseTag, nextReleaseTag, proposedVersion, summary, commitMessage } from "./publish.mjs";

test("the org remote is recognised however it is written", () => {
  for (const url of [
    "git@github.com:ayamaiio/ayamai.git",
    "https://github.com/ayamaiio/ayamai.git",
    "https://github.com/ayamaiio/ayamai",
  ]) assert.equal(isOrgRemote(url), true, url);
  for (const url of [
    "/mnt/y/git/ayamai.git",
    "https://github.com/markfoster314/ayamai.git",
    "https://github.com/ayamaiio-fan/thing.git",
  ]) assert.equal(isOrgRemote(url), false, url);
});

test("pushes to the org need the publish flag, everything else is free", () => {
  assert.equal(allowPush({ url: "/mnt/y/git/ayamai.git" }).ok, true);
  const refused = allowPush({ url: "git@github.com:ayamaiio/ayamai.git", env: {} });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /ayamai publish/);
  assert.equal(allowPush({ url: "git@github.com:ayamaiio/ayamai.git", env: { AYAMAI_PUBLISH: "1" } }).ok, true);
});

test("release names sort by day, then sequence", () => {
  const day = new Date(Date.UTC(2026, 10, 2));
  assert.equal(releaseTag(day, 1), "release/2026.11.02-1");
  assert.equal(releaseTag(day, 2), "release/2026.11.02-2");
  assert.ok(releaseTag(new Date(Date.UTC(2026, 10, 3))) > releaseTag(day, 9));
});

test("the version comes from the platform entry", () => {
  assert.equal(proposedVersion({ entries: [{ id: "yoru", version: "9.9.9" }, { kind: "platform", version: "0.4.1" }] }), "0.4.1");
  assert.equal(proposedVersion({ entries: [] }), "0.0.0");
  assert.equal(proposedVersion(null), "0.0.0");
});

test("the summary says what leaves the machine and where it lands", () => {
  const text = summary({ name: "release/2026.11.02-1", version: "0.1.0", branch: "packaged", commits: ["a one", "b two"], files: 3, lastRelease: "v0.1.0" });
  assert.ok(text.includes("release/2026.11.02-1"));
  assert.ok(text.includes("2 commit(s), 3 file(s)"));
  assert.ok(text.includes("a one"));
  assert.ok(text.includes(`${ORG}/ayamai`));
});

test("the snapshot commit explains itself", () => {
  const message = commitMessage("release/2026.11.02-1", "0.1.0");
  assert.ok(message.startsWith("release release/2026.11.02-1"));
  assert.ok(message.includes("one commit per release"));
});

test("the next release on a day is numbered, not reused", () => {
  const day = new Date(Date.UTC(2026, 10, 2));
  assert.equal(nextReleaseTag([], day), "release/2026.11.02-1");
  assert.equal(nextReleaseTag(["release/2026.11.02-1"], day), "release/2026.11.02-2");
  assert.equal(nextReleaseTag(["release/2026.11.02-1", "release/2026.11.02-7", "release/2026.11.01-3"], day), "release/2026.11.02-8");
});
