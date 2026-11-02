// Synthetic-only gateway. The production Worker and application are unchanged.
import { handleMedia } from "../worker.mjs";
import { AUTHORITY, FIXTURE, HEADERS, MEDIA_ID, decodeTicket, fixtureStorage, json, monitor, readJson, ready, sameSecret } from "./protocol.mjs";

function privateCall(env, path, method = "POST", body) {
  return env.AUTHORITY.fetch(new Request(`${AUTHORITY}${path}`, {
    method, headers: { "X-Edge-Authorization": `Bearer ${env.CANARY_SERVICE_SECRET}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
}
async function record(env, details) {
  // This binding is private; telemetry is sent to the authority, not to a public URL.
  return privateCall(env, "/internal/record", "POST", details);
}
async function measuredMedia(request, env, ctx, transport) {
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { ...HEADERS, Allow: "GET, HEAD" } });
  const source = new URL(request.url);
  if (source.pathname !== `/${transport}/${MEDIA_ID}`) return new Response(null, { status: 404, headers: HEADERS });
  const ticket = source.searchParams.get("ticket");
  let runId;
  try { runId = (await decodeTicket(ticket, env.CANARY_TICKET_SECRET)).runId; }
  catch { return new Response(null, { status: 404, headers: HEADERS }); }
  let authMs = 0, apiBytes = 0, reads = 0;
  const storage = fixtureStorage(env.MEDIA);
  const measuredStorage = {
    head: async (key) => { reads++; return storage.head(key); },
    get: async (key, options) => { reads++; return storage.get(key, options); },
  };
  const fetcher = async (_url, init) => {
    const start = performance.now();
    const response = await privateCall(env, "/api/edge/media-authorize", "POST", JSON.parse(init.body));
    authMs += performance.now() - start;
    if (transport === "edge") apiBytes += new TextEncoder().encode(await response.clone().text()).length;
    return response;
  };
  // Relay uses a private API streaming response; edge uses the actual edge handler.
  if (transport === "relay") {
    return env.AUTHORITY.fetch(new Request(`${AUTHORITY}/internal/relay/${MEDIA_ID}${source.search}`, {
      method: request.method, headers: {
        "X-Edge-Authorization": `Bearer ${env.CANARY_SERVICE_SECRET}`,
        ...(request.headers.has("Range") ? { Range: request.headers.get("Range") } : {}),
      }, signal: request.signal,
    }));
  }
  const mapped = new URL(request.url); mapped.pathname = `/streams/${MEDIA_ID}`;
  const response = await handleMedia(new Request(mapped, request), {
    AUTH_API_ORIGIN: AUTHORITY, EDGE_SERVICE_SECRET: env.CANARY_SERVICE_SECRET, MEDIA: measuredStorage,
  }, fetcher);
  return monitor(response, ctx, stats => record(env, { runId, transport, authMs, apiBytes, reads, ...stats }));
}
export async function gateway(request, env, ctx) {
  if (!ready(env) || !env.AUTHORITY || !env.MEDIA || !(env.CANARY_TICKET_SECRET?.length >= 32)
    || !(env.CANARY_OPERATOR_SECRET?.length >= 32) || env.CANARY_TICKET_SECRET === env.CANARY_SERVICE_SECRET
    || [env.CANARY_TICKET_SECRET, env.CANARY_SERVICE_SECRET].includes(env.CANARY_OPERATOR_SECRET)) return json({ error: "Canary not configured" }, 503);
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
        return json({ privateIngress: upstream.ok, fixtureReady: !!object, bytes: object?.size ?? null, contentType: object?.httpMetadata?.contentType ?? null,
          bucket: env.CANARY_BUCKET, productionStack: false, workerCpuMs: null });
      }
      const actions = { "/control/run": "/internal/run", "/control/ticket": "/internal/ticket",
        "/control/state": "/internal/state", "/control/metrics": "/internal/metrics" };
      if (request.method !== "POST" || !actions[url.pathname]) return json({ error: "Not found" }, 404);
      return await privateCall(env, actions[url.pathname], "POST", await readJson(request));
    }
    if (!env.ASSETS || !["/", "/index.html", "/measure.js"].includes(url.pathname) || request.method !== "GET") return json({ error: "Not found" }, 404);
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    for (const [key, value] of Object.entries(HEADERS)) headers.set(key, value);
    headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    return new Response(asset.body, { status: asset.status, headers });
  } catch { return json({ error: "Canary unavailable" }, 503); }
}
export default { fetch: gateway };
