// Retrieved from the approved isolated canary; secrets remain provider bindings.
// protocol.mjs
var FIXTURE = "benign-test-pattern.mp4";
var MEDIA_ID = "00000000-0000-4000-8000-000000000001";
var BUCKET = "ayamai-edge-canary";
var MAX_BYTES = 16 * 1024 * 1024;
var MAX_GRANTS = 1e4;
var BASELINE = Object.freeze({
  public: true,
  removed: false,
  deleted: false,
  rights: true,
  viewerAccepted: true,
  publisherAccepted: true,
  viewerBlocksPublisher: false,
  publisherBlocksViewer: false
});
var HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...HEADERS, "Content-Type": "application/json" } });
}
function ready(env) {
  return env.CANARY_ONLY === "synthetic-v1" && env.CANARY_BUCKET === BUCKET && env.CANARY_SERVICE_SECRET?.length >= 32;
}
async function sameSecret(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string" || expected.length < 32 || actual.length > 256) return false;
  const encode = (s) => new TextEncoder().encode(s);
  const key = await crypto.subtle.importKey("raw", encode(expected), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, encode(expected));
  return crypto.subtle.verify("HMAC", key, signature, encode(actual));
}
async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  let length = 0;
  const chunks = [];
  try {
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const result = JSON.parse(new TextDecoder().decode(bytes) || "{}");
  if (!result || Array.isArray(result) || typeof result !== "object") throw new Error("Invalid JSON");
  return result;
}
var b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
function un64(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid ticket");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
async function ticketKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Missing canary ticket secret");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ayamai-isolated-canary-v1:${secret}`));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function issueTicket(runId, secret, now = Date.now()) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await ticketKey(secret),
    new TextEncoder().encode(JSON.stringify({ runId, id: MEDIA_ID, expires: now + 3e5 }))
  );
  return `${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
async function decodeTicket(ticket, secret, now = Date.now()) {
  if (typeof ticket !== "string" || ticket.length > 1024 || ticket.split(".").length !== 2) throw new Error("Invalid ticket");
  const [iv, body] = ticket.split(".").map(un64);
  if (iv.length !== 12) throw new Error("Invalid ticket");
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await ticketKey(secret), body);
  const data = JSON.parse(new TextDecoder().decode(raw));
  if (data.id !== MEDIA_ID || !/^[0-9a-f-]{36}$/.test(data.runId) || !Number.isSafeInteger(data.expires) || data.expires <= now || data.expires > now + 3e5) throw new Error("Expired or invalid ticket");
  return data;
}
function eligible(state) {
  return Object.keys(BASELINE).every((k) => typeof state[k] === "boolean") && state.public && !state.removed && !state.deleted && state.rights && state.viewerAccepted && state.publisherAccepted && !state.viewerBlocksPublisher && !state.publisherBlocksViewer;
}
function fixtureStorage(binding) {
  const check = (key) => {
    if (key !== FIXTURE) throw new Error("Not a synthetic fixture");
  };
  return {
    async head(key) {
      check(key);
      const item = await binding.head(key);
      if (item && (!Number.isSafeInteger(item.size) || item.size <= 0 || item.size > MAX_BYTES || item.httpMetadata?.contentType !== "video/mp4" || item.storageClass && item.storageClass !== "Standard")) throw new Error("Invalid fixture metadata");
      return item;
    },
    async get(key, options) {
      check(key);
      return binding.get(key, options);
    }
  };
}
function monitor(response, ctx, save) {
  let bytes = 0, ended = false;
  const finish = (cancelled) => {
    if (ended) return;
    ended = true;
    ctx.waitUntil(Promise.resolve(save({ status: response.status, bytes, cancelled })).catch(() => {
    }));
  };
  const headers = new Headers(response.headers);
  if (!response.body) {
    finish(false);
    return new Response(null, { status: response.status, headers });
  }
  const reader = response.body.getReader();
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish(false);
          controller.close();
        } else {
          bytes += value.byteLength;
          controller.enqueue(value);
        }
      } catch {
        finish(true);
        controller.error(new Error("Stream interrupted"));
      }
    },
    async cancel(reason) {
      finish(true);
      await reader.cancel(reason);
    }
  }), { status: response.status, headers });
}

// ../worker.mjs
var safeHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};
function failure(status, extra = {}) {
  return new Response(null, { status, headers: { ...safeHeaders, ...extra } });
}
function byteRange(value, size) {
  if (value === null) return null;
  if (value.length > 80 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(value) || size === 0) throw new Error("Invalid range");
  const [first, last] = value.slice(6).split("-");
  let start, end;
  if (first === "") {
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Error("Invalid suffix");
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(first);
    end = last === "" ? size - 1 : Number(last);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw new Error("Invalid range");
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}
async function handleMedia(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method)) return failure(405, { Allow: "GET, HEAD" });
  const match = /^\/streams\/([0-9a-f-]{36})$/i.exec(url.pathname);
  const ticket = url.searchParams.get("ticket");
  if (!match || !ticket || ticket.length > 2048 || url.searchParams.getAll("ticket").length !== 1 || [...url.searchParams.keys()].some((key) => key !== "ticket")) return failure(404);
  try {
    const api = new URL(env.AUTH_API_ORIGIN);
    if (api.protocol !== "https:" || api.pathname !== "/" || api.username || api.password || api.search || api.hash || !env.EDGE_SERVICE_SECRET || env.EDGE_SERVICE_SECRET.length < 32 || !env.MEDIA) return failure(503);
    const auth = await fetcher(`${api.origin}/api/edge/media-authorize`, {
      method: "POST",
      headers: { "X-Edge-Authorization": `Bearer ${env.EDGE_SERVICE_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: match[1], ticket }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5e3)])
    });
    if (!auth.ok) return failure(auth.status === 404 ? 404 : 503);
    const grant = await auth.json();
    if (typeof grant.objectKey !== "string" || !grant.objectKey || typeof grant.contentType !== "string" || !/^(image|video)\/[a-z0-9.+-]+$/i.test(grant.contentType)) return failure(503);
    const object = await env.MEDIA.head(grant.objectKey);
    if (!object) return failure(404);
    if (!Number.isSafeInteger(object.size) || object.size < 0) return failure(503);
    let range;
    try {
      range = byteRange(request.headers.get("Range"), object.size);
    } catch {
      return failure(416, { "Content-Range": `bytes */${object.size}`, "Accept-Ranges": "bytes" });
    }
    const headers = {
      ...safeHeaders,
      "Accept-Ranges": "bytes",
      "Content-Type": grant.contentType,
      "Content-Disposition": 'inline; filename="media"',
      "Content-Length": String(range ? range.length : object.size)
    };
    if (range) headers["Content-Range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`;
    if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
    const body = await env.MEDIA.get(grant.objectKey, range ? { range } : void 0);
    if (!body) return failure(404);
    if (!body.body) return failure(503);
    return new Response(body.body, { status: range ? 206 : 200, headers });
  } catch {
    return failure(503);
  }
}

