import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { authority } from "./authority.mjs";
import { gateway } from "./gateway.mjs";
import { createGatewayRuntime } from "./gateway-runtime.mjs";
import { requestWithActivation } from "./provision.mjs";
import { BASELINE, BUCKET, FIXTURE, MAX_BYTES, MAX_GRANTS, MEDIA_ID, decodeTicket, fixtureStorage, issueTicket, monitor } from "./protocol.mjs";
import { checkReadiness } from "./readiness.mjs";

const file = name => readFileSync(new URL(name, import.meta.url), "utf8");
const apiConfig = JSON.parse(file("wrangler.authority.example.json"));
const gatewayConfig = JSON.parse(file("wrangler.gateway.example.json"));
test("activation waits for successful probe health to become ready without replaying ambiguous writes", async () => {
  for (const [path, status] of [["/control/health", 200], ["/control/run", 503]]) {
    let calls = 0;
    const response = await requestWithActivation(async () => {
      calls++;
      return new Response(null, { status: calls === 1 ? status : 200, headers: { "X-Canary-Phase": calls === 1 ? "probe" : "ready" } });
    }, { path, active: true, pause: async () => {} });
    assert.equal(calls, 2); assert.equal(response.status, 200);
  }
  for (const phase of ["ready", ""]) {
    let calls = 0;
    const response = await requestWithActivation(async () => {
      calls++; return new Response(null, { status: 503, headers: { "X-Canary-Phase": phase } });
    }, { path: "/control/run", active: true, pause: async () => {} });
    assert.equal(calls, 1); assert.equal(response.status, 503);
  }
});
test("provisioning rejects a short secret before accessing cloud services and never echoes it", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("provision.mjs", import.meta.url)), "--apply"], {
    env: { CANARY_OPERATOR_SECRET: "synthetic-short-input", PATH: process.env.PATH ?? "" }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /shorter than 32 characters/);
  assert.doesNotMatch(result.stderr + result.stdout, /synthetic-short-input/);
});
function setup() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(file("schema.sql"));
  const DB = { prepare(query) {
    const stmt = sql.prepare(query);
    const prepare = (...params) => ({
      bind: (...p) => prepare(...p),
      async first() { return stmt.get(...params) ?? null; },
      async all() { return { results: stmt.all(...params) }; },
      async run() { return stmt.run(...params); },
    });
    return prepare();
  } };
  let reads = 0;
  const data = new Uint8Array(2048).map((_, i) => i % 251);
  const MEDIA = {
    async head(key) {
      assert.equal(key, FIXTURE); reads++;
      return { size: data.length, httpMetadata: { contentType: "video/mp4" }, storageClass: "Standard" };
    },
    async get(key, options) {
      assert.equal(key, FIXTURE); reads++;
      const bytes = options?.range ? data.slice(options.range.offset, options.range.offset + options.range.length) : data;
      return { body: new Response(bytes).body };
    },
  };
  const waits = [];
  const ctx = { waitUntil: p => waits.push(p) };
  const env = { CANARY_ONLY: "synthetic-v1", CANARY_BUCKET: BUCKET,
    CANARY_SERVICE_SECRET: "synthetic-service-secret-".repeat(3),
    CANARY_TICKET_SECRET: "synthetic-ticket-secret-".repeat(3),
    CANARY_OPERATOR_SECRET: "synthetic-operator-secret-".repeat(3), DB, MEDIA };
  env.AUTHORITY = { fetch: req => authority(req, env, ctx) };
  env.ASSETS = { fetch: () => new Response("Synthetic harness") };
  const request = (path, { body, method = body ? "POST" : "GET", operator = true, headers = {} } = {}) =>
    gateway(new Request(`https://canary.example${path}`, { method,
      headers: { ...(operator ? { Authorization: `Bearer ${env.CANARY_OPERATOR_SECRET}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env, ctx);
  const control = async (action, body) => {
    const response = await request(`/control/${action}`, { body });
    assert.equal(response.status, 200); return response.json();
  };
  const flush = async () => { while (waits.length) await Promise.all(waits.splice(0)); };
  return { sql, env, request, control, flush, reads: () => reads };
}
async function runAndTicket(s) {
  const { runId } = await s.control("run", {});
  const { ticket } = await s.control("ticket", { runId });
  return { runId, path: transport => `/${transport}/${MEDIA_ID}?ticket=${encodeURIComponent(ticket)}` };
}

test("REST gateway stays locked during verification and serves only fixed assets when ready", async () => {
  const s = setup();
  const runtime = createGatewayRuntime({ html: "<h1>Synthetic</h1>", script: "// synthetic" });
  const call = (path, authorized = false) => runtime.fetch(new Request(`https://canary.example${path}`, {
    headers: authorized ? { Authorization: `Bearer ${s.env.CANARY_OPERATOR_SECRET}` } : {},
  }), s.env, { waitUntil: () => {} });
  for (const phase of [undefined, "probe", "unknown"]) {
    s.env.CANARY_DEPLOYMENT_PHASE = phase;
    assert.equal((await call("/")).status, 503);
    assert.equal((await call("/control/run", true)).status, 503);
    assert.equal((await call(`/edge/${MEDIA_ID}`, true)).status, 503);
    assert.equal((await call("/control/health")).status, 401);
  }
  const health = await call("/control/health", true);
  assert.equal((await health.json()).contentType, "video/mp4");
  s.env.CANARY_DEPLOYMENT_PHASE = "ready";
  const html = await call("/");
  assert.equal(html.status, 200);
  assert.equal(html.headers.get("X-Canary-Phase"), "ready");
  assert.equal(await html.text(), "<h1>Synthetic</h1>");
  assert.match(html.headers.get("Content-Security-Policy"), /script-src 'self'/);
  assert.equal(await (await call("/measure.js")).text(), "// synthetic");
  assert.equal((await call("/other-file")).status, 404);
  await s.flush(); s.sql.close();
});

test("schema is isolated SQLite/D1; public controls cannot mint tickets or read health", async () => {
  const s = setup();
  assert.equal((await s.request("/control/run", { body: {}, operator: false })).status, 401);
  assert.equal((await s.request("/control/health", { operator: false })).status, 401);
  assert.equal(s.reads(), 0);
  assert.equal(s.sql.prepare("SELECT count(*) AS n FROM canary_runs").get().n, 0);
  s.sql.close();
});
test("relay local authorization does not depend on Node-only Request initializer options", async () => {
  const NativeRequest = globalThis.Request;
  globalThis.Request = class extends NativeRequest {
    constructor(input, init) {
      if (String(input).endsWith("/api/edge/media-authorize") && init && !(init instanceof NativeRequest)) {
        assert.ok(!("redirect" in init) && !("cache" in init) && !("signal" in init));
      }
      super(input, init);
    }
  };
  const s = setup();
  try {
    const ticket = await runAndTicket(s);
    assert.equal((await s.request(ticket.path("relay"), { method: "HEAD" })).status, 200);
    await s.flush();
  } finally { globalThis.Request = NativeRequest; s.sql.close(); }
});
test("authority ingress requires private service authentication and healthy canary schema", async () => {
  const s = setup();
  assert.equal((await authority(new Request("https://api.invalid/internal/health"), s.env)).status, 503);
  const health = await s.control("health");
  assert.equal(health.privateIngress, true); assert.equal(health.fixtureReady, true);
  assert.equal(health.productionStack, false);
  s.env.CANARY_BUCKET = "rei";
  assert.equal((await s.request("/control/health")).status, 503);
  s.sql.close();
});
for (const transport of ["relay", "edge"]) {
  test(`${transport}: valid range, safe headers and repeat authorization`, async () => {
    const s = setup(), t = await runAndTicket(s);
    const response = await s.request(t.path(transport), { headers: { Range: "bytes=2-4" }, operator: false });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), "bytes 2-4/2048");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("ETag"), null);
    assert.equal(response.headers.get("Location"), null);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [2, 3, 4]);
    await s.flush();
    const metrics = await s.control("metrics", { runId: t.runId });
    assert.equal(metrics.counters[0].mediaBodyBytes, 3);
    assert.equal(metrics.counters[0].apiBodyBytes, transport === "relay" ? 3 : Buffer.byteLength(JSON.stringify({ objectKey: FIXTURE, contentType: "video/mp4" })));
    assert.equal(metrics.observations.length, 1);
    assert.equal(metrics.workerCpuMs, null);
    assert.equal(metrics.observations[0].r2Reads, 2);
    await s.control("state", { runId: t.runId, state: { ...BASELINE, public: false } });
    const before = s.reads(), denied = await s.request(t.path(transport), { method: "HEAD" });
    assert.equal(denied.status, 404); assert.equal(s.reads(), before);
    await s.flush(); s.sql.close();
  });
  test(`${transport}: malformed ranges and HEAD don't buffer a media body`, async () => {
    const s = setup(), t = await runAndTicket(s);
    const head = await s.request(t.path(transport), { method: "HEAD" });
    assert.equal(head.status, 200); assert.equal(await head.text(), "");
    for (const range of ["bytes=1-2,4-5", "bytes=999999-", "bytes=-0"]) {
      const response = await s.request(t.path(transport), { headers: { Range: range } });
      assert.equal(response.status, 416);
      assert.equal(response.headers.get("Content-Range"), "bytes */2048");
    }
    await s.flush(); s.sql.close();
  });
  test(`${transport}: all revocations invalidate the same old ticket without touching storage`, async () => {
    const s = setup(), t = await runAndTicket(s);
    for (const flag of Object.keys(BASELINE)) {
      await s.control("state", { runId: t.runId, state: { ...BASELINE, [flag]: !BASELINE[flag] } });
      const before = s.reads();
      assert.equal((await s.request(t.path(transport), { method: "HEAD" })).status, 404, flag);
      assert.equal(s.reads(), before);
      await s.control("state", { runId: t.runId, state: BASELINE });
      assert.equal((await s.request(t.path(transport), { method: "HEAD" })).status, 200);
    }
    await s.flush(); s.sql.close();
  });
  test(`${transport}: monthly budget fails closed before R2`, async () => {
    const s = setup(), t = await runAndTicket(s);
    s.sql.prepare("INSERT INTO canary_budget(month,grants) VALUES (?,?)").run(new Date().toISOString().slice(0, 7), MAX_GRANTS);
    assert.equal((await s.request(t.path(transport), { method: "HEAD" })).status, 503);
    assert.equal((await s.request("/control/health")).status, 503);
    assert.equal(s.reads(), 0); await s.flush(); s.sql.close();
  });
}
test("one run's synthetic state changes do not revoke a different run", async () => {
  const s = setup(), a = await runAndTicket(s), b = await runAndTicket(s);
  await s.control("state", { runId: a.runId, state: { ...BASELINE, deleted: true } });
  assert.equal((await s.request(a.path("edge"), { method: "HEAD" })).status, 404);
  assert.equal((await s.request(b.path("edge"), { method: "HEAD" })).status, 200);
  await s.flush(); s.sql.close();
});
test("concurrent requests cannot overspend the final monthly reservation", async () => {
  const s = setup(), t = await runAndTicket(s);
  s.sql.prepare("INSERT INTO canary_budget(month,grants) VALUES (?,?)").run(new Date().toISOString().slice(0, 7), MAX_GRANTS - 1);
  const responses = await Promise.all(["relay", "edge"].map(transport => s.request(t.path(transport), { method: "HEAD" })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 503]);
  assert.equal(s.reads(), 1);
  await s.flush(); s.sql.close();
});
test("tickets are isolated, encrypted, expiring and tamper-resistant", async () => {
  const secret = "only-a-synthetic-ticket-secret".repeat(3), runId = crypto.randomUUID();
  const ticket = await issueTicket(runId, secret, 1000);
  assert.ok(!ticket.includes(runId));
  assert.equal((await decodeTicket(ticket, secret, 1001)).runId, runId);
  await assert.rejects(decodeTicket(ticket, secret, 301000));
  await assert.rejects(decodeTicket(ticket + "a", secret, 1001));
  await assert.rejects(decodeTicket(ticket, "a-different-secret".repeat(4), 1001));
});
test("capability wrapper refuses every non-fixture locator and oversize/incorrect metadata", async () => {
  let reads = 0;
  const bucket = { head: async () => { reads++; return { size: MAX_BYTES + 1 }; }, get: async () => { reads++; } };
  const storage = fixtureStorage(bucket);
  await assert.rejects(storage.head("production/object"));
  await assert.rejects(storage.get("production/object"));
  assert.equal(reads, 0);
  await assert.rejects(storage.head(FIXTURE));
});
test("control origin/body limits and unexpected methods fail closed", async () => {
  const s = setup();
  assert.equal((await s.request("/control/run", { body: {}, headers: { Origin: "https://other.invalid" } })).status, 403);
  assert.equal((await s.request("/control/run", { body: { long: "a".repeat(5000) } })).status, 503);
  assert.equal((await s.request(`/edge/${MEDIA_ID}?ticket=missing`, { method: "POST" })).status, 405);
  assert.equal((await s.request("/")).headers.get("Content-Security-Policy").includes("media-src 'self'"), true);
  assert.equal(s.reads(), 0); s.sql.close();
});
test("private authority outages return a bounded failure on both transports and control actions", async () => {
  const s = setup(), t = await runAndTicket(s);
  s.env.AUTHORITY.fetch = async () => { throw new Error("Synthetic unreachable authority"); };
  for (const transport of ["relay", "edge"]) {
    const r = await s.request(t.path(transport));
    assert.equal(r.status, 503); await r.body?.cancel();
  }
  assert.equal((await s.request("/control/run", { body: {} })).status, 503);
  assert.equal(s.reads(), 0); await s.flush(); s.sql.close();
});
test("stream cancellation propagates and counts only application-emitted bytes", async () => {
  let cancelled = false, saved;
  const tasks = [], ctx = { waitUntil: p => tasks.push(p) };
  const source = new ReadableStream({
    pull(c) { c.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; },
  });
  const response = monitor(new Response(source), ctx, stats => { saved = stats; });
  const reader = response.body.getReader(); await reader.read(); await reader.cancel();
  await Promise.all(tasks);
  assert.equal(cancelled, true); assert.equal(saved.cancelled, true);
  assert.ok(saved.bytes >= 8);
});
function passingEvidence() {
  return { verifiedAt: new Date().toISOString(), workersPlan: "free",
    accountId: "00000000000000000000000000000001",
    permissions: { workersWrite: "verified", d1Write: "verified", r2BindingRead: "verified" },
    bucket: { name: BUCKET, managedPublic: false, customDomains: 0, storageClass: "Standard" },
    fixture: { key: FIXTURE, bytes: 1000, contentType: "video/mp4" },
    isolatedD1Id: "00000000-0000-4000-8000-000000000002",
    isolationReview: "verified", privateIngress: "verified", budgetApprovedUsd: 3,
    costReview: "verified", deploymentPermission: "explicitly-approved" };
}
test("deployment gate blocks an unverified plan regardless of other preparation progress", () => {
  const evidence = JSON.parse(file("readiness-evidence.json"));
  evidence.workersPlan = "unverified";
  const result = checkReadiness(evidence, apiConfig, gatewayConfig);
  assert.equal(result.deploymentAllowed, false);
  assert.ok(result.blockers.some(b => b.includes("Workers Free")));
  assert.ok(result.conservativeIncrementalUsd.total < 3);
});
test("gate rejects paid plans, stale evidence, public ingress, inherited settings and production bindings", () => {
  const e = passingEvidence(), a = structuredClone(apiConfig), g = structuredClone(gatewayConfig);
  a.d1_databases[0].database_id = e.isolatedD1Id;
  a.account_id = g.account_id = e.accountId;
  assert.equal(checkReadiness(e, a, g).deploymentAllowed, true);
  for (const change of [
    (e) => { e.workersPlan = "paid"; },
    (e) => { e.verifiedAt = "2020-01-01"; },
    (_, a) => { a.account_id = "00000000000000000000000000000002"; },
    (_, a) => { a.workers_dev = true; },
    (_, a) => { a.r2_buckets[0].bucket_name = "rei"; },
    (_, a) => { a.vars.DATABASE_URL = "forbidden"; },
    (_, a) => { a.routes = [{ pattern: "production.invalid/*" }]; },
    (_, a) => { a.d1_databases[0].database_name = "production"; },
    (_, a) => { a.d1_databases[0].preview_database_id = e.isolatedD1Id; },
    (_, a, g) => { g.services[0].service = "production-api"; },
  ]) {
    const copy = [structuredClone(e), structuredClone(a), structuredClone(g)];
    change(...copy);
    assert.equal(checkReadiness(...copy).deploymentAllowed, false);
  }
});
test("harness binds declared controls and does not persist secrets or export raw URLs", () => {
  const html = file("harness/index.html"), js = file("harness/measure.js");
  for (const [, id] of js.matchAll(/\$\("([^"]+)"\)/g)) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(!js.includes("localStorage") && !js.includes("sessionStorage"));
  assert.ok(js.includes("workerCpuMs: null"));
  assert.ok(js.includes('i < 30'));
  assert.ok(!file("authority.mjs").includes("@workspace/db"));
});
