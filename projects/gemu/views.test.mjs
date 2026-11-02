import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = () => readFileSync(new URL("./server.mjs", import.meta.url), "utf8");

test("the page carries both states", () => {
  const text = source();
  for (const id of ["view-toggle", "shelf", "develop", "shelf-grid", "toast"]) {
    assert.ok(text.includes(`id="${id}"`), `#${id} is missing`);
  }
  assert.ok(text.includes("ayamai.view.gemu"), "the remembered key is per project");
  assert.ok(text.includes("replaceState"), "switching keeps the URL honest");
});

test("covers are fetched once and cached outside the repo", () => {
  const text = source();
  assert.ok(text.includes('path.join(dataRoot(), "gemu/covers")'), "the cache lives with the data");
  assert.ok(text.includes("cdn.cloudflare.steamstatic.com"), "one source, named");
  assert.ok(text.includes("misses.add"), "a failed cover is not retried in a loop");
  assert.ok(/\/\^\\d\{1,9\}\$\//.test(text), "appids are validated");
});

test("a tile without art falls back to type, not a broken image", () => {
  const text = source();
  assert.ok(text.includes('el("span", "word", game.name)'), "the typographic fallback exists");
  assert.ok(text.includes("aspect-ratio:460/215"), "tiles reserve their shape");
});

test("the developer view is still there", () => {
  const text = source();
  for (const id of ["library", "roms", "recent", "search", "rescan"]) {
    assert.ok(text.includes(`id="${id}"`), `#${id} is missing`);
  }
});
