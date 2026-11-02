import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { draftPrompt, fold, load, nextId, parseDraft, record, validateCapture, draftIdea } from "./ideas.mjs";

const projects = [
  { id: "ayamai", kind: "platform", summary: "the ecosystem" },
  { id: "yoru", kind: "project", summary: "the media library" },
];

test("captures are validated before they are stored", () => {
  assert.equal(validateCapture({ text: "  " }).ok, false);
  assert.equal(validateCapture({ text: "x".repeat(2001) }).ok, false);
  assert.equal(validateCapture({ text: "ok", mode: "later" }).ok, false);
  assert.equal(validateCapture({ text: "ok", project: "Not A Slug" }).ok, false);
  assert.deepEqual(validateCapture({ text: "  an idea  " }), { ok: true, text: "an idea", project: "", mode: "quick" });
});

test("the store folds into ideas with their drafts and links", () => {
  const lines = [
    { t: "idea", id: 1, ts: "t", text: "first", mode: "quick", project: null },
    { t: "draft", id: 1, ts: "t", stories: [{ title: "a", project: "ayamai", priority: 2 }] },
    { t: "accept", id: 1, ts: "t", planIds: [7] },
    { t: "idea", id: 2, ts: "t", text: "second", mode: "quick" },
  ].map((event) => JSON.stringify(event)).join("\n");
  const ideas = fold(lines);
  assert.equal(ideas.get(1).status, "unpacked");
  assert.deepEqual(ideas.get(1).planIds, [7]);
  assert.equal(ideas.get(1).stories.length, 1);
  assert.equal(ideas.get(2).status, "seed");
  assert.equal(nextId(ideas), 3);
});

test("a malformed line does not take the inbox down", () => {
  const ideas = fold('{"t":"idea","id":1,"text":"kept"}\nnot json\n');
  assert.equal(ideas.size, 1);
});

test("records append and reload", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ideas-"));
  const file = path.join(dir, "ideas.jsonl");
  record(file, { t: "idea", id: 1, text: "kept" });
  record(file, { t: "archive", id: 1 });
  const ideas = load(file);
  assert.equal(ideas.get(1).status, "archived");
  assert.equal(load(path.join(dir, "missing.jsonl")).size, 0);
});

test("the parser accepts a bare object, fenced JSON and an array", () => {
  const bare = parseDraft('{"stories":[{"title":"one","project":"yoru","priority":2}]}', { projects: ["ayamai", "yoru"] });
  assert.equal(bare.stories.length, 1);
  const fenced = parseDraft('here you go:\n```json\n{"stories":[{"title":"two","project":"ayamai","priority":1}]}\n```', { projects: ["ayamai", "yoru"] });
  assert.equal(fenced.stories[0].title, "two");
  const array = parseDraft('[{"title":"three","project":"ayamai","priority":3}]', { projects: ["ayamai"] });
  assert.equal(array.stories[0].title, "three");
});

test("the parser drops what would not survive the plan tool", () => {
  const result = parseDraft(JSON.stringify({ stories: [
    { title: "", project: "ayamai", priority: 2 },
    { title: "unknown project", project: "nope", priority: 2 },
    { title: "bad priority", project: "ayamai", priority: 9 },
    { title: "x".repeat(130), project: "ayamai", priority: 2 },
    { title: "fine", project: "yoru", priority: 1 },
  ] }), { projects: ["ayamai", "yoru"] });
  assert.equal(result.stories.length, 1);
  assert.equal(result.stories[0].title, "fine");
  assert.equal(result.dropped.length, 4);
  assert.ok(result.dropped.some((item) => item.reason.includes("unknown project")));
});

test("the parser caps at six stories", () => {
  const many = Array.from({ length: 9 }, (_, index) => ({ title: `story ${index}`, project: "ayamai", priority: 2 }));
  assert.equal(parseDraft(JSON.stringify({ stories: many }), { projects: ["ayamai"] }).stories.length, 6);
});

test("prose instead of JSON is an error, not a crash", () => {
  const result = parseDraft("I think you should build three things.", { projects: ["ayamai"] });
  assert.equal(result.stories.length, 0);
  assert.equal(result.dropped[0].reason, "no JSON found");
});

test("draftIdea keeps the draft on success and writes nothing on failure", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ideas-draft-"));
  const file = path.join(dir, "ideas.jsonl");
  record(file, { t: "idea", id: 1, text: "an idea" });
  const idea = load(file).get(1);

  const ok = await draftIdea({ file, idea, projects, ask: async () => ({ ok: true, text: '{"stories":[{"title":"built","project":"yoru","priority":2,"body":"b"}]}' }) });
  assert.equal(ok.ok, true);
  assert.equal(load(file).get(1).stories.length, 1);

  const before = load(file).get(1).stories.length;
  const bad = await draftIdea({ file, idea, projects, ask: async () => ({ ok: true, text: "no json here" }) });
  assert.equal(bad.ok, false);
  assert.equal(load(file).get(1).stories.length, before, "a failed draft does not overwrite the last good one");
});

test("the prompt names the projects and demands JSON", () => {
  const prompt = draftPrompt({ idea: { text: "see which projects are quiet" }, projects });
  assert.ok(prompt.includes("ayamai"));
  assert.ok(prompt.includes("yoru"));
  assert.ok(prompt.includes("Reply with JSON only"));
});
