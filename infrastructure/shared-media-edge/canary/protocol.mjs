export const FIXTURE = "benign-test-pattern.mp4";
export const MEDIA_ID = "00000000-0000-4000-8000-000000000001";
export const BUCKET = "ayamai-edge-canary";
export const AUTHORITY = "https://canary-authority.invalid";
export const MAX_BYTES = 16 * 1024 * 1024;
export const MAX_GRANTS = 10_000;
export const BASELINE = Object.freeze({
  public: true, removed: false, deleted: false, rights: true,
  viewerAccepted: true, publisherAccepted: true,
  viewerBlocksPublisher: false, publisherBlocksViewer: false,
});
export const HEADERS = {
  "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...HEADERS, "Content-Type": "application/json" } });
}
export function ready(env) {
  return env.CANARY_ONLY === "synthetic-v1" && env.CANARY_BUCKET === BUCKET
    && env.CANARY_SERVICE_SECRET?.length >= 32;
}
export async function sameSecret(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string" || expected.length < 32 || actual.length > 256) return false;
  const encode = (s) => new TextEncoder().encode(s);
  const key = await crypto.subtle.importKey("raw", encode(expected), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, encode(expected));
  return crypto.subtle.verify("HMAC", key, signature, encode(actual));
}
export async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); throw new Error("Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const result = JSON.parse(new TextDecoder().decode(bytes) || "{}");
  if (!result || Array.isArray(result) || typeof result !== "object") throw new Error("Invalid JSON");
  return result;
}
const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
function un64(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid ticket");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
}
async function ticketKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Missing canary ticket secret");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ayamai-isolated-canary-v1:${secret}`));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function issueTicket(runId, secret, now = Date.now()) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await ticketKey(secret),
    new TextEncoder().encode(JSON.stringify({ runId, id: MEDIA_ID, expires: now + 300_000 })));
  return `${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
export async function decodeTicket(ticket, secret, now = Date.now()) {
  if (typeof ticket !== "string" || ticket.length > 1024 || ticket.split(".").length !== 2) throw new Error("Invalid ticket");
  const [iv, body] = ticket.split(".").map(un64);
  if (iv.length !== 12) throw new Error("Invalid ticket");
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await ticketKey(secret), body);
  const data = JSON.parse(new TextDecoder().decode(raw));
  if (data.id !== MEDIA_ID || !/^[0-9a-f-]{36}$/.test(data.runId) || !Number.isSafeInteger(data.expires)
    || data.expires <= now || data.expires > now + 300_000) throw new Error("Expired or invalid ticket");
  return data;
}
export function eligible(state) {
  return Object.keys(BASELINE).every(k => typeof state[k] === "boolean")
    && state.public && !state.removed && !state.deleted && state.rights
    && state.viewerAccepted && state.publisherAccepted
    && !state.viewerBlocksPublisher && !state.publisherBlocksViewer;
}
// A capability wrapper: even a mistaken grant cannot read another bucket key.
export function fixtureStorage(binding) {
  const check = (key) => { if (key !== FIXTURE) throw new Error("Not a synthetic fixture"); };
  return {
    async head(key) {
      check(key);
      const item = await binding.head(key);
      if (item && (!Number.isSafeInteger(item.size) || item.size <= 0 || item.size > MAX_BYTES
        || item.httpMetadata?.contentType !== "video/mp4" || (item.storageClass && item.storageClass !== "Standard"))) throw new Error("Invalid fixture metadata");
      return item;
    },
    async get(key, options) { check(key); return binding.get(key, options); },
  };
}
export function monitor(response, ctx, save) {
  let bytes = 0, ended = false;
  const finish = (cancelled) => {
    if (ended) return;
    ended = true;
    ctx.waitUntil(Promise.resolve(save({ status: response.status, bytes, cancelled })).catch(() => {}));
  };
  const headers = new Headers(response.headers);
  if (!response.body) { finish(false); return new Response(null, { status: response.status, headers }); }
  const reader = response.body.getReader();
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { finish(false); controller.close(); }
        else { bytes += value.byteLength; controller.enqueue(value); }
      } catch { finish(true); controller.error(new Error("Stream interrupted")); }
    },
    async cancel(reason) { finish(true); await reader.cancel(reason); },
  }), { status: response.status, headers });
}
