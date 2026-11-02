import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { plan, slug, UPSTREAM } from "./sync.mjs";

const inventory = [
  { key: "azahar", name: "Azahar", exe: "C:\\Program Files\\Azahar\\azahar.exe", systems: ["3DS"] },
  { key: "mgba", name: "mGBA", exe: "C:\\Program Files\\mGBA\\mGBA.exe", systems: ["GBA", "Gameboy"] },
  { key: "mystery", name: "Mystery", exe: "C:\\x\\mystery.exe", systems: ["Whatever"] },
];

test("keys become folder-safe ids", () => {
  assert.equal(slug("Azahar"), "azahar");
  assert.equal(slug("Project 64"), "project-64");
  assert.equal(slug("--x--"), "x");
});

test("every emulator becomes a child manifest with its upstream", () => {
  const rows = plan(inventory);
  assert.equal(rows.length, 3);
  const azahar = rows.find((row) => row.id === "azahar").project;
  assert.equal(azahar.parent, "gemu");
  assert.equal(azahar.kind, "source");
  assert.equal(azahar.upstream.repo, UPSTREAM.azahar.repo);
  assert.deepEqual(azahar.emulator.systems, ["3DS"]);
  assert.equal(azahar.fork.repo, "", "nothing is forked until we say so");
  assert.equal("services" in azahar, false, "a child is not a server");
  assert.equal("routes" in azahar, false);
});

test("an unknown emulator still gets a manifest, with upstream left open", () => {
  const mystery = plan(inventory).find((row) => row.id === "mystery").project;
  assert.equal(mystery.upstream.repo, "");
  assert.equal(mystery.upstream.license, "");
});

test("entries without an exe or key are skipped", () => {
  assert.equal(plan([{ key: "x" }, { exe: "y" }]).length, 0);
});
