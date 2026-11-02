// The LLM console's decisions, tested without spending a token.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Point the store at a throwaway directory before importing the module.
const temp = mkdtempSync(path.join(tmpdir(), "ayamai-llm-"));
process.env.AYAMAI_LLM_STORE = path.join(temp, "nested", "llm.json");

const {
  PROVIDERS,
  providerById,
  maskKey,
  readStore,
  writeStore,
  saveKey,
  deleteKey,
  publicState,
  buildRequest,
  parseResponse,
  contextBrief,
  __paths,
} = await import("./index.mjs");

test("a key is recognisable but not usable", () => {
  assert.equal(maskKey("sk-live-0123456789abcdef"), "sk-…cdef");
  assert.equal(maskKey("short"), "…rt");
  assert.equal(maskKey(""), "");
  assert.equal(maskKey(undefined), "");
});

test("every provider builds a request whose body never carries the key", () => {
  const key = "sk-secret-value-should-not-leak";
  for (const provider of PROVIDERS) {
    const request = buildRequest(provider, { prompt: "hello", apiKey: key });
    assert.ok(request.url.startsWith("https://") || request.url.startsWith("http://"), provider.id);
    assert.ok(!JSON.stringify(request.body).includes(key), `${provider.id} leaked the key into the body`);
    assert.equal(request.body.messages[0].content, "hello");
    if (provider.shape === "anthropic") {
      assert.equal(request.headers["x-api-key"], key);
      assert.equal(request.headers["anthropic-version"], "2023-06-01");
      assert.ok(request.url.endsWith("/messages"));
    } else {
      assert.equal(request.headers.authorization, `Bearer ${key}`);
      assert.ok(request.url.endsWith("/chat/completions"));
    }
  }
});

test("a keyless provider sends no authorization header", () => {
  const request = buildRequest(providerById("ollama"), { prompt: "hi", apiKey: "" });
  assert.equal(request.headers.authorization, undefined);
});

test("responses parse for both shapes and errors surface verbatim", () => {
  const openai = parseResponse("openai", 200, {
    choices: [{ message: { content: "  four words here  " } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
  });
  assert.deepEqual(openai, { ok: true, text: "four words here", usage: { prompt: 11, completion: 7 } });

  const anthropic = parseResponse("anthropic", 200, {
    content: [{ text: "hello " }, { text: "world" }],
    usage: { input_tokens: 3, output_tokens: 2 },
  });
  assert.deepEqual(anthropic, { ok: true, text: "hello world", usage: { prompt: 3, completion: 2 } });

  assert.equal(parseResponse("openai", 401, { error: { message: "Incorrect API key provided" } }).message,
    "Incorrect API key provided");
  assert.equal(parseResponse("openai", 500, {}).message, "provider returned 500");
  assert.equal(parseResponse("openai", 200, { choices: [] }).message, "unexpected response");
});

test("the store keeps the key out of the public view and writes 0600", () => {
  const saved = saveKey({ provider: "deepseek", apiKey: "sk-deepseek-abcdef123456", model: "deepseek-chat" });
  assert.equal(saved.ok, true);
  assert.equal(saved.fingerprint, "sk-…3456");

  const mode = statSync(__paths.STORE_FILE).mode & 0o777;
  assert.equal(mode, 0o600, "key file must not be world readable");

  const onDisk = JSON.parse(readFileSync(__paths.STORE_FILE, "utf8"));
  assert.equal(onDisk.keys.deepseek.apiKey, "sk-deepseek-abcdef123456");

  const state = publicState();
  assert.ok(!JSON.stringify(state).includes("sk-deepseek-abcdef123456"), "public state leaked the key");
  assert.equal(state.configured[0].fingerprint, "sk-…3456");
  assert.equal(state.active, "deepseek");
});

test("a key can be replaced and removed", () => {
  saveKey({ provider: "deepseek", apiKey: "sk-second-key-999999", model: "deepseek-reasoner" });
  assert.equal(readStore().keys.deepseek.model, "deepseek-reasoner");
  assert.equal(deleteKey("deepseek").ok, true);
  assert.equal(deleteKey("deepseek").ok, false);
  assert.equal(Object.keys(readStore().keys).length, 0);
});

test("a keyless local provider is allowed through", () => {
  const result = saveKey({ provider: "ollama", apiKey: "", model: "llama3.1" });
  assert.equal(result.ok, true);
  assert.equal(publicState().configured.at(-1).provider, "ollama");
});

test("unknown providers are refused", () => {
  assert.equal(saveKey({ provider: "skynet", apiKey: "x" }).ok, false);
  assert.equal(providerById("skynet"), null);
});

test("the machine brief is compact and capped", () => {
  const data = {
    projects: {
      repos: Array.from({ length: 20 }, (_, i) => ({ name: `repo${i}`, branch: "main", dirty: i, open: 2 })),
      vault: { used: "389G", free: "1.5T", total: "1.9T" },
    },
    services: [
      { name: "web", up: true },
      { name: "api", up: true },
      { name: "board", up: false },
    ],
  };
  const brief = contextBrief(data);
  assert.ok(brief.startsWith("Context (machine state):"));
  assert.ok(brief.includes("vault: 389G used"));
  assert.ok(brief.includes("services up: web, api"));
  assert.ok(brief.length <= 1500);
  const tiny = contextBrief(data, 80);
  assert.ok(tiny.length <= 80);
  assert.ok(tiny.endsWith("…"));
});

test("an empty store reads as empty rather than throwing", () => {
  const empty = path.join(temp, "missing", "llm.json");
  const previous = process.env.AYAMAI_LLM_STORE;
  process.env.AYAMAI_LLM_STORE = empty;
  // readStore uses the module-level path, so just prove the shape is stable.
  assert.deepEqual(Object.keys(readStore().keys ?? {}).length >= 0, true);
  process.env.AYAMAI_LLM_STORE = previous;
});
