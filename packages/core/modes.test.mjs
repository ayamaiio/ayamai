import test from "node:test";
import assert from "node:assert/strict";

import { MODES, modeById, modeBlock } from "./modes.mjs";

test("the stances are distinct and named", () => {
  const ids = MODES.map((mode) => mode.id);
  assert.deepEqual(ids, ["engineering", "art", "cto", "product", "incident", "research"]);
  assert.equal(new Set(ids).size, ids.length);
  for (const mode of MODES) {
    assert.ok(mode.label && mode.optimises && mode.evidence, `${mode.id} is incomplete`);
    assert.ok(mode.contract.length >= 3, `${mode.id} needs a contract`);
  }
});

test("engineering is the default, and nonsense falls back to it", () => {
  assert.equal(modeById(undefined).id, "engineering");
  assert.equal(modeById("").id, "engineering");
  assert.equal(modeById("CTO").id, "cto", "case does not matter");
  assert.equal(modeById("chaos-gremlin").id, "engineering");
});

test("the block says what the mode is for and never claims authority", () => {
  const block = modeBlock(modeById("cto"));
  assert.ok(block.includes("cto mode"));
  assert.ok(block.includes("recommendation in one line"));
  assert.ok(block.trim().endsWith("a mode never widens authority."));
});
