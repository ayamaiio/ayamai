import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isStale, newestMtime, parsePsStart, processStartTime } from "./process.mjs";

test("ps start times parse, single or double spaced", () => {
  const a = parsePsStart("Mon Nov  2 02:20:39 2026");
  const b = parsePsStart("Mon Nov 2 02:20:39 2026");
  assert.equal(a, b);
  assert.equal(new Date(a).getFullYear(), 2026);
  assert.equal(new Date(a).getMonth(), 10);
  assert.equal(parsePsStart("nonsense"), null);
  assert.equal(parsePsStart(""), null);
});

test("a process older than its code is stale, within tolerance", () => {
  const file = 1_000_000;
  assert.equal(isStale({ startMs: file - 10_000, fileMtime: file }), true);
  assert.equal(isStale({ startMs: file + 10_000, fileMtime: file }), false);
  assert.equal(isStale({ startMs: file - 500, fileMtime: file }), false, "inside the grace period");
  assert.equal(isStale({ startMs: null, fileMtime: file }), null, "unknown is not stale");
});

test("the newest file is the one that counts", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "proc-"));
  const older = path.join(dir, "a.mjs");
  const newer = path.join(dir, "b.mjs");
  writeFileSync(older, "1");
  writeFileSync(newer, "2");
  const newest = newestMtime([older, newer, path.join(dir, "missing.mjs")]);
  assert.equal(newest, newestMtime([newer]));
});

test("this process has a start time on unix", { skip: process.platform === "win32" }, () => {
  const start = processStartTime(process.pid);
  assert.ok(Number.isFinite(start), "ps answered");
  assert.ok(start < Date.now(), "and it is in the past");
});
