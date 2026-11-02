import test from "node:test";
import assert from "node:assert/strict";

import { renderShelf, shelfRow } from "./page.mjs";

test("a row is what the shelf needs, and nothing else", () => {
  const row = shelfRow(
    { id: "yoru", description: "the media library", href: "/yoru/feed?play=1" },
    { up: true },
  );
  assert.deepEqual(row, { id: "yoru", jp: "\u591c", href: "/yoru/feed?play=1", line: "the media library", up: true });
});

test("the shelf prints exactly the products it is handed", () => {
  const html = renderShelf({
    products: [
      { id: "yoru", jp: "", href: "/yoru/feed?play=1", line: "media", up: true },
      { id: "uta", jp: "", href: "/uta/", line: "music", up: false },
    ],
  });
  assert.ok(html.includes('href="/yoru/feed?play=1"'), "the declared face, not the root");
  assert.ok(html.includes('href="/uta/"'));
  assert.ok(html.includes("dot on") && html.includes("dot off"), "up and down both show");
  assert.ok(html.includes("/gehirn/"), "there is a way back to dev");
  assert.match(html, /2 products/, "and it counts them");
});

test("an empty shelf says why it is empty", () => {
  const html = renderShelf({ products: [] });
  assert.match(html, /nothing declares a play face/);
});
