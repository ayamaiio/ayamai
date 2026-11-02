// Retrieved from the approved isolated canary; secrets remain provider bindings.
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

// protocol.mjs
var FIXTURE = "benign-test-pattern.mp4";
var MEDIA_ID = "00000000-0000-4000-8000-000000000001";
var BUCKET = "ayamai-edge-canary";
var AUTHORITY = "https://canary-authority.invalid";
var MAX_BYTES = 16 * 1024 * 1024;
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
function un64(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid ticket");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
async function ticketKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Missing canary ticket secret");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ayamai-isolated-canary-v1:${secret}`));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
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

// gateway.mjs
function privateCall(env, path, method = "POST", body) {
  return env.AUTHORITY.fetch(new Request(`${AUTHORITY}${path}`, {
    method,
    headers: { "X-Edge-Authorization": `Bearer ${env.CANARY_SERVICE_SECRET}`, "Content-Type": "application/json" },
    ...body ? { body: JSON.stringify(body) } : {}
  }));
}
async function record(env, details) {
  return privateCall(env, "/internal/record", "POST", details);
}
async function measuredMedia(request, env, ctx, transport) {
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { ...HEADERS, Allow: "GET, HEAD" } });
  const source = new URL(request.url);
  if (source.pathname !== `/${transport}/${MEDIA_ID}`) return new Response(null, { status: 404, headers: HEADERS });
  const ticket = source.searchParams.get("ticket");
  let runId;
  try {
    runId = (await decodeTicket(ticket, env.CANARY_TICKET_SECRET)).runId;
  } catch {
    return new Response(null, { status: 404, headers: HEADERS });
  }
  let authMs = 0, apiBytes = 0, reads = 0;
  const storage = fixtureStorage(env.MEDIA);
  const measuredStorage = {
    head: async (key) => {
      reads++;
      return storage.head(key);
    },
    get: async (key, options) => {
      reads++;
      return storage.get(key, options);
    }
  };
  const fetcher = async (_url, init) => {
    const start = performance.now();
    const response2 = await privateCall(env, "/api/edge/media-authorize", "POST", JSON.parse(init.body));
    authMs += performance.now() - start;
    if (transport === "edge") apiBytes += new TextEncoder().encode(await response2.clone().text()).length;
    return response2;
  };
  if (transport === "relay") {
    return env.AUTHORITY.fetch(new Request(`${AUTHORITY}/internal/relay/${MEDIA_ID}${source.search}`, {
      method: request.method,
      headers: {
        "X-Edge-Authorization": `Bearer ${env.CANARY_SERVICE_SECRET}`,
        ...request.headers.has("Range") ? { Range: request.headers.get("Range") } : {}
      },
      signal: request.signal
    }));
  }
  const mapped = new URL(request.url);
  mapped.pathname = `/streams/${MEDIA_ID}`;
  const response = await handleMedia(new Request(mapped, request), {
    AUTH_API_ORIGIN: AUTHORITY,
    EDGE_SERVICE_SECRET: env.CANARY_SERVICE_SECRET,
    MEDIA: measuredStorage
  }, fetcher);
  return monitor(response, ctx, (stats) => record(env, { runId, transport, authMs, apiBytes, reads, ...stats }));
}
async function gateway(request, env, ctx) {
  if (!ready(env) || !env.AUTHORITY || !env.MEDIA || !(env.CANARY_TICKET_SECRET?.length >= 32) || !(env.CANARY_OPERATOR_SECRET?.length >= 32) || env.CANARY_TICKET_SECRET === env.CANARY_SERVICE_SECRET || [env.CANARY_TICKET_SECRET, env.CANARY_SERVICE_SECRET].includes(env.CANARY_OPERATOR_SECRET)) return json({ error: "Canary not configured" }, 503);
  const url = new URL(request.url);
  try {
    if (/^\/(edge|relay)\//.test(url.pathname)) {
      return await measuredMedia(request, env, ctx, url.pathname.split("/")[1]);
    }
    if (url.pathname.startsWith("/control/")) {
      if (!await sameSecret(request.headers.get("Authorization")?.replace(/^Bearer /, ""), env.CANARY_OPERATOR_SECRET)) return json({ error: "Unauthorized" }, 401);
      if (request.headers.has("Origin") && request.headers.get("Origin") !== url.origin) return json({ error: "Origin denied" }, 403);
      if (url.pathname === "/control/health" && request.method === "GET") {
        const upstream = await privateCall(env, "/internal/health", "GET");
        if (!upstream.ok) return json({ privateIngress: false, fixtureReady: false }, 503);
        const marker = await upstream.json();
        if (marker.isolated !== true || marker.schemaReady !== true) return json({ privateIngress: false, fixtureReady: false }, 503);
        const object = await fixtureStorage(env.MEDIA).head(FIXTURE);
        return json({
          privateIngress: upstream.ok,
          fixtureReady: !!object,
          bytes: object?.size ?? null,
          contentType: object?.httpMetadata?.contentType ?? null,
          bucket: env.CANARY_BUCKET,
          productionStack: false,
          workerCpuMs: null
        });
      }
      const actions = {
        "/control/run": "/internal/run",
        "/control/ticket": "/internal/ticket",
        "/control/state": "/internal/state",
        "/control/metrics": "/internal/metrics"
      };
      if (request.method !== "POST" || !actions[url.pathname]) return json({ error: "Not found" }, 404);
      return await privateCall(env, actions[url.pathname], "POST", await readJson(request));
    }
    if (!env.ASSETS || !["/", "/index.html", "/measure.js"].includes(url.pathname) || request.method !== "GET") return json({ error: "Not found" }, 404);
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    for (const [key, value] of Object.entries(HEADERS)) headers.set(key, value);
    headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    return new Response(asset.body, { status: asset.status, headers });
  } catch {
    return json({ error: "Canary unavailable" }, 503);
  }
}

