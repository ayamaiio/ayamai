// Keys on disk, one request at a time, no SDK.
//
// Everything here is either pure (tested) or a single fetch. The key is read
// from .local/llm.json in-process and never leaves the machine except as an
// Authorization header toward the provider.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_DIR = process.env.AYAMAI_DATA
  ? path.join(process.env.AYAMAI_DATA, "llm")
  : path.join(process.env.AYAMAI_REPO ?? path.resolve(import.meta.dirname, "../.."), ".local");
// The only override, so tests can own a throwaway store.
const STORE_FILE = process.env.AYAMAI_LLM_STORE ?? path.join(DEFAULT_DIR, "llm.json");
const STORE_DIR = path.dirname(STORE_FILE);
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_ANSWER = 200 * 1024;
const TIMEOUT_MS = 90_000;
const MAX_CONTEXT = 1500;

/** Provider catalog. Anything OpenAI-compatible works by editing the base URL. */
export const PROVIDERS = [
  { id: "deepseek", name: "deepseek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat", shape: "openai", keyed: true },
  { id: "openai", name: "openai", baseURL: "https://api.openai.com/v1", model: "gpt-4o-mini", shape: "openai", keyed: true },
  { id: "anthropic", name: "anthropic", baseURL: "https://api.anthropic.com/v1", model: "claude-sonnet-4-5", shape: "anthropic", keyed: true },
  { id: "openrouter", name: "openrouter", baseURL: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-chat", shape: "openai", keyed: true },
  { id: "groq", name: "groq", baseURL: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", shape: "openai", keyed: true },
  { id: "ollama", name: "ollama", baseURL: "http://127.0.0.1:11434/v1", model: "llama3.1", shape: "openai", keyed: false },
];

export function providerById(id) {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** `sk-…a1b2` — enough to recognise a key, not enough to use it. */
export function maskKey(apiKey) {
  const key = String(apiKey ?? "");
  if (!key) return "";
  if (key.length <= 8) return `…${key.slice(-2)}`;
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export function readStore() {
  try {
    const parsed = JSON.parse(readFileSync(STORE_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    parsed.keys = parsed.keys && typeof parsed.keys === "object" ? parsed.keys : {};
    return parsed;
  } catch {
    return {};
  }
}

export function writeStore(store) {
  mkdirSync(STORE_DIR, { recursive: true, mode: DIR_MODE });
  try { chmodSync(STORE_DIR, DIR_MODE); } catch { /* best effort */ }
  const temp = `${STORE_FILE}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(store, null, 2), { mode: FILE_MODE });
  renameSync(temp, STORE_FILE);
  try { chmodSync(STORE_FILE, FILE_MODE); } catch { /* best effort */ }
}

/** What the page is allowed to know. Never the key. */
export function publicState(store = readStore()) {
  const configured = Object.entries(store.keys ?? {}).map(([provider, entry]) => ({
    provider,
    model: entry.model ?? "",
    baseURL: entry.baseURL ?? "",
    fingerprint: maskKey(entry.apiKey),
    addedAt: entry.addedAt ?? null,
    lastOk: entry.lastOk ?? null,
    lastError: entry.lastError ?? null,
  }));
  return {
    providers: PROVIDERS.map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseURL: provider.baseURL,
      model: provider.model,
      keyed: provider.keyed,
    })),
    configured,
    active: store.active ?? configured[0]?.provider ?? null,
    recent: (store.recent ?? []).slice(-8).reverse(),
  };
}

export function saveKey({ provider, apiKey, baseURL, model }) {
  const entry = providerById(provider);
  if (!entry) return { ok: false, code: 400, message: `unknown provider: ${provider}` };
  const key = String(apiKey ?? "").trim();
  if (entry.keyed && !key) return { ok: false, code: 400, message: "no key given" };
  const store = readStore();
  store.keys = store.keys ?? {};
  store.keys[provider] = {
    apiKey: key,
    baseURL: String(baseURL ?? entry.baseURL).trim(),
    model: String(model ?? entry.model).trim(),
    addedAt: new Date().toISOString(),
    lastOk: store.keys[provider]?.lastOk ?? null,
  };
  store.active = provider;
  writeStore(store);
  return { ok: true, code: 200, message: "stored", fingerprint: maskKey(key) };
}

export function markVerified(provider, ok, message = "") {
  const store = readStore();
  const entry = store.keys?.[provider];
  if (!entry) return;
  entry.lastOk = ok ? new Date().toISOString() : false;
  entry.lastError = ok ? null : String(message).slice(0, 200);
  writeStore(store);
}

export function deleteKey(provider) {
  const store = readStore();
  if (!store.keys?.[provider]) return { ok: false, code: 404, message: "no key stored" };
  delete store.keys[provider];
  if (store.active === provider) store.active = Object.keys(store.keys)[0] ?? null;
  writeStore(store);
  return { ok: true, code: 200, message: "removed" };
}

/** Pure: the HTTP request for a provider, so the key can be proven absent from the body. */
export function buildRequest(provider, { prompt, model, temperature = 0.7, maxTokens = 1024, apiKey = "" }) {
  const shape = provider.shape ?? "openai";
  const base = String(provider.baseURL ?? "").replace(/\/+$/, "");
  const body = shape === "anthropic"
    ? {
        model: model ?? provider.model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }
    : {
        model: model ?? provider.model,
        temperature,
        max_tokens: maxTokens,
        stream: false,
        messages: [{ role: "user", content: prompt }],
      };
  const headers = { "content-type": "application/json" };
  if (shape === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const url = shape === "anthropic" ? `${base}/messages` : `${base}/chat/completions`;
  return { url, headers, body };
}

/** Pure: pull text and usage out of either shape, or surface the provider's error. */
export function parseResponse(shape, status, payload) {
  if (payload && typeof payload === "object" && payload.error) {
    const message = typeof payload.error === "string" ? payload.error : payload.error.message;
    return { ok: false, message: String(message ?? "provider error").slice(0, 400) };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, message: `provider returned ${status}` };
  }
  if (shape === "anthropic") {
    const text = Array.isArray(payload?.content)
      ? payload.content.map((part) => part?.text ?? "").join("").trim()
      : "";
    if (!text) return { ok: false, message: "unexpected response" };
    return {
      ok: true,
      text,
      usage: { prompt: payload?.usage?.input_tokens ?? 0, completion: payload?.usage?.output_tokens ?? 0 },
    };
  }
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) return { ok: false, message: "unexpected response" };
  return {
    ok: true,
    text: text.trim(),
    usage: { prompt: payload?.usage?.prompt_tokens ?? 0, completion: payload?.usage?.completion_tokens ?? 0 },
  };
}

/** A compact machine brief, capped so nobody sends a paragraph by accident. */
export function contextBrief(data, limit = MAX_CONTEXT) {
  const lines = [];
  if (data?.projects?.repos) {
    lines.push("repos:");
    for (const repo of data.projects.repos.slice(0, 8)) {
      const dirty = repo.dirty ? `${repo.dirty} uncommitted` : "clean";
      const open = repo.open >= 0 ? `${repo.open} open` : "no plan";
      lines.push(`- ${repo.name}: ${repo.branch}, ${dirty}, ${open}`);
    }
  }
  if (data?.projects?.vault) {
    const vault = data.projects.vault;
    lines.push(`vault: ${vault.used} used, ${vault.free} free of ${vault.total}`);
  }
  if (data?.services) {
    const up = data.services.filter((service) => service.up).map((service) => service.name);
    const down = data.services.filter((service) => !service.up).map((service) => service.name);
    lines.push(`services up: ${up.join(", ") || "none"}`);
    if (down.length) lines.push(`services down: ${down.join(", ")}`);
  }
  const text = `Context (machine state):\n${lines.join("\n")}`;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** One call. Never throws; returns something the HTTP layer can serialize. */
export async function runPrompt({ providerId, prompt, model, temperature, maxTokens, apiKey, baseURL, timeout = TIMEOUT_MS }) {
  const started = Date.now();
  const provider = providerById(providerId) ?? { shape: "openai", baseURL, model };
  const effective = {
    shape: provider.shape ?? "openai",
    baseURL: baseURL ?? provider.baseURL,
    model: model ?? provider.model,
  };
  const request = buildRequest(effective, { prompt, model, temperature, maxTokens, apiKey });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeout);
  let host = "the provider";
  try { host = new URL(request.url).host; } catch { /* keep the default */ }

  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: abort.signal,
    });
    const raw = await response.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch { payload = null; }
    const parsed = payload
      ? parseResponse(effective.shape, response.status, payload)
      : { ok: false, message: `unexpected response: ${raw.slice(0, 200)}` };
    const ms = Date.now() - started;
    if (!parsed.ok) return { ok: false, ms, status: response.status, message: parsed.message };
    return {
      ok: true,
      ms,
      status: response.status,
      text: parsed.text.slice(0, MAX_ANSWER),
      truncated: parsed.text.length > MAX_ANSWER,
      usage: parsed.usage,
      model: request.body.model,
    };
  } catch (error) {
    const ms = Date.now() - started;
    if (abort.signal.aborted) return { ok: false, ms, message: `no answer after ${Math.round(timeout / 1000)}s` };
    const message = String(error?.cause?.code ?? error?.message ?? error);
    return { ok: false, ms, message: /fetch failed/i.test(message) ? `could not reach ${host}` : message };
  } finally {
    clearTimeout(timer);
  }
}

/** Append the outcome to the rolling log the panel shows. */
export function noteRun(store, entry) {
  store.recent = [...(store.recent ?? []), entry].slice(-20);
  writeStore(store);
}

export const __paths = { STORE_FILE, STORE_DIR };
