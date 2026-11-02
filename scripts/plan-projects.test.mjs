import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { mapProject, catalogIds } from "./plan-projects.mjs";

test("the old areas map to the projects that exist", () => {
  assert.equal(mapProject("box"), "yoru");
  assert.equal(mapProject("library"), "yoru");
  assert.equal(mapProject("product"), "yoru");
  assert.equal(mapProject("gb"), "ayamai");
  assert.equal(mapProject("tooling"), "ayamai");
});

test("catalog names pass through untouched", () => {
  const ids = catalogIds();
  assert.ok(ids.includes("platform"), "the real catalog is read");
  for (const id of ids) assert.equal(mapProject(id), null, `${id} is already right`);
  assert.equal(mapProject("ayamai"), "platform", "the platform's old name still maps");
});

test("unknown and empty names are left alone", () => {
  assert.equal(mapProject("something-else"), null);
  assert.equal(mapProject(""), null);
  assert.equal(mapProject(null), null);
});

test("applying twice relabels once", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "plan-projects-"));
  const env = { ...process.env, PLAN_DIR: dir };
  const plan = (args) => execFileSync(process.execPath, ["toys/plan/plan.mjs", ...args], { env, encoding: "utf8" });
  const migrate = (args) => execFileSync(process.execPath, ["scripts/plan-projects.mjs", ...args], { env, encoding: "utf8" });

  plan(["add", "one", "--project", "box"]);
  plan(["add", "two", "--project", "library"]);
  plan(["add", "three", "--project", "yoru"]);

  const first = migrate(["--apply"]);
  assert.match(first, /relabelled 2 item/);

  const projects = JSON.parse(plan(["list", "--all", "--json"])).map((item) => item.project).sort();
  assert.deepEqual(projects, ["yoru", "yoru", "yoru"]);

  const second = migrate([]);
  assert.match(second, /nothing to relabel/);
});
