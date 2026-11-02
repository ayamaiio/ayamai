import test from "node:test";
import assert from "node:assert/strict";

import { MAX_LIMIT, page, paging } from "./page.mjs";

const items = Array.from({ length: 250 }, (_, index) => index);

test("a page is a slice with the real total", () => {
  const first = page(items, { limit: 10, offset: 0 });
  assert.deepEqual(first.items, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(first.total, 250);
  assert.equal(first.more, true);

  const last = page(items, { limit: 10, offset: 240 });
  assert.equal(last.items.length, 10);
  assert.equal(last.more, false);
});

test("the numbers are clamped, not trusted", () => {
  assert.equal(page(items, { limit: 10_000 }).items.length, MAX_LIMIT);
  assert.equal(page(items, { limit: 0 }).limit, 1);
  assert.equal(page(items, { limit: -5 }).limit, 1);
  assert.equal(page(items, { offset: -20 }).offset, 0);
  assert.equal(page(items, { limit: 10, offset: 10_000 }).items.length, 0);
  assert.equal(page(items, { limit: 10, offset: 10_000 }).total, 250, "the total is still true");
});

test("nothing is not an error", () => {
  assert.deepEqual(page([]).items, []);
  assert.equal(page([]).total, 0);
  assert.deepEqual(page(undefined).items, []);
});

test("paging reads search params, including nonsense", () => {
  const params = new URLSearchParams("limit=25&offset=50");
  assert.deepEqual(paging(params), { limit: 25, offset: 50, max: MAX_LIMIT });
  const empty = new URLSearchParams("");
  assert.deepEqual(paging(empty), { limit: 50, offset: 0, max: MAX_LIMIT });
  const junk = new URLSearchParams("limit=abc&offset=xyz");
  assert.equal(paging(junk).limit, 50);
  assert.equal(paging(junk).offset, 0);
});
