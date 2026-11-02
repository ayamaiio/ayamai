import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { cachedIndex, findTrack, isJunkTrack, libraryPage, moveToVault, readIndex, safeName, scan, vaultTarget, writeIndex } from "./scanner.mjs";

const scratch = () => mkdtempSync(path.join(tmpdir(), "uta-scan-"));

test("names are made safe, and a target keeps the tree", () => {
  assert.equal(safeName('AC/DC: "Live"', "x"), "AC DC Live");
  assert.equal(safeName("", "unsorted"), "unsorted");
  const target = vaultTarget({ artist: "A", album: "B", path: "/mnt/z/x/song.mp3" }, "/v");
  assert.equal(target, "/v/A/B/song.mp3");
  assert.equal(vaultTarget({ artist: null, album: null, path: "/mnt/z/song.mp3" }, "/v"), "/v/unsorted/song.mp3");
});

test("moving copies first and only then removes the original", () => {
  const root = scratch();
  const source = path.join(root, "song.mp3");
  writeFileSync(source, "audio-bytes-here");
  const target = moveToVault({ path: source, size: 16, artist: "A", album: null }, { vault: path.join(root, "vault") });
  assert.equal(target.moved, true);
  assert.equal(existsSync(source), false, "the original is gone");
  assert.equal(readFileSync(target.path, "utf8"), "audio-bytes-here");
});

test("a failed copy leaves the original where it was", () => {
  const root = scratch();
  const missing = path.join(root, "not-there.mp3");
  const result = moveToVault({ path: missing, size: 1, artist: "A" }, { vault: path.join(root, "vault") });
  assert.equal(result.moved, false);
  assert.match(result.reason, /ENOENT/);
  assert.equal(existsSync(missing), false, "nothing was created");
});

test("indexing in place is the default and never deletes anything", async () => {
  const root = scratch();
  mkdirSync(path.join(root, "Music"), { recursive: true });
  writeFileSync(path.join(root, "Music", "one.mp3"), Buffer.alloc(6000, 1));
  writeFileSync(path.join(root, "Music", "two.mp3"), Buffer.alloc(6000, 2));

  const data = path.join(root, "data");
  process.env.AYAMAI_DATA = data;
  const result = await scan({ roots: [path.join(root, "Music")], incremental: false });
  assert.equal(result.index?.mode, "index", JSON.stringify({ found: result.found, index: result.index?.found, dir: root }));
  assert.equal(result.index.found, 2, JSON.stringify({ files: result.index.files, found: result.index.found, roots: result.index.roots, tracks: result.index.tracks.length }));
  assert.equal(result.index.mode, "index");
  assert.equal(result.index.moved.count, 0);
  assert.ok(existsSync(path.join(root, "Music", "one.mp3")), "the file stayed");

  const index = readIndex(path.join(data, "uta", "index.json"));
  assert.equal(index.tracks.length, 2);
  assert.ok(index.tracks[0].id.startsWith("file:"));
});

test("a media id resolves through the index, and a path does not", async () => {
  const root = scratch();
  const data = path.join(root, "data");
  process.env.AYAMAI_DATA = data;
  mkdirSync(path.join(root, "Music"), { recursive: true });
  writeFileSync(path.join(root, "Music", "three.mp3"), Buffer.alloc(6000, 3));
  await scan({ roots: [path.join(root, "Music")], incremental: false });

  const index = readIndex(path.join(data, "uta", "index.json"));
  const id = index.tracks[0].id;
  assert.equal(findTrack(id, path.join(data, "uta", "index.json")).path, index.tracks[0].path);
  assert.equal(findTrack("../../etc/passwd", path.join(data, "uta", "index.json")), null);
});


const tracks = [
  { id: "file:a", path: "/x/b.mp3", title: "Beta", artist: "Zed", album: null },
  { id: "file:b", path: "/x/a.mp3", title: "Alpha", artist: "Amy", album: "First" },
  { id: "file:c", path: "/x/c.mp3", title: "Gamma", artist: "Amy", album: null },
];

test("a page of the library filters, sorts and says how many there are", () => {
  const first = libraryPage(tracks, { limit: 2, offset: 0 });
  assert.deepEqual(first.tracks.map((track) => track.title), ["Alpha", "Beta"], "title order by default");
  assert.equal(first.total, 3);
  assert.equal(first.more, true);

  const second = libraryPage(tracks, { limit: 2, offset: 2 });
  assert.deepEqual(second.tracks.map((track) => track.title), ["Gamma"]);
  assert.equal(second.more, false);

  const byArtist = libraryPage(tracks, { sort: "artist" });
  assert.deepEqual(byArtist.tracks.map((track) => track.artist), ["Amy", "Amy", "Zed"]);
});

test("a query searches title, artist and album, and counts what matches", () => {
  assert.equal(libraryPage(tracks, { q: "amy" }).total, 2, "artist, case-insensitive");
  assert.equal(libraryPage(tracks, { q: "first" }).total, 1, "album");
  assert.equal(libraryPage(tracks, { q: "bet" }).total, 1, "title");
  assert.equal(libraryPage(tracks, { q: "nothing" }).total, 0);
  assert.equal(libraryPage(tracks, { q: "nothing" }).tracks.length, 0);
});

test("the index is parsed once until the file changes", () => {
  const root = scratch();
  const data = path.join(root, "data");
  process.env.AYAMAI_DATA = data;
  mkdirSync(path.join(data, "uta"), { recursive: true });
  const file = path.join(data, "uta", "index.json");

  writeIndex({ at: 1, found: 1, tracks: [{ id: "file:aaaaaaaa", path: "/x/a.mp3" }] }, file);
  const first = cachedIndex(file);
  assert.equal(cachedIndex(file), first, "the same object, not another parse");

  writeIndex({ at: 2, found: 2, tracks: [] }, file);
  const second = cachedIndex(file);
  assert.notEqual(second, first);
  assert.equal(second.found, 2);
});


test("engine leftovers are not tracks", () => {
  const junk = [
    { path: "/g/_dl_silence.mp3", size: 900 },
    { path: "/g/_comma.mp3", size: 900 },
    { path: "/g/01.mp3", size: 50000 },
    { path: "/g/silence.mp3", size: 5000 },
    { path: "/g/tiny.mp3", size: 100 },
  ];
  const keep = [
    { path: "/g/L'Amour Toujours.mp3", size: 9_820_098 },
    { path: "/g/00_creak.mp3", size: 40_000 },
    { path: "/g/11 event dust.mp3", size: 40_000 },
  ];
  assert.ok(junk.every((track) => isJunkTrack(track)), "names that cannot be music");
  assert.ok(keep.every((track) => !isJunkTrack(track)), "and sounds that can be");
});
