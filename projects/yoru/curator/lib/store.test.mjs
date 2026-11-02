import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "./store.mjs";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "store-"));
}

test("decisions are scoped per collection", () => {
  const dir = tmp();
  try {
    const store = new Store(dir, { legacyCollection: "legacy" });
    store.record({ ts: new Date().toISOString(), collection: "a", id: "1", verdict: "like" });
    assert.equal(store.isDecided("a", "1"), true);
    assert.equal(store.isDecided("b", "1"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy rows without a collection belong to the legacy source", () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, "state.jsonl"), JSON.stringify({ ts: "2026-01-01T00:00:00Z", id: "77", verdict: "like" }) + "\n");
    const store = new Store(dir, { legacyCollection: "legacy" });
    assert.equal(store.rows[0].collection, "legacy");
    assert.equal(store.isDecided("legacy", "77"), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("kept images land in per-collection directories and undo is collection-scoped", () => {
  const dir = tmp();
  try {
    const store = new Store(dir, { legacyCollection: "legacy" });
    const buf = Buffer.from("img");
    store.like({ collection: "a", id: "1", ext: "png", buf, meta: null, cursor: { shard: 0, offset: 0, nextOffset: 512 }, entry: { name: "1.png", size: 3, dataOffset: 512 }, dataset: "src", shard: 0 });
    store.record({ ts: new Date().toISOString(), collection: "a", id: "1", verdict: "like", cursor: { shard: 0, offset: 0, nextOffset: 512 } });

    assert.ok(fs.existsSync(path.join(dir, "likes", "a", "1.png")));
    assert.ok(fs.existsSync(path.join(dir, "likes", "a", "1.json")));
    assert.deepEqual(store.keeps("a").map((k) => k.id), ["1"]);
    assert.equal(store.keeps("b").length, 0);
    assert.ok(store.keepFile("a", "1"));
    assert.equal(store.keepFile("b", "1"), null);

    const undone = store.undo();
    assert.equal(undone.collection, "a");
    assert.equal(fs.existsSync(path.join(dir, "likes", "a", "1.png")), false);
    assert.equal(store.isDecided("a", "1"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("folder cursors survive a record and replay", () => {
  const dir = tmp();
  try {
    const store = new Store(dir, { legacyCollection: "legacy" });
    store.record({ ts: new Date().toISOString(), collection: "f", id: "a", verdict: "skip", cursor: { index: 3, nextIndex: 4 } });
    const reloaded = new Store(dir, { legacyCollection: "legacy" });
    assert.equal(reloaded.last().cursor.nextIndex, 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
