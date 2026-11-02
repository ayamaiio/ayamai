// The plan store's first tests. They run against a scratch PLAN_DIR so the real
// backlog is never touched.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PLAN = path.resolve(import.meta.dirname, "plan.mjs");

function store() {
  const dir = mkdtempSync(path.join(tmpdir(), "plan-"));
  const run = (...args) => execFileSync(process.execPath, [PLAN, ...args], {
    env: { ...process.env, PLAN_DIR: dir }, encoding: "utf8",
  });
  return { dir, run, json: () => JSON.parse(run("list", "--all", "--json")) };
}

test("an item can be retired, and the body survives", () => {
  const { run, json } = store();
  run("add", "write the thing", "--body", "with a body", "--priority", "2");
  run("retire", "1", "--note", "retired 2026-11-02 — pre-foundation backlog");
  const [item] = json();
  assert.equal(item.status, "retired");
  assert.ok(item.body.includes("with a body"), "the original body is kept");
  assert.ok(item.body.includes("pre-foundation"), "the note is appended");
});

test("retired work is not open work", () => {
  const { run, json } = store();
  run("add", "one", "--priority", "1");
  run("add", "two", "--priority", "2");
  run("retire", "1");
  assert.equal(json().length, 2, "--all still shows it");
  const listed = run("list").trim();
  assert.ok(!listed.includes("#1"), "the default list hides it");
  assert.ok(listed.includes("#2"), "and keeps the live item");

  const next = run("next", "--by", "agent");
  assert.ok(next.includes("#2"), "the queue skips it");
});

test("retiring twice is a no-op, not a second event", () => {
  const { run, dir } = store();
  run("add", "once", "--priority", "3");
  run("retire", "1");
  const before = readFileSync(path.join(dir, "events.jsonl"), "utf8").trim().split("\n").length;
  assert.match(run("retire", "1"), /nothing to retire/);
  const after = readFileSync(path.join(dir, "events.jsonl"), "utf8").trim().split("\n").length;
  assert.equal(after, before, "no event was written");
});

test("retire --all takes the whole backlog, finished work included", () => {
  const { run, json } = store();
  run("add", "a", "--priority", "1");
  run("add", "b", "--priority", "2");
  run("set", "1", "--status", "done");
  run("retire", "--all");
  assert.equal(json().filter((i) => i.status === "retired").length, 2);
});

test("a follow-up is filed with where it came from", async () => {
  const { run, json, dir } = store();
  const batch = JSON.stringify([
    { title: "Spotify OAuth import", body: "seed taste", acceptance: "affinity shows", priority: 2, mode: "engineering" },
    { title: "YouTube search by name", priority: 2 },
  ]);
  const out = execFileSync(process.execPath, [PLAN, "followup", "--project", "uta"], {
    env: { ...process.env, PLAN_DIR: dir }, encoding: "utf8", input: batch,
  });
  assert.match(out, /2 filed/);

  const items = json();
  assert.equal(items.length, 2);
  const first = items[0];
  assert.equal(first.project, "uta");
  assert.equal(first.mode, "engineering");
  assert.equal(first.priority, 2);
  assert.ok(first.labels.includes("followup"), "the set is findable");
  assert.match(first.body, /Acceptance: affinity shows/);
  assert.match(first.body, /Raised by /);
});

test("filing the same follow-up twice is one item", async () => {
  const { dir } = store();
  const batch = JSON.stringify([{ title: "Only once please", project: "uta" }]);
  const run = () => execFileSync(process.execPath, [PLAN, "followup"], {
    env: { ...process.env, PLAN_DIR: dir }, encoding: "utf8", input: batch,
  });
  assert.match(run(), /1 filed/);
  assert.match(run(), /0 filed · 1 skipped/);
});

test("a retired follow-up can be filed again", () => {
  const { dir, run, json } = store();
  run("add", "Came back around", "--project", "uta");
  run("retire", "1");
  const batch = JSON.stringify([{ title: "Came back around", project: "uta" }]);
  const out = execFileSync(process.execPath, [PLAN, "followup"], {
    env: { ...process.env, PLAN_DIR: dir }, encoding: "utf8", input: batch,
  });
  assert.match(out, /1 filed/);
  assert.equal(json().filter((i) => i.status === "todo").length, 1);
});

test("one bad item refuses the whole batch", () => {
  const { dir, json } = store();
  const batch = JSON.stringify([
    { title: "fine", project: "uta" },
    { title: "typo", project: "utaa" },
  ]);
  assert.throws(() => execFileSync(process.execPath, [PLAN, "followup"], {
    env: { ...process.env, PLAN_DIR: dir }, encoding: "utf8", input: batch, stdio: "pipe",
  }));
  assert.equal(json().length, 0, "nothing was written");
});

test("--dry-run writes nothing", () => {
  const { dir, json } = store();
  const batch = JSON.stringify([{ title: "Just looking", project: "uta" }]);
  const out = execFileSync(process.execPath, [PLAN, "followup", "--dry-run"], {
    env: { ...process.env, PLAN_DIR: dir }, encoding: "utf8", input: batch,
  });
  assert.match(out, /would file/);
  assert.equal(json().length, 0);
});

test("two items with the same title in one batch make one item", () => {
  const { dir, json } = store();
  const batch = JSON.stringify([
    { title: "Same thing", project: "uta" },
    { title: "same thing!", project: "uta" },
  ]);
  execFileSync(process.execPath, [PLAN, "followup"], {
    env: { ...process.env, PLAN_DIR: dir }, encoding: "utf8", input: batch,
  });
  assert.equal(json().length, 1);
});
