import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { compare, digest } from "./pixiv-agent-sync.mjs";

const scratch = () => mkdtempSync(path.join(tmpdir(), "agent-sync-"));

test("identical copies agree, a changed one does not", () => {
  const root = scratch();
  const source = path.join(root, "service.mjs");
  const running = path.join(root, "agent-service.mjs");
  writeFileSync(source, "export const a = 1;\n");
  writeFileSync(running, "export const a = 1;\n");
  assert.equal(compare({ source, running }).inSync, true);

  writeFileSync(running, "export const a = 2;\n");
  const drifted = compare({ source, running });
  assert.equal(drifted.inSync, false);
  assert.equal(drifted.deployedExists, true);
  assert.notEqual(digest(source), digest(running));
});

test("a missing runtime copy is reported, not thrown", () => {
  const root = scratch();
  const source = path.join(root, "service.mjs");
  writeFileSync(source, "x");
  const state = compare({ source, running: path.join(root, "not-there.mjs") });
  assert.equal(state.inSync, false);
  assert.equal(state.deployedExists, false);
  assert.equal(digest(path.join(root, "not-there.mjs")), null);
});
