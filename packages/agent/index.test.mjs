// The agent's rules, tested without a browser or a model.
import test from "node:test";
import assert from "node:assert/strict";

const { CAPABILITIES, validateTask, tokenMatches } = await import("./index.mjs");

test("only known intents are accepted", () => {
  assert.equal(validateTask({ intent: "llm.prompt", input: { prompt: "hi" } }).ok, true);
  assert.equal(validateTask({ intent: "project.status" }).ok, true);
  const unknown = validateTask({ intent: "shell.exec", input: { command: "rm -rf /" } });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.capabilities.includes("llm.prompt"));
});

test("each intent states what it needs", () => {
  assert.equal(validateTask({ intent: "llm.prompt", input: {} }).ok, false);
  assert.equal(validateTask({ intent: "page.capture", input: {} }).ok, false);
  assert.equal(validateTask({ intent: "page.capture", input: { url: "https://example.com" } }).ok, true);
});

test("the token comparison is exact and length-safe", () => {
  assert.equal(tokenMatches("abc123", "abc123"), true);
  assert.equal(tokenMatches("abc123", "abc124"), false);
  assert.equal(tokenMatches("abc123", "abc12"), false);
  assert.equal(tokenMatches("", ""), false);
  assert.equal(tokenMatches("abc123", ""), false);
});

test("capabilities are named, not free text", () => {
  for (const capability of CAPABILITIES) {
    assert.match(capability.intent, /^[a-z]+\.[a-z]+$/);
    assert.ok(capability.description.length > 10);
  }
});