// gateway-runtime.mjs
function createGatewayRuntime(assets) {
  return {
    async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      if (env.CANARY_DEPLOYMENT_PHASE !== "ready" && path !== "/control/health") {
        return new Response("Canary verification in progress.", {
          status: 503,
          headers: { ...HEADERS, "X-Canary-Phase": "probe" }
        });
      }
      const response = await gateway(request, {
        ...env,
        ASSETS: {
          fetch: async (req) => {
            const name = new URL(req.url).pathname === "/measure.js" ? "script" : "html";
            return new Response(assets[name], {
              headers: { "Content-Type": name === "script" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" }
            });
          }
        }
      }, ctx);
      const headers = new Headers(response.headers);
      headers.set("X-Canary-Phase", env.CANARY_DEPLOYMENT_PHASE === "ready" ? "ready" : "probe");
      return new Response(response.body, { status: response.status, headers });
    }
  };
}

// gateway-entry.mjs
var gateway_entry_default = createGatewayRuntime({ "html": '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ayamai \xB7 Isolated Safari canary</title></head>\n<body>\n<h1>Isolated iPhone Safari canary</h1>\n<p>Benign synthetic fixture only. Not the application Library. No production data. Android is deferred.</p>\n<p>This compares a Cloudflare relay-shaped API with edge delivery. It is not a performance measurement of the production PostgreSQL API.</p>\n<label>Canary operator secret <input id="secret" type="password" autocomplete="off"></label>\n<button id="connect">Check ingress and start isolated run</button>\n<fieldset id="controls" disabled>\n<legend>Physical-device measurements</legend>\n<label><input id="physical" type="checkbox">I am operating a physical iPhone in Safari, not an emulator.</label>\n<p><label>Network <select id="network"><option value="wifi">Wi-Fi \xB7 disable cellular</option><option value="cellular">Cellular \xB7 disable Wi-Fi</option></select></label>\n<label>Transport <select id="transport"><option value="relay">Relay-shaped API</option><option value="edge">Edge Worker</option></select></label></p>\n<p>Confirm network in iOS Settings before each batch. Network labels are operator declarations; the browser cannot prove the radio used. Keep Safari foregrounded and disable Low Power Mode for comparable results.</p>\n<button id="startup">Collect 30 startup attempts</button>\n<button id="swipe">Collect 30 swipe-to-ready attempts</button>\n<button id="stop">Stop and retain partial results</button>\n<button id="checks">Check ranges, seeks, cancellation and revocation</button>\n</fieldset>\n<p id="status" role="status">Not connected. Preparation does not mean deployed or tested.</p>\n<video id="player" muted playsinline controls preload="none" width="280"></video>\n<p><button id="export" disabled>Download sanitized evidence JSON</button></p>\n<pre id="summary"></pre>\n<script type="module" src="/measure.js"><\/script>\n</body></html>\n', "script": 'const $ = id => document.getElementById(id);\nconst BASELINE = { public: true, removed: false, deleted: false, rights: true,\n  viewerAccepted: true, publisherAccepted: true, viewerBlocksPublisher: false, publisherBlocksViewer: false };\nlet secret = "", runId = "", busy = false, stopped = false, interrupted = false;\nlet video = $("player");\nconst results = { schema: "ayamai-safari-canary-v1", productionStack: false, samples: [], checks: [],\n  workerCpuMs: null, workerCpuSource: "NOT_MEASURED", physicalEvidence: "operator-declared-not-independently-proven",\n  notes: ["Times start at source assignment; ticket issuance measured separately.",\n    "Byte counters are application response bodies, not TLS, radio or invoice bytes.",\n    "No raw media URLs, tickets, account identifiers or operator credentials are exported."] };\nfunction status(text) { $("status").textContent = text; }\nasync function control(action, body) {\n  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);\n  try {\n    const r = await fetch(`/control/${action}`, { method: body ? "POST" : "GET",\n      headers: { Authorization: `Bearer ${secret}`, ...(body ? { "Content-Type": "application/json" } : {}) },\n      ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: controller.signal });\n    if (!r.ok) throw new Error(`Control ${action}: HTTP ${r.status}`);\n    return await r.json();\n  } finally { clearTimeout(timeout); }\n}\nfunction detach() { video.pause(); video.removeAttribute("src"); video.load(); }\nfunction requireDevice() {\n  if (!$("physical").checked || !/iPhone/.test(navigator.userAgent) || !/Safari/.test(navigator.userAgent)\n    || /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent)) throw new Error("Use physical iPhone Safari and confirm the device checkbox.");\n  if (document.hidden) throw new Error("Keep Safari foregrounded.");\n}\nfunction session() { return { network: $("network").value, transport: $("transport").value }; }\nfunction percentiles(values) {\n  const v = values.filter(Number.isFinite).sort((a, b) => a - b);\n  return v.length ? { median: v[Math.floor(v.length / 2)], p95: v[Math.ceil(v.length * .95) - 1] } : null;\n}\nfunction summary() {\n  const groups = {};\n  for (const s of results.samples.filter(s => s.phase !== "warmup")) {\n    const key = `${s.network}/${s.transport}/${s.phase}`;\n    (groups[key] ??= []).push(s);\n  }\n  return Object.fromEntries(Object.entries(groups).map(([k, rows]) => {\n    const successes = rows.filter(r => r.ok);\n    return [k, { attempts: rows.length, successes: successes.length, failures: rows.length - successes.length,\n      sufficient: successes.length >= 30, readyMs: percentiles(successes.map(s => s.readyMs)),\n      playingMs: percentiles(successes.map(s => s.playingMs)) }];\n  }));\n}\nasync function ticketUrl(transport) {\n  const t = performance.now(), data = await control("ticket", { runId });\n  return { url: `/${transport}/${data.id}?ticket=${encodeURIComponent(data.ticket)}`, ticketMs: performance.now() - t };\n}\nasync function sample(phase, context) {\n  const entry = { ...context, phase, at: new Date().toISOString(), ok: false };\n  let remove = () => {};\n  try {\n    if (stopped || interrupted) throw new Error("interrupted");\n    const { url, ticketMs } = await ticketUrl(context.transport);\n    entry.ticketMs = ticketMs;\n    if (phase === "startup") detach();\n    if (phase === "startup") {\n      const replacement = document.createElement("video");\n      replacement.id = "player"; replacement.muted = true; replacement.playsInline = true;\n      replacement.controls = true; replacement.preload = "none"; replacement.width = 280;\n      video.replaceWith(replacement); video = replacement;\n    }\n    const t = performance.now();\n    await new Promise((resolve, reject) => {\n      let ready = false, playing = false;\n      const done = () => { if (ready && playing) resolve(); };\n      const canplay = () => { if (!ready) entry.readyMs = performance.now() - t; ready = true; done(); };\n      const onplaying = () => { if (!playing) entry.playingMs = performance.now() - t; playing = true; done(); };\n      const error = () => reject(new Error(`media-error-${video.error?.code ?? "unknown"}`));\n      const timer = setTimeout(() => reject(new Error("ready-or-playback-timeout")), 15_000);\n      const watchdog = setInterval(() => { if (stopped || interrupted) reject(new Error("interrupted")); }, 100);\n      remove = () => {\n        clearTimeout(timer); clearInterval(watchdog);\n        video.removeEventListener("canplay", canplay); video.removeEventListener("playing", onplaying);\n        video.removeEventListener("error", error);\n      };\n      video.addEventListener("canplay", canplay); video.addEventListener("playing", onplaying);\n      video.addEventListener("error", error);\n      video.src = url;\n      video.play().catch(() => reject(new Error("play-rejected-tap-player-and-retry")));\n    });\n    remove();\n    await new Promise(r => setTimeout(r, 250));\n    entry.playbackAdvanced = video.currentTime > 0 && !video.paused;\n    entry.ok = entry.playbackAdvanced && !interrupted && !stopped;\n    if (!entry.ok) entry.failure = "no-foreground-playback";\n    if (phase === "startup") detach();\n    await new Promise(r => setTimeout(r, 25));\n    const perf = performance.getEntriesByType("resource").filter(p => p.name === new URL(url, location.origin).href).at(-1);\n    entry.browserEncodedBodyBytes = perf?.encodedBodySize ?? null;\n    entry.browserTransferBytes = perf?.transferSize ?? null;\n  } catch (error) {\n    entry.failure = ["interrupted", "ready-or-playback-timeout", "play-rejected-tap-player-and-retry"].includes(error.message)\n      || /^media-error-/.test(error.message) ? error.message : "control-or-media-failure";\n  } finally { remove(); if (!entry.ok || phase === "startup") detach(); performance.clearResourceTimings(); }\n  results.samples.push(entry);\n  $("summary").textContent = JSON.stringify(summary(), null, 2);\n  return entry;\n}\nasync function batch(phase) {\n  if (busy) return;\n  try {\n    requireDevice(); busy = true; stopped = false; interrupted = false;\n    const context = session();\n    $("network").disabled = $("transport").disabled = true;\n    if (phase === "swipe") {\n      const warm = await sample("warmup", context);\n      if (!warm.ok) throw new Error("Warmup failed. Check controls and retry.");\n    }\n    for (let i = 0; i < 30 && !stopped && !interrupted; i++) {\n      status(`${context.network} / ${context.transport} / ${phase}: attempt ${i + 1} of 30`);\n      await sample(phase, context);\n    }\n    status("Batch retained. At least 30 successful samples per scenario/phase are required; failures remain in the report.");\n  } catch (e) { status(e.message); }\n  finally { detach(); busy = false; $("network").disabled = $("transport").disabled = false; }\n}\ndocument.addEventListener("visibilitychange", () => { if (busy && document.hidden) { interrupted = true; detach(); } });\n$("connect").onclick = async () => {\n  if (busy) return;\n  try {\n    secret = $("secret").value; $("secret").value = "";\n    const health = await control("health");\n    if (!health.privateIngress || !health.fixtureReady) throw new Error("Private ingress or fixture not ready.");\n    runId = (await control("run", {})).runId;\n    results.startedAt = new Date().toISOString();\n    results.fixtureBytes = health.bytes;\n    results.userAgent = navigator.userAgent;\n    $("controls").disabled = false; $("export").disabled = false; $("connect").disabled = true;\n    status("Connected to isolated synthetic run. Verify physical device and network before measuring.");\n  } catch (e) { status(e.message); }\n};\n$("startup").onclick = () => batch("startup");\n$("swipe").onclick = () => batch("swipe");\n$("stop").onclick = () => { stopped = true; detach(); status("Stopped; partial observations retained."); };\nasync function transportCheck(url, method = "GET", range) {\n  const response = await fetch(url, { method, ...(range ? { headers: { Range: range } } : {}), cache: "no-store", redirect: "error" });\n  const output = { status: response.status, range: response.headers.get("Content-Range"),\n    length: response.headers.get("Content-Length"), acceptRanges: response.headers.get("Accept-Ranges") };\n  await response.body?.cancel();\n  return output;\n}\n$("checks").onclick = async () => {\n  if (busy) return;\n  try {\n    requireDevice(); busy = true; stopped = false; interrupted = false;\n    const context = session();\n    for (const transport of ["relay", "edge"]) {\n      if (stopped || interrupted) throw new Error("interrupted");\n      const { url } = await ticketUrl(transport);\n      const head = await transportCheck(url, "HEAD");\n      results.checks.push({ ...context, transport, kind: "HEAD", ...head, passed: head.status === 200 });\n      for (const range of ["bytes=0-511", "bytes=512-", "bytes=-128", "bytes=999999999999-", "bytes=1-2,4-5"]) {\n        if (stopped || interrupted) throw new Error("interrupted");\n        const r = await transportCheck(url, "GET", range);\n        const expected = range.includes(",") || range.includes("999999") ? 416 : 206;\n        results.checks.push({ ...context, transport, kind: "range", requestedRange: range, ...r,\n          passed: r.status === expected && !!r.range });\n      }\n      const response = await fetch(url, { cache: "no-store" });\n      const reader = response.body.getReader(); const first = await reader.read(); await reader.cancel();\n      results.checks.push({ ...context, transport, kind: "cancellation", firstChunkBytes: first.value?.byteLength ?? 0,\n        clientCancelled: true, upstreamCancellationVerified: false });\n      const flags = ["public", "removed", "deleted", "rights", "viewerAccepted", "publisherAccepted", "viewerBlocksPublisher", "publisherBlocksViewer"];\n      for (const flag of flags) {\n        if (stopped || interrupted) throw new Error("interrupted");\n        await control("state", { runId, state: { ...BASELINE, [flag]: !BASELINE[flag] } });\n        const denied = await transportCheck(url, "HEAD");\n        results.checks.push({ ...context, transport, kind: "old-ticket-revocation", flag, status: denied.status, passed: denied.status === 404 });\n        await control("state", { runId, state: BASELINE });\n        const restored = await transportCheck(url, "HEAD");\n        results.checks.push({ ...context, transport, kind: "restored-state", flag, status: restored.status, passed: restored.status === 200 });\n      }\n      await sample("warmup", { ...context, transport });\n      detach();\n      const seekUrl = (await ticketUrl(transport)).url;\n      const seek = await new Promise(resolve => {\n        const timer = setTimeout(() => finish(false), 15_000);\n        const finish = ok => { clearTimeout(timer); video.removeEventListener("loadedmetadata", metadata);\n          video.removeEventListener("seeked", sought); resolve(ok); };\n        const metadata = () => { video.currentTime = Math.min(video.duration / 2, 2); };\n        const sought = () => finish(video.currentTime > 0);\n        video.addEventListener("loadedmetadata", metadata); video.addEventListener("seeked", sought);\n        video.src = seekUrl;\n        video.load();\n      });\n      results.checks.push({ ...context, transport, kind: "seek", passed: seek });\n      detach();\n    }\n    status("Functional checks retained. Review individual failures and collect provider CPU evidence separately.");\n  } catch { status("Functional check interrupted or unavailable; partial results retained."); }\n  finally {\n    detach();\n    try { await control("state", { runId, state: BASELINE }); } catch { status("Could not restore synthetic state. Start a fresh isolated run."); }\n    busy = false;\n  }\n};\n$("export").onclick = async () => {\n  if (busy) { status("Stop the batch before exporting."); return; }\n  try {\n    let page = await control("metrics", { runId }), observations = [...page.observations];\n    for (let i = 0; page.nextCursor !== null && i < 49; i++) {\n      page = await control("metrics", { runId, cursor: page.nextCursor });\n      observations.push(...page.observations);\n    }\n    results.server = { ...page, observations, truncated: page.nextCursor !== null };\n  }\n  catch { results.server = { unavailable: true }; }\n  const report = { ...results, summary: summary(), exportedAt: new Date().toISOString(),\n    completed: false, reason: "Operator must review four scenarios, functional checks and provider CPU/byte evidence." };\n  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));\n  const link = document.createElement("a"); link.href = url; link.download = "ayamai-iphone-canary.json"; link.click();\n  setTimeout(() => URL.revokeObjectURL(url), 30_000);\n};\n' });
export {
  gateway_entry_default as default
};
