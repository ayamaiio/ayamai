import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { inventory, renderPage } from "./server.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);

test("the real manifest is what the page shows", () => {
  const data = inventory(HERE + "/extension");
  assert.equal(data.ok, true);
  assert.ok(data.manifest.version);
  const html = renderPage(data);
  assert.ok(html.includes(String(data.manifest.version)), "the page carries the manifest's value");
  assert.ok(html.includes("ayamai · ikari"));
  assert.ok(html.includes(data.extension), "and the absolute folder");
});

test("the page lists the commands the extension contributes", () => {
  const data = inventory(HERE + "/extension");
  const html = renderPage(data);
  for (const command of data.manifest.contributes.commands) assert.ok(html.includes(command.command), command.command);
});

test("a broken manifest renders the reason, not a stack trace", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ext-"));
  writeFileSync(path.join(dir, "package.json"), "{ not json");
  const data = inventory(dir);
  assert.equal(data.ok, false);
  assert.ok(data.error.length > 0);
  const html = renderPage(data);
  assert.ok(html.includes("could not read the manifest"));
  assert.ok(!html.includes("undefined"));
});
