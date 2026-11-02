import test from "node:test";
import assert from "node:assert/strict";

import { stripIntro, withIntroEnd, freeze } from "./site-preview.mjs";

const page = `<!doctype html><html><head><style>:root{--intro-end:6.5s}</style></head><body>
<section class="intro">
  <blockquote>“An idiot admires complexity, a genius admires simplicity.”</blockquote>
  <p class="who">Terry A. Davis, creator of TempleOS</p>
</section>

<div class="intro-brand">
  <div class="mark"><img class="logo" src="/brand/mark.png" alt="" /></div>
</div>

<header class="top"><div class="mark">AYAMAI</div></header>
</body></html>`;

test("both openings can be removed from the preview", () => {
  const stripped = stripIntro(page);
  assert.ok(!stripped.includes('class="intro"'), "the quote is gone");
  assert.ok(!stripped.includes('class="intro-brand"'), "and the brand stage");
  assert.ok(stripped.includes('<header class="top">'), "the page is intact");
});

test("the reveal can be moved to the first frame", () => {
  const quick = withIntroEnd(page);
  assert.ok(quick.includes(":root{--intro-end:0s}</style>"), "the schedule is anchored at zero");
  assert.ok(quick.includes('class="intro"'), "and the opening is still there unless it was stripped too");
});

test("the settled page can be frozen", () => {
  const still = freeze(page);
  assert.ok(still.includes("animation:none!important"), "nothing animates");
  assert.ok(still.includes(".piece,.title .lf{opacity:1!important;clip-path:none!important"), "and nothing is left hidden");
});
