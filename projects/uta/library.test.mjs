import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describeFile, detectLink, fromFilename, fromOembed, linkId, readId3, scanLibrary } from "./library.mjs";

/** A minimal ID3v2.3 tag: TIT2, TPE1, TALB, then padding. */
function id3(frames) {
  const parts = [];
  for (const [id, value] of Object.entries(frames)) {
    const text = Buffer.from([0, ...Buffer.from(value, "latin1")]);
    const head = Buffer.alloc(10);
    head.write(id, 0, "latin1");
    head.writeUInt32BE(text.length, 4);
    parts.push(head, text);
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(10);
  header.write("ID3", 0, "latin1");
  header[3] = 3;
  header[6] = (body.length >> 21) & 0x7f;
  header[7] = (body.length >> 14) & 0x7f;
  header[8] = (body.length >> 7) & 0x7f;
  header[9] = body.length & 0x7f;
  return Buffer.concat([header, body]);
}

test("ID3 tags are read without a dependency", () => {
  const tags = readId3(id3({ TIT2: "Plastic Love", TPE1: "Mariya Takeuchi", TALB: "Variety", TYER: "1984" }));
  assert.deepEqual(tags, { title: "Plastic Love", artist: "Mariya Takeuchi", album: "Variety", year: "1984" });
});

test("a file without tags falls back to its name, not to an error", () => {
  assert.equal(readId3(Buffer.from("not an mp3")), null);
  assert.deepEqual(fromFilename("music/Mariya Takeuchi - Plastic Love.mp3"), {
    artist: "Mariya Takeuchi", title: "Plastic Love",
  });
  assert.deepEqual(fromFilename("music/untitled.mp3"), { artist: null, title: "untitled" });
});

test("one file becomes one track, and the id survives a rescan", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uta-"));
  writeFileSync(path.join(dir, "a.mp3"), id3({ TIT2: "Alpha", TPE1: "A" }));
  writeFileSync(path.join(dir, "B - Beta.mp3"), Buffer.from("x"));
  const first = scanLibrary(dir).tracks;
  const second = scanLibrary(dir).tracks;
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((track) => track.id), second.map((track) => track.id), "ids are stable");
  assert.equal(first[0].title, "Alpha");
  assert.equal(first[0].tags, "id3");
  assert.equal(first[1].title, "Beta");
  assert.equal(first[1].artist, "B");
  assert.equal(first[1].tags, "filename");
});

test("a missing music directory is an empty library, not a failure", () => {
  const scan = scanLibrary(path.join(tmpdir(), "uta-does-not-exist"));
  assert.equal(scan.exists, false);
  assert.deepEqual(scan.tracks, []);
  assert.match(scan.dir, /uta-does-not-exist/);
});

test("links are identified by service and id", () => {
  assert.deepEqual(detectLink("https://youtu.be/dQw4w9WgXcQ"), { service: "youtube", externalId: "dQw4w9WgXcQ" });
  assert.deepEqual(detectLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3"), { service: "youtube", externalId: "dQw4w9WgXcQ" });
  assert.deepEqual(detectLink("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"), { service: "spotify", externalId: "4uLU6hMCjMI75M1A2tKUQC" });
  assert.equal(detectLink("https://example.com/song").service, "link");
  assert.equal(linkId("spotify", "abc"), "link:spotify:abc");
});

test("oEmbed payloads map to what we store, missing fields included", () => {
  assert.deepEqual(fromOembed({ title: "Plastic Love", author_name: "Mariya Takeuchi", thumbnail_url: "https://x/y.jpg" }), {
    title: "Plastic Love", artist: "Mariya Takeuchi", thumb: "https://x/y.jpg",
  });
  assert.deepEqual(fromOembed({}), { title: null, artist: null, thumb: null });
});

test("a play is appended, never rewritten", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { readFileSync } = await import("node:fs");
  const { appendPlay, readPlays } = await import("./server.mjs");

  const file = path.join(mkdtempSync(path.join(tmpdir(), "uta-plays-")), "plays.jsonl");
  appendPlay({ id: "file:a", artist: "A" }, file);
  appendPlay({ id: "file:b", artist: "B" }, file);

  const lines = readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 2, "one line per play, no rewrite");
  assert.deepEqual(readPlays(file).map((play) => play.id), ["file:a", "file:b"]);
});
