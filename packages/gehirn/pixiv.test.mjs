// The sweep action's pure bits.
import test from "node:test";
import assert from "node:assert/strict";

import { braveCountFrom } from "./pixiv.mjs";

test("reads a process count out of whatever Windows prints", () => {
  assert.equal(braveCountFrom("16"), 16);
  assert.equal(braveCountFrom("  0\r\n"), 0);
  assert.equal(braveCountFrom("16\r\n"), 16);
  assert.equal(braveCountFrom(""), 0);
  assert.equal(braveCountFrom("No process"), 0);
});
