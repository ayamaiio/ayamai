import test from "node:test";
import assert from "node:assert/strict";

import { VIEWS, resolveView, viewQuery, storageKey } from "./view.mjs";

test("the URL wins over what was remembered", () => {
  assert.equal(resolveView({ search: "?view=play", stored: "develop" }), "play");
  assert.equal(resolveView({ search: "?view=develop", stored: "play" }), "develop");
});

test("remembered state applies when the URL says nothing", () => {
  assert.equal(resolveView({ search: "", stored: "play" }), "play");
  assert.equal(resolveView({ search: "?", stored: "play" }), "play");
});

test("nonsense falls back to develop", () => {
  assert.equal(resolveView({ search: "?view=cinema", stored: null }), "develop");
  assert.equal(resolveView({ search: "", stored: "cinema" }), "develop");
  assert.equal(resolveView({ search: "?view=play", stored: "play", allowed: ["develop"] }), "develop");
  assert.equal(resolveView({}), "develop");
});

test("only a non-default state gets a query string", () => {
  assert.equal(viewQuery("play"), "?view=play");
  assert.equal(viewQuery("develop"), "");
  assert.equal(viewQuery(null), "");
  assert.equal(viewQuery("cinema"), "");
});

test("the remembered key is per project", () => {
  assert.equal(storageKey("gemu"), "ayamai.view.gemu");
  assert.notEqual(storageKey("gemu"), storageKey("yoru"));
  assert.deepEqual(VIEWS, ["develop", "play"]);
});
