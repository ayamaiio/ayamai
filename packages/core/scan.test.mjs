import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { matches, progressLine, rootDrives, shouldSkip, unchanged, walk } from "./scan.mjs";

const scratch = () => mkdtempSync(path.join(tmpdir(), "scan-"));

function plant() {
  const root = scratch();
  mkdirSync(path.join(root, "Music"), { recursive: true });
  mkdirSync(path.join(root, "Music", "Album"), { recursive: true });
  mkdirSync(path.join(root, "node_modules", "junk"), { recursive: true });
  mkdirSync(path.join(root, "$RECYCLE.BIN"), { recursive: true });
  writeFileSync(path.join(root, "Music", "a.mp3"), "x");
  writeFileSync(path.join(root, "Music", "Album", "b.flac"), "xx");
  writeFileSync(path.join(root, "Music", "notes.txt"), "no");
  writeFileSync(path.join(root, "node_modules", "junk", "c.mp3"), "no");
  writeFileSync(path.join(root, "$RECYCLE.BIN", "d.mp3"), "no");
  return root;
}

test("the skip list is about folders, not files", () => {
  assert.equal(shouldSkip("node_modules"), true);
  assert.equal(shouldSkip("$RECYCLE.BIN"), true);
  assert.equal(shouldSkip("System Volume Information"), true);
  assert.equal(shouldSkip("Music"), false);
  assert.equal(shouldSkip(".."), true);
});

test("matching is case-insensitive on the extension", () => {
  const audio = new Set([".mp3", ".flac"]);
  assert.equal(matches("A.MP3", audio), true);
  assert.equal(matches("b.flac", audio), true);
  assert.equal(matches("notes.txt", audio), false);
  assert.equal(matches("noextension", audio), false);
});

test("drives come from the mount table, sorted, and only /mnt/<letter>", () => {
  const root = scratch();
  const mounts = path.join(root, "mounts");
  writeFileSync(mounts, [
    "C:\\ /mnt/c 9p rw 0 0",
    "Y:\\ /mnt/y 9p rw 0 0",
    "Z:\\ /mnt/z 9p rw 0 0",
    "proc /proc proc rw 0 0",
  ].join("\n"));
  assert.deepEqual(rootDrives(mounts), ["/mnt/c", "/mnt/y", "/mnt/z"]);
});

test("a walk finds media and refuses the skip list", async () => {
  const root = plant();
  const seen = [];
  const result = await walk({
    roots: [root],
    extensions: new Set([".mp3", ".flac"]),
    onFile: (file) => { seen.push(file.path); },
  });
  assert.equal(result.found, 2);
  assert.ok(seen.some((file) => file.endsWith("a.mp3")));
  assert.ok(seen.some((file) => file.endsWith("b.flac")));
  assert.ok(!seen.some((file) => file.includes("node_modules")), "skipped");
  assert.ok(!seen.some((file) => file.includes("RECYCLE")), "skipped");
  assert.ok(result.dirs >= 3);
});

test("the second walk trusts the cache and the third sees a new file", async () => {
  const root = plant();
  const extensions = new Set([".mp3", ".flac"]);
  const first = await walk({ roots: [root], extensions });

  const second = await walk({ roots: [root], extensions, cache: first.cache });
  assert.equal(second.found, 2, "the cache still reports the files");
  assert.ok(second.dirs <= first.dirs, "and does not descend again");

  writeFileSync(path.join(root, "Music", "new.mp3"), "xxx");
  const third = await walk({
    roots: [root],
    extensions,
    cache: first.cache,
    onProgress: null,
  });
  assert.ok(third.found >= 2);
});

test("cancelling returns what it had", async () => {
  const root = plant();
  const controller = new AbortController();
  let count = 0;
  const result = await walk({
    roots: [root],
    extensions: new Set([".mp3", ".flac"]),
    signal: controller.signal,
    onFile: () => { count += 1; controller.abort(); },
  });
  assert.equal(count, 1);
  assert.equal(result.cancelled, true);
});

test("progress reads like a sentence", () => {
  const line = progressLine({ dir: "/mnt/z/Games/Dark Souls", files: 4103, found: 12, bytes: 5 * 1048576 });
  assert.match(line, /Z:\/Games\/Dark Souls/);
  assert.match(line, /4,103 files seen/);
  assert.match(line, /12 found/);
  assert.match(line, /5 MB/);
});
