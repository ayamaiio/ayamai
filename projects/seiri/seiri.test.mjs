// A page that cannot parse is a page that renders nothing — which is exactly what
// happened when a regex picked up a real newline from a template literal. This is
// the guard: render the page, take its inline script, and parse it.
import test from "node:test";
import assert from "node:assert/strict";

import { PAGE } from "./index.mjs";

function scripts(html) {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
}

test("the seiri page has a script", () => {
  const inline = scripts(PAGE);
  assert.ok(inline.length >= 1, "there is at least one inline script");
  assert.ok(inline.join("").length > 1000, "and it is more than a stub");
});

test("the seiri page script parses", () => {
  for (const source of scripts(PAGE)) {
    // constructing the function compiles it; a syntax error throws here
    assert.doesNotThrow(() => new Function(source), "the page script must compile");
  }
});

test("retired has its own chip, and all does not mean the archive", () => {
  assert.ok(PAGE.includes('["retired","retired"]'), "the chip exists");
  assert.ok(PAGE.includes('item.status === "retired"'), "and all filters it out");
});
