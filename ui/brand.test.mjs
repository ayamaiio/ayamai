import test from "node:test";
import assert from "node:assert/strict";

import { brand, brandLinks } from "./brand.mjs";

test("the brand carries the mark, the word, the Japanese and the tool", () => {
  const html = brand({ tool: "seiri", jp: "整理", href: "/seiri/" });
  assert.ok(html.includes('src="/ui/brand/mark.png"'), "the mark is the shared one");
  assert.ok(html.includes('width="17" height="17"'), "17px, the canonical size");
  assert.ok(html.includes('<span class="word">AYAMAI</span>'));
  assert.ok(html.includes("アヤマイ"));
  assert.ok(html.includes('<span class="slash">/</span>'));
  assert.ok(html.includes('<span class="tool">seiri</span>'));
  assert.ok(html.includes("整理"));
});

test("without a tool it is just the wordmark", () => {
  const html = brand({ href: "/" });
  assert.ok(!html.includes('class="slash"'));
  assert.ok(!html.includes('class="tool"'));
});

test("the link falls back to base, then to the door", () => {
  assert.ok(brand({ base: "/gemu" }).includes('href="/gemu"'));
  assert.ok(brand({}).includes('href="/"'));
  assert.ok(brand({ href: "/gehirn/" }).includes('href="/gehirn/"'));
});

test("a hostile tool name is escaped", () => {
  const html = brand({ tool: '<script>alert(1)</script>' });
  assert.ok(!html.includes("<script>"), "no tag survives");
  assert.ok(html.includes("&lt;script&gt;"));
});

test("the links give a page the stylesheet and the icon", () => {
  const links = brandLinks();
  assert.ok(links.includes('/ui/brand.css'));
  assert.ok(links.includes('rel="icon"'));
  assert.equal((links.match(/<link/g) ?? []).length, 2);
  assert.ok(brandLinks({ version: "abc" }).includes("?v=abc"));
});
