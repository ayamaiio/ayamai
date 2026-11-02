import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeCollections, validateCollections, cursorFor, countByCollection,
  folderEntries, folderTotal, resolveActive, emptyCounts,
} from "./collections.mjs";

test("legacy single dataset becomes one collection", () => {
  const list = normalizeCollections({ dataset: { repo: "nyanko7/danbooru2023", dir: "original", shards: 2020 }, startShard: 1900 });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "nyanko7/danbooru2023");
  assert.equal(list[0].kind, "hf-tar");
  assert.equal(list[0].startShard, 1900);
  assert.equal(list[0].shards, 2020);
});

test("explicit collections are normalized and validated", () => {
  const list = normalizeCollections({ collections: [
    { id: "a", kind: "hf-tar", repo: "r", dir: "d" },
    { id: "b", kind: "folder", path: "/tmp/x" },
  ] });
  assert.equal(list[0].shards, 1);
  assert.equal(list[1].kind, "folder");
  assert.doesNotThrow(() => validateCollections(list));
  assert.throws(() => validateCollections([...list, { id: "a", kind: "folder", path: "/tmp/y" }]), /duplicate/);
  assert.throws(() => validateCollections([{ id: "bad id", kind: "folder", path: "/tmp/y" }]), /invalid collection id/);
  assert.throws(() => validateCollections([{ id: "c", kind: "hf-tar" }]), /needs repo and dir/);
  assert.throws(() => validateCollections([{ id: "d", kind: "folder" }]), /needs a path/);
});

test("cursors are derived per collection and never shared", () => {
  const collection = { id: "a", kind: "hf-tar", startShard: 7 };
  assert.deepEqual(cursorFor([], "a", collection), { shard: 7, offset: 0 });
  const rows = [
    { collection: "a", cursor: { shard: 7, offset: 512, nextOffset: 4096 } },
    { collection: "b", cursor: { shard: 2, offset: 100, nextOffset: 200 } },
    { collection: "a", cursor: { shard: 7, offset: 4096, nextOffset: 9000 } },
  ];
  assert.deepEqual(cursorFor(rows, "a", collection), { shard: 7, offset: 9000 });
  assert.deepEqual(cursorFor(rows, "b", collection), { shard: 2, offset: 200 });
  const folderRows = [{ collection: "f", cursor: { index: 4, nextIndex: 5 } }];
  assert.deepEqual(cursorFor(folderRows, "f", { id: "f", kind: "folder" }), { index: 5 });
});

test("counts group by collection and tolerate missing verdicts", () => {
  const rows = [
    { collection: "a", verdict: "like", ts: "2026-01-01T00:00:00Z" },
    { collection: "a", verdict: "cant_judge", ts: "2026-01-02T00:00:00Z" },
    { collection: "b", verdict: "dislike", ts: "2026-01-03T00:00:00Z" },
  ];
  const counts = countByCollection(rows);
  assert.equal(counts.get("a").like, 1);
  assert.equal(counts.get("a").cant_judge, 1);
  assert.equal(counts.get("a").total, 2);
  assert.equal(counts.get("a").lastAt, "2026-01-02T00:00:00Z");
  assert.equal(counts.get("b").total, 1);
  assert.deepEqual(emptyCounts().total, 0);
});

test("folder collections count only images and survive a missing path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collections-"));
  try {
    fs.writeFileSync(path.join(dir, "b.png"), "x");
    fs.writeFileSync(path.join(dir, "a.jpg"), "x");
    fs.writeFileSync(path.join(dir, "notes.txt"), "x");
    fs.mkdirSync(path.join(dir, "sub"));
    const collection = { id: "f", kind: "folder", path: dir };
    assert.deepEqual(folderEntries(collection), ["a.jpg", "b.png"]);
    assert.equal(folderTotal(collection), 2);
    assert.equal(folderTotal({ id: "g", kind: "folder", path: path.join(dir, "missing") }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("active collection resolution prefers stored, then config, then first", () => {
  const list = [{ id: "a" }, { id: "b" }];
  assert.equal(resolveActive({ activeCollection: "b" }, list, null), "b");
  assert.equal(resolveActive({ activeCollection: "b" }, list, "a"), "a");
  assert.equal(resolveActive({}, list, "gone"), "a");
  assert.equal(resolveActive({}, [], null), null);
});
