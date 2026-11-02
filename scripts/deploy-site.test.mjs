import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { filesIn, version, stamp } = await import("./deploy-site.mjs");

test("the walker ships the page and nothing private", () => {
  const files = filesIn();
  assert.ok(files.includes("index.html"));
  assert.ok(!files.some((file) => file.endsWith(".test.mjs")), "tests do not go to the edge");
  assert.ok(!files.some((file) => file.split("/").some((part) => part.startsWith("."))), "dotfiles stay home");
});

test("the version comes from the catalog", () => {
  const value = version();
  const catalog = JSON.parse(readFileSync(new URL("../catalog.json", import.meta.url), "utf8"));
  assert.equal(value, catalog.entries.find((entry) => entry.kind === "platform").version);
});

test("the stamp fills the footer exactly once", () => {
  const template = "<span>v{{VERSION}}</span>";
  assert.equal(stamp(template, "2026.11.02"), "<span>v2026.11.02</span>");
  assert.ok(!stamp(template, "1").includes("{{VERSION}}"));
});

test("hidden files are skipped even if added later", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "site-"));
  mkdirSync(path.join(dir, "nested"));
  writeFileSync(path.join(dir, "index.html"), "x");
  writeFileSync(path.join(dir, "nested", "ok.txt"), "x");
  writeFileSync(path.join(dir, ".secret"), "x");
  assert.deepEqual(filesIn(dir), ["index.html", "nested/ok.txt"]);
});
