// The registry's rules, tested against manifests rather than the filesystem.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  SCHEMA, RESERVED, dataRoot, validateProject, projectRoutes, projectForPath, loadRegistry,
} from "./registry.mjs";

const valid = () => ({
  $schema: SCHEMA,
  id: "yoru",
  name: "yoru",
  version: "0.1.0",
  routes: [{ prefix: "/yoru", service: "app" }],
  services: [
    { id: "app", port: 25322, health: "/yoru/", start: { command: "node", args: ["x.mjs"] } },
  ],
});

test("a well-formed project validates", () => {
  assert.deepEqual(validateProject(valid()), { ok: true, errors: [] });
});

test("the platform's paths cannot be claimed", () => {
  for (const prefix of RESERVED) {
    const project = valid();
    project.routes = [{ prefix: prefix === "/" ? "/" : prefix, service: "app" }];
    const result = validateProject(project);
    assert.equal(result.ok, false, prefix);
  }
});

test("ids, ports and start commands are checked", () => {
  const project = valid();
  project.id = "Yoru";
  project.services[0].port = 25222;
  project.services[0].start = {};
  const { errors } = validateProject(project);
  assert.ok(errors.some((line) => line.includes("lowercase slug")));
  assert.ok(errors.some((line) => line.includes("front door")));
  assert.ok(errors.some((line) => line.includes("start command")));
});

test("a project with no services is invalid", () => {
  const project = valid();
  project.services = [];
  assert.equal(validateProject(project).ok, false);
});

test("routes flatten to the gateway's table, start spec included", () => {
  const routes = projectRoutes([valid()]);
  assert.deepEqual(routes, [{
    path: "/yoru", port: 25322, name: "yoru:app", project: "yoru", ws: false,
    start: "node x.mjs",
    startSpec: { command: "node", args: ["x.mjs"], env: {} },
  }]);
});

test("the project a path belongs to is the longest prefix", () => {
  const projects = [valid(), {
    ...valid(),
    id: "other",
    routes: [{ prefix: "/yoru-extra", service: "app" }],
  }];
  assert.equal(projectForPath(projects, "/yoru-extra/x").project, "other");
  assert.equal(projectForPath(projects, "/yoru/feed").project, "yoru");
  assert.equal(projectForPath(projects, "/nothing"), null);
});

test("the shipped yoru manifest is valid", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const { projects, invalid } = loadRegistry(root);
  assert.deepEqual(invalid, []);
  const yoru = projects.find((project) => project.id === "yoru");
  assert.ok(yoru, "projects/yoru/project.json must exist and validate");
  assert.ok(yoru.services.length >= 1);
});

test("the data root is per-platform", () => {
  assert.match(dataRoot({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }), /ayamai$/);
  assert.ok(dataRoot({ AYAMAI_DATA: "/tmp/ayamai" }) === "/tmp/ayamai");
});

test("a child project is found, named by its parent, and may not run a server", () => {
  
  const root = mkdtempSync(path.join(tmpdir(), "children-"));
  const parent = { $schema: SCHEMA, id: "gemu", services: [{ id: "app", port: 4660, start: { command: "node", args: ["x"] } }], routes: [{ prefix: "/gemu", service: "app" }] };
  mkdirSync(path.join(root, "projects/gemu/emulators/azahar"), { recursive: true });
  writeFileSync(path.join(root, "projects/gemu/project.json"), JSON.stringify(parent));
  writeFileSync(path.join(root, "projects/gemu/emulators/azahar/project.json"), JSON.stringify({ $schema: SCHEMA, id: "azahar", parent: "gemu", name: "azahar", kind: "source" }));
  const registry = loadRegistry(root);

  assert.deepEqual(registry.children.map((child) => child.displayId), ["gemu/azahar"]);
  assert.equal(registry.projects.length, 1);
  assert.equal(registry.invalid.length, 0);

  writeFileSync(path.join(root, "projects/gemu/emulators/azahar/project.json"), JSON.stringify({ $schema: SCHEMA, id: "azahar", parent: "ghost", name: "azahar", kind: "source" }));
  assert.ok(loadRegistry(root).invalid.some((entry) => entry.errors.some((error) => error.includes('parent "ghost" is not a project'))));

  writeFileSync(path.join(root, "projects/gemu/emulators/azahar/project.json"), JSON.stringify({ $schema: SCHEMA, id: "azahar", parent: "gemu", name: "azahar", kind: "source", services: [{ id: "app", port: 4999, start: { command: "node", args: ["x"] } }] }));
  assert.ok(loadRegistry(root).invalid.some((entry) => entry.errors.some((error) => error.includes("may not run a service"))));
});