// authority.mjs
async function reserve(env) {
  const month = (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
  await env.DB.prepare("INSERT INTO canary_budget(month, grants) VALUES (?, 0) ON CONFLICT(month) DO NOTHING").bind(month).run();
  return env.DB.prepare("UPDATE canary_budget SET grants = grants + 1 WHERE month = ? AND grants < ? RETURNING grants").bind(month, MAX_GRANTS).first();
}
async function writeMetric(env, data) {
  const valid = ["edge", "relay"].includes(data.transport) && /^[0-9a-f-]{36}$/.test(data.runId) && [data.status, data.bytes, data.apiBytes, data.reads].every((n) => Number.isSafeInteger(n) && n >= 0) && Number.isFinite(data.authMs) && data.authMs >= 0 && typeof data.cancelled === "boolean";
  if (!valid) return json({ error: "Invalid metrics" }, 400);
  await env.DB.prepare(`INSERT INTO canary_metrics(run_id, transport, status, auth_ms,
    api_body_bytes, media_body_bytes, r2_reads, cancelled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(data.runId, data.transport, data.status, data.authMs, data.apiBytes, data.bytes, data.reads, Number(data.cancelled)).run();
  return json({ recorded: true });
}
async function authority(request, env, ctx = { waitUntil: () => {
} }) {
  if (!ready(env) || !env.DB || env.CANARY_TICKET_SECRET?.length < 32 || !env.CANARY_TICKET_SECRET || env.CANARY_TICKET_SECRET === env.CANARY_SERVICE_SECRET || !await sameSecret(
    request.headers.get("X-Edge-Authorization")?.replace(/^Bearer /, ""),
    env.CANARY_SERVICE_SECRET
  )) return json({ error: "Unavailable" }, 503);
  const path = new URL(request.url).pathname;
  try {
    if (path === "/internal/health" && request.method === "GET") {
      if (!await reserve(env)) return json({ error: "Canary budget exhausted" }, 503);
      const marker = await env.DB.prepare("SELECT count(*) AS n FROM canary_runs").first();
      return json({ isolated: true, schemaReady: Number.isInteger(marker.n) });
    }
    if (path === "/internal/run" && request.method === "POST") {
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO canary_runs(id, expires_ms, state) VALUES (?, ?, ?)").bind(id, Date.now() + 72e5, JSON.stringify(BASELINE)).run();
      return json({ runId: id });
    }
    if (path === `/internal/relay/${MEDIA_ID}` && ["GET", "HEAD"].includes(request.method)) {
      const source = new URL(request.url);
      const { runId } = await decodeTicket(source.searchParams.get("ticket"), env.CANARY_TICKET_SECRET);
      let authMs = 0, reads = 0;
      const storage = fixtureStorage(env.MEDIA);
      const mapped = new URL(request.url);
      mapped.pathname = `/streams/${MEDIA_ID}`;
      const response = await handleMedia(new Request(mapped, request), {
        AUTH_API_ORIGIN: "https://canary-authority.invalid",
        EDGE_SERVICE_SECRET: env.CANARY_SERVICE_SECRET,
        MEDIA: {
          head: async (key) => {
            reads++;
            return storage.head(key);
          },
          get: async (key, options) => {
            reads++;
            return storage.get(key, options);
          }
        }
      }, async (_url, init) => {
        const start = performance.now();
        const response2 = await authority(new Request("https://canary-authority.invalid/api/edge/media-authorize", {
          method: init.method,
          headers: init.headers,
          body: init.body
        }), env, ctx);
        authMs += performance.now() - start;
        return response2;
      });
      return monitor(response, ctx, (stats) => writeMetric(env, {
        runId,
        transport: "relay",
        authMs,
        reads,
        apiBytes: stats.bytes,
        ...stats
      }));
    }
    const body = request.method === "GET" ? {} : await readJson(request);
    if (path === "/internal/record" && request.method === "POST") return await writeMetric(env, body);
    if (path === "/api/edge/media-authorize" && request.method === "POST") {
      if (body.id !== MEDIA_ID) return new Response(null, { status: 404, headers: HEADERS });
      const ticket = await decodeTicket(body.ticket, env.CANARY_TICKET_SECRET);
      const run2 = await env.DB.prepare("SELECT * FROM canary_runs WHERE id = ?").bind(ticket.runId).first();
      if (!run2 || run2.expires_ms <= Date.now() || !eligible(JSON.parse(run2.state))) return new Response(null, { status: 404, headers: HEADERS });
      const reserved = await reserve(env);
      if (!reserved) return new Response(null, { status: 503, headers: HEADERS });
      return json({ objectKey: FIXTURE, contentType: "video/mp4" });
    }
    if (!["/internal/ticket", "/internal/state", "/internal/metrics"].includes(path)) return json({ error: "Not found" }, 404);
    if (typeof body.runId !== "string") return json({ error: "Missing run" }, 400);
    const run = await env.DB.prepare("SELECT * FROM canary_runs WHERE id = ?").bind(body.runId).first();
    if (!run || run.expires_ms <= Date.now()) return json({ error: "Run expired" }, 404);
    if (path === "/internal/ticket" && request.method === "POST") {
      return json({ id: MEDIA_ID, ticket: await issueTicket(body.runId, env.CANARY_TICKET_SECRET), expiresInSeconds: 300 });
    }
    if (path === "/internal/state" && request.method === "POST") {
      const state = body.state;
      if (!state || Object.keys(state).length !== Object.keys(BASELINE).length || Object.keys(BASELINE).some((k) => typeof state[k] !== "boolean")) return json({ error: "Invalid synthetic state" }, 400);
      await env.DB.prepare("UPDATE canary_runs SET state = ? WHERE id = ?").bind(JSON.stringify(state), body.runId).run();
      return json({ updated: true });
    }
    if (path === "/internal/metrics" && request.method === "POST") {
      const rows = await env.DB.prepare(`SELECT transport, count(*) AS requests, sum(api_body_bytes) AS apiBodyBytes,
        sum(media_body_bytes) AS mediaBodyBytes, sum(r2_reads) AS r2Reads,
        sum(cancelled) AS cancellations, max(auth_ms) AS maxAuthMs
        FROM canary_metrics WHERE run_id = ? GROUP BY transport`).bind(body.runId).all();
      const cursor = Number.isSafeInteger(body.cursor) && body.cursor >= 0 ? body.cursor : 0;
      const raw = await env.DB.prepare(`SELECT id, transport, status, auth_ms AS authMs,
        api_body_bytes AS apiBodyBytes, media_body_bytes AS mediaBodyBytes,
        r2_reads AS r2Reads, cancelled FROM canary_metrics WHERE run_id = ? AND id > ? ORDER BY id LIMIT 201`).bind(body.runId, cursor).all();
      const observations = raw.results.slice(0, 200);
      return json({
        counters: rows.results,
        observations,
        nextCursor: raw.results.length > 200 ? observations.at(-1).id : null,
        workerCpuMs: null,
        accounting: "Application emitted bytes only; excludes control/telemetry/request bodies and browser-received, wire or invoice bytes."
      });
    }
    return json({ error: "Method not allowed" }, 405);
  } catch {
    return json({ error: "Unavailable" }, 503);
  }
}
var authority_default = { fetch: authority };
export {
  authority,
  authority_default as default
};
