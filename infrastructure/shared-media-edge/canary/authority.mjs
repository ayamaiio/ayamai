// Isolated synthetic authority. No imports of the application DB, Clerk or secrets.
import { BASELINE, FIXTURE, HEADERS, MAX_GRANTS, MEDIA_ID, decodeTicket, eligible, fixtureStorage, issueTicket, json, monitor, readJson, ready, sameSecret } from "./protocol.mjs";
import { handleMedia } from "../worker.mjs";

async function reserve(env) {
  const month = new Date().toISOString().slice(0, 7);
  await env.DB.prepare("INSERT INTO canary_budget(month, grants) VALUES (?, 0) ON CONFLICT(month) DO NOTHING").bind(month).run();
  return env.DB.prepare("UPDATE canary_budget SET grants = grants + 1 WHERE month = ? AND grants < ? RETURNING grants").bind(month, MAX_GRANTS).first();
}
async function writeMetric(env, data) {
  const valid = ["edge", "relay"].includes(data.transport) && /^[0-9a-f-]{36}$/.test(data.runId)
    && [data.status, data.bytes, data.apiBytes, data.reads].every(n => Number.isSafeInteger(n) && n >= 0)
    && Number.isFinite(data.authMs) && data.authMs >= 0 && typeof data.cancelled === "boolean";
  if (!valid) return json({ error: "Invalid metrics" }, 400);
  await env.DB.prepare(`INSERT INTO canary_metrics(run_id, transport, status, auth_ms,
    api_body_bytes, media_body_bytes, r2_reads, cancelled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(data.runId, data.transport, data.status, data.authMs, data.apiBytes, data.bytes, data.reads, Number(data.cancelled)).run();
  return json({ recorded: true });
}

export async function authority(request, env, ctx = { waitUntil: () => {} }) {
  if (!ready(env) || !env.DB || env.CANARY_TICKET_SECRET?.length < 32
    || !env.CANARY_TICKET_SECRET || env.CANARY_TICKET_SECRET === env.CANARY_SERVICE_SECRET || !await sameSecret(
    request.headers.get("X-Edge-Authorization")?.replace(/^Bearer /, ""), env.CANARY_SERVICE_SECRET)) return json({ error: "Unavailable" }, 503);
  const path = new URL(request.url).pathname;
  try {
    if (path === "/internal/health" && request.method === "GET") {
      if (!await reserve(env)) return json({ error: "Canary budget exhausted" }, 503);
      const marker = await env.DB.prepare("SELECT count(*) AS n FROM canary_runs").first();
      return json({ isolated: true, schemaReady: Number.isInteger(marker.n) });
    }
    if (path === "/internal/run" && request.method === "POST") {
      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO canary_runs(id, expires_ms, state) VALUES (?, ?, ?)").bind(id, Date.now() + 7_200_000, JSON.stringify(BASELINE)).run();
      return json({ runId: id });
    }
    if (path === `/internal/relay/${MEDIA_ID}` && ["GET", "HEAD"].includes(request.method)) {
      const source = new URL(request.url);
      const { runId } = await decodeTicket(source.searchParams.get("ticket"), env.CANARY_TICKET_SECRET);
      let authMs = 0, reads = 0;
      const storage = fixtureStorage(env.MEDIA);
      const mapped = new URL(request.url); mapped.pathname = `/streams/${MEDIA_ID}`;
      const response = await handleMedia(new Request(mapped, request), {
        AUTH_API_ORIGIN: "https://canary-authority.invalid", EDGE_SERVICE_SECRET: env.CANARY_SERVICE_SECRET,
        MEDIA: {
          head: async key => { reads++; return storage.head(key); },
          get: async (key, options) => { reads++; return storage.get(key, options); },
        },
      }, async (_url, init) => {
        const start = performance.now();
        // This is a local dispatch, not a network fetch. Workers Request accepts
        // a narrower initializer than Node: do not forward fetch-only options
        // such as redirect:error/cache/signal into this synthetic Request.
        const response = await authority(new Request("https://canary-authority.invalid/api/edge/media-authorize", {
          method: init.method, headers: init.headers, body: init.body,
        }), env, ctx);
        authMs += performance.now() - start;
        return response;
      });
      return monitor(response, ctx, stats => writeMetric(env, {
        runId, transport: "relay", authMs, reads, apiBytes: stats.bytes, ...stats,
      }));
    }
    const body = request.method === "GET" ? {} : await readJson(request);
    if (path === "/internal/record" && request.method === "POST") return await writeMetric(env, body);
    if (path === "/api/edge/media-authorize" && request.method === "POST") {
      if (body.id !== MEDIA_ID) return new Response(null, { status: 404, headers: HEADERS });
      const ticket = await decodeTicket(body.ticket, env.CANARY_TICKET_SECRET);
      const run = await env.DB.prepare("SELECT * FROM canary_runs WHERE id = ?").bind(ticket.runId).first();
      if (!run || run.expires_ms <= Date.now() || !eligible(JSON.parse(run.state))) return new Response(null, { status: 404, headers: HEADERS });
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
      if (!state || Object.keys(state).length !== Object.keys(BASELINE).length
        || Object.keys(BASELINE).some(k => typeof state[k] !== "boolean")) return json({ error: "Invalid synthetic state" }, 400);
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
        r2_reads AS r2Reads, cancelled FROM canary_metrics WHERE run_id = ? AND id > ? ORDER BY id LIMIT 201`)
        .bind(body.runId, cursor).all();
      const observations = raw.results.slice(0, 200);
      return json({ counters: rows.results, observations, nextCursor: raw.results.length > 200 ? observations.at(-1).id : null,
        workerCpuMs: null, accounting: "Application emitted bytes only; excludes control/telemetry/request bodies and browser-received, wire or invoice bytes." });
    }
    return json({ error: "Method not allowed" }, 405);
  } catch { return json({ error: "Unavailable" }, 503); }
}
export default { fetch: authority };
