import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { faceFor, hasPlayFace, normalizeMode, rankProjects, readMode, targetFor, writeMode } from "./mode.mjs";

test("anything that is not play is dev", () => {
  assert.equal(normalizeMode("play"), "play");
  assert.equal(normalizeMode("PLAY"), "play");
  assert.equal(normalizeMode("dev"), "dev");
  assert.equal(normalizeMode("nonsense"), "dev");
  assert.equal(normalizeMode(null), "dev");
});

test("the door follows the mode", () => {
  assert.equal(targetFor("play"), "/play/");
  assert.equal(targetFor("dev"), "/gehirn/");
  assert.equal(targetFor("nonsense"), "/gehirn/");
});

test("projects reorder by face, and none are lost", () => {
  const withPlay = { faces: { play: "/" } };
  const work = { id: "seiri" };
  const projects = [{ id: "seiri" }, { id: "yoru", ...withPlay }, { id: "kata" }, { id: "uta", ...withPlay }, { id: "gemu", ...withPlay }];
  const play = rankProjects(projects, "play").map((project) => project.id);
  const dev = rankProjects(projects, "dev").map((project) => project.id);

  assert.deepEqual(play.slice(0, 3), ["yoru", "uta", "gemu"], "the play three come first");
  assert.deepEqual(dev.slice(-3), ["yoru", "uta", "gemu"], "and last when working");
  assert.equal(play.length, projects.length);
  assert.equal(dev.length, projects.length);
  assert.deepEqual([...projects].map((p) => p.id).sort(), [...play].sort(), "the same projects, differently ordered");
});

test("the mode is a file, and a missing file is dev", () => {
  const data = mkdtempSync(path.join(tmpdir(), "mode-"));
  assert.equal(readMode(data).mode, "dev", "no file");
  writeMode(data, "play");
  assert.equal(readMode(data).mode, "play");
  writeMode(data, "nonsense");
  assert.equal(readMode(data).mode, "dev", "normalised on the way in");
  assert.ok(hasPlayFace({ faces: { play: "/" } }));
});


test("a face is the product's path inside its own prefix", () => {
  const yoru = { id: "yoru", routes: [{ prefix: "/yoru" }], faces: { play: "/feed?play=1", dev: "/" } };
  assert.equal(faceFor(yoru, "play"), "/yoru/feed?play=1");
  assert.equal(faceFor(yoru, "dev"), "/yoru/");
  assert.equal(faceFor({ routes: [{ prefix: "/uta" }] }, "play"), "/uta/", "no faces means its root");
  assert.equal(faceFor({}, "play"), "/", "and no prefix means the door");
  assert.equal(hasPlayFace(yoru), true);
  assert.equal(hasPlayFace({ id: "seiri" }), false, "declaring a play face is what puts you on the shelf");
});
