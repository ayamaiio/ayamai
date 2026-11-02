import test from "node:test";
import assert from "node:assert/strict";

import { buildRail, validateAction, visiblePlans } from "./lib.mjs";

const plans = [
  { id: 1, status: "todo", project: "yoru" },
  { id: 2, status: "doing", project: "yoru" },
  { id: 3, status: "done", project: "yoru" },
  { id: 4, status: "todo", project: "ayamai" },
  { id: 5, status: "todo", project: "" },
  { id: 6, status: "todo", project: "legacy" },
];

test("filters compose: project and status", () => {
  assert.equal(visiblePlans(plans, { project: "all", status: "all" }).length, 6);
  assert.equal(visiblePlans(plans, { project: "yoru", status: "all" }).length, 3);
  assert.equal(visiblePlans(plans, { project: "yoru", status: "doing" }).length, 1);
  assert.equal(visiblePlans(plans, { project: "other", status: "all" }).length, 1, "unassigned lands in other");
});

test("the rail counts open work per project, not history", () => {
  const rail = buildRail(plans, ["ayamai", "gehirn", "yoru", "seiri", "kata", "hisho"]);
  const byId = Object.fromEntries(rail.map((row) => [row.id, row.open]));
  assert.equal(byId.all, 5);
  assert.equal(byId.yoru, 2, "the done item does not count");
  assert.equal(byId.ayamai, 1);
  assert.equal(byId.hisho, 0);
  assert.ok(rail.some((row) => row.id === "other"), "unknown projects get a bucket");
});

test("claims are validated before any process starts", () => {
  assert.deepEqual(validateAction({ action: "claim", id: 3, by: "operator" }).argv, ["claim", "3", "--by", "operator", "--ttl", "30m"]);
  assert.equal(validateAction({ action: "claim", id: 0, by: "operator" }).ok, false);
  assert.equal(validateAction({ action: "claim", id: 3, by: "Operator" }).ok, false, "names are slugs");
  assert.equal(validateAction({ action: "claim", id: 3, by: "x", ttl: "soon" }).ok, false);
  assert.deepEqual(validateAction({ action: "release", id: 3 }).argv, ["release", "3"]);
  assert.equal(validateAction({ action: "nope" }).ok, false);
});
