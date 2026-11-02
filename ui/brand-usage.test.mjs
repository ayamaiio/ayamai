import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGES = [
  ["packages/gehirn/page.mjs", "gehirn"],
  ["projects/seiri/index.mjs", "seiri"],
  ["projects/gemu/server.mjs", "gemu"],
  ["projects/kata/index.mjs", "kata"],
  ["projects/hisho/index.mjs", "hisho"],
  ["projects/tsukai/server.mjs", "tsukai"],
  ["projects/fude/server.mjs", "fude"],
];

test("every surface uses the shared brand component", () => {
  for (const [file, tool] of PAGES) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(source.includes('from "../../ui/brand.mjs"'), `${file} does not import the brand`);
    assert.ok(source.includes(`tool: "${tool}"`), `${file} does not name its tool`);
  }
});

test("no page keeps its own copy of the brand styles", () => {
  for (const [file] of PAGES) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(!/\.brand\s*\.word\s*\{/.test(source), `${file} still defines .brand .word`);
    assert.ok(!/fonts\.googleapis\.com/.test(source), `${file} still loads fonts itself`);
  }
});

test("the wordmark art and the icon live in one place", () => {
  const brand = readFileSync(new URL("./brand.mjs", import.meta.url), "utf8");
  assert.ok(brand.includes("/ui/brand/mark.png"));
  assert.ok(brand.includes("/ui/brand/favicon.svg"));
});

test("the landing page carries its own copy of the mark", () => {
  const html = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  assert.ok(html.includes('src="/brand/mark.png"'), "the public page cannot reach /ui/");
  assert.ok(html.includes('rel="icon"'), "and it has an icon");
});
