// Docs drift: the pages that describe behaviour must still describe the thing
// that exists. Cheap checks, run in CI, so a renamed route or a missing page
// fails the build instead of confusing the next person.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadRegistry } from "../packages/core/registry.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const registry = loadRegistry(REPO);
const catalog = JSON.parse(readFileSync(path.join(REPO, "catalog.json"), "utf8"));

test("every registered project has a page in docs/projects", () => {
  for (const project of registry.projects) {
    const file = path.join(REPO, "docs/projects", `${project.id}.md`);
    assert.ok(existsSync(file), `${project.id} has no docs/projects/${project.id}.md`);
  }
});

test("every catalog entry is either documented or the platform itself", () => {
  for (const entry of catalog.entries) {
    const file = path.join(REPO, "docs/projects", `${entry.id}.md`);
    assert.ok(existsSync(file), `catalog entry ${entry.id} has no page`);
  }
});

test("a project page names the path it is mounted at", () => {
  for (const project of registry.projects) {
    const text = readFileSync(path.join(REPO, "docs/projects", `${project.id}.md`), "utf8");
    const base = project.services?.[0]?.publicPath ?? `/${project.id}`;
    assert.ok(text.includes(base.replace(/\/$/, "")), `${project.id}.md never mentions ${base}`);
  }
});

test("the docs do not describe retired machinery in the present tense", () => {
  const files = [
    "README.md", "CONTRIBUTING.md", "AGENTS.md",
    "docs/PRODUCT.md", "docs/ARCHITECTURE.md", "docs/OPERATIONS.md",
  ];
  for (const file of files) {
    const text = readFileSync(path.join(REPO, file), "utf8");
    assert.ok(!/deploys to lightsail/i.test(text), `${file} still claims a Lightsail deployment`);
  }
});

test("the README lists every product", () => {
  const readme = readFileSync(path.join(REPO, "README.md"), "utf8");
  for (const entry of catalog.entries.filter((item) => item.kind === "project")) {
    assert.ok(readme.includes(entry.id), `README does not mention ${entry.id}`);
  }
});

test("every documentation page is reachable from the index", () => {
  const index = readFileSync(path.join(REPO, "docs/README.md"), "utf8");
  const pages = readdirSync(path.join(REPO, "docs"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name);
  for (const page of pages) {
    assert.ok(index.includes(`(${page})`), `docs/${page} is not linked from docs/README.md`);
  }
  for (const project of registry.projects) {
    assert.ok(index.includes(`projects/${project.id}.md`), `docs/projects/${project.id}.md is not in the index`);
  }
});

test("no page claims a project count that is no longer true", () => {
  const files = ["docs/README.md", "README.md", "docs/PRODUCT.md", "docs/ARCHITECTURE.md", "DESIGN.md"];
  for (const file of files) {
    const text = readFileSync(path.join(REPO, file), "utf8");
    assert.ok(!/(three|six) (projects|products)/i.test(text), `${file} still counts projects in words`);
  }
});
