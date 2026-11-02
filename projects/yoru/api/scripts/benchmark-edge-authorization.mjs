// Local HTTP + real development PostgreSQL. Never contacts R2 or a deployed Worker.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import * as database from "../../../lib/db/src/index.ts";
import edgeRouter from "../src/routes/edge-media.ts";
import { sharedStreamMedia } from "../src/lib/shared-delivery.ts";
import { createMediaTicket } from "../src/lib/media-tickets.ts";
import { handleMedia } from "../../../infrastructure/shared-media-edge/worker.mjs";

const { db, pool, mediaItemsTable: media, socialAccountsTable: accounts } = database;
const users = Array.from({ length: 65 }, () => `capacity-synthetic-${randomUUID()}`);
const oldSecret = process.env.SHARED_MEDIA_EDGE_SECRET;
process.env.SHARED_MEDIA_EDGE_SECRET = randomUUID(); // Ephemeral, never emitted.
const app = express(); app.use(express.json()); app.use("/api", edgeRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.on("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const fixture = new Uint8Array(4096); // Benign bytes; this is not a decode test.
let queries = 0, r2Reads = 0;
const restores = [];
for (const p of [pool, database.mediaAuthorizationPool].filter(Boolean)) {
  const original = p.query;
  p.query = function (...args) { queries++; return original.apply(this, args); };
  restores.push(() => { p.query = original; });
}
const env = {
  AUTH_API_ORIGIN: "https://synthetic-authority.invalid", EDGE_SERVICE_SECRET: process.env.SHARED_MEDIA_EDGE_SECRET,
  MEDIA: {
    head: async () => { r2Reads++; return { size: fixture.length }; },
    get: async (_key, options) => { r2Reads++; const r = options?.range;
      return { body: new ReadableStream({ start(c) { c.enqueue(r ? fixture.slice(r.offset, r.offset + r.length) : fixture); c.close(); } }) }; },
  },
};
const report = { model: "Local actual Worker handler + Express authorization + development PostgreSQL; synthetic accounts and in-memory benign R2 adapter. Not geographic, production or physical-device capacity.", results: [] };
const percentile = (v, p) => +[...v].sort((a, b) => a - b)[Math.ceil(v.length * p) - 1].toFixed(2);
let item;
try {
  await db.insert(accounts).values(users.map(userId => ({ userId, acceptedAt: new Date() })));
  [item] = await db.insert(media).values({ userId: users[0], title: "Benign capacity fixture",
    originalName: "synthetic.bin", objectKey: "synthetic-capacity-fixture", mediaType: "video",
    contentType: "video/mp4", size: fixture.length, visibility: "public", rightsConfirmedAt: new Date() }).returning();
  const tickets = users.slice(1).map(u => createMediaTicket(item.id, u));
  for (const concurrency of [4, 16, 64]) {
    await delay(2200); // Avoid carrying rate debt between scenarios.
    const elapsed = [], auth = [], statuses = {};
    queries = 0; r2Reads = 0;
    const started = performance.now();
    for (let wave = 0; wave < 3; wave++) {
      await Promise.all(Array.from({ length: concurrency }, async (_, i) => {
        const start = performance.now();
        const response = await handleMedia(new Request(`https://synthetic-edge.invalid/streams/${item.id}?ticket=${tickets[i]}`, {
          method: i % 4 === 0 ? "HEAD" : "GET", headers: { Range: `bytes=${i * 16}-${i * 16 + 15}` },
        }), env, async (_url, init) => {
          const begin = performance.now();
          const result = await fetch(`${base}/api/edge/media-authorize`, init);
          auth.push(performance.now() - begin); return result;
        });
        await response.arrayBuffer(); elapsed.push(performance.now() - start);
        statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      }));
    }
    report.results.push({ concurrency, requests: elapsed.length, durationMs: +(performance.now() - started).toFixed(2),
      authorizationP50Ms: percentile(auth, .5), authorizationP95Ms: percentile(auth, .95), authorizationP99Ms: percentile(auth, .99),
      totalP99Ms: percentile(elapsed, .99), queries, r2Reads, statuses,
      denialRate: (elapsed.length - (statuses[206] ?? 0)) / elapsed.length });
  }
  await delay(2200);
  queries = 0;
  await sharedStreamMedia(item.id, users[1]);
  report.directSharedCheckQueries = queries;
  await db.update(accounts).set({ acceptedAt: null }).where(eq(accounts.userId, users[1]));
  const denied = await fetch(`${base}/api/edge/media-authorize`, { method: "POST", headers: {
    "Content-Type": "application/json", "X-Edge-Authorization": `Bearer ${process.env.SHARED_MEDIA_EDGE_SECRET}`,
  }, body: JSON.stringify({ id: item.id, ticket: tickets[0] }) });
  assert.equal(denied.status, 404);
  report.revocationWithExistingTicket = "404";
  if (database.mediaAuthorizationPool) {
    await db.update(accounts).set({ acceptedAt: new Date() }).where(eq(accounts.userId, users[1]));
    const grant = (index = 0) => fetch(`${base}/api/edge/media-authorize`, { method: "POST", headers: {
      "Content-Type": "application/json", "X-Edge-Authorization": `Bearer ${process.env.SHARED_MEDIA_EDGE_SECRET}`,
    }, body: JSON.stringify({ id: item.id, ticket: tickets[index] }) });
    await delay(2200);
    queries = 0;
    const sameViewer = await Promise.all(Array.from({ length: 32 }, () => grant()));
    report.viewerBurst = { requests: 32, queries, statuses: sameViewer.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1; return acc;
    }, {}) };
    assert.ok(sameViewer.some(r => r.status === 429));
    assert.ok(queries <= 24);
    for (const r of sameViewer) {
      if (r.status === 429) assert.equal(r.headers.get("Retry-After"), "1");
      await r.arrayBuffer();
    }
    await delay(2200);
    // Real server-side statement timeout, confined to our dedicated connections.
    // No locks on app tables and no database settings/schema mutations.
    const p = database.mediaAuthorizationPool, original = p.query;
    let slowQueries = 4;
    p.query = function (config, ...args) {
      if (slowQueries-- > 0) return original.call(this, { ...config, text: "select pg_sleep(2)", values: [] }, []);
      return original.call(this, config, ...args);
    };
    try {
      const start = performance.now();
      const stalled = await Promise.all(Array.from({ length: 4 }, (_, i) => grant(i + 8)));
      const elapsedMs = +(performance.now() - start).toFixed(2);
      assert.ok(stalled.every(r => r.status === 503));
      assert.ok(elapsedMs >= 900, "Must exercise the real statement deadline, not a bind/fixture error");
      assert.ok(elapsedMs < 4500, "Authority must fail before the Worker's five-second deadline");
      for (const r of stalled) {
        assert.equal(r.headers.get("Cache-Control"), "private, no-store");
        assert.ok(!(await r.text()).includes(item.objectKey));
      }
      report.timeout = { requests: 4, status: 503, elapsedMs };
    } finally { p.query = original; }
    const recovered = await grant(20);
    assert.equal(recovered.status, 200); await recovered.arrayBuffer();
    report.timeout.recoveryStatus = recovered.status;
    assert.equal(p.waitingCount, 0);
    const occupied = await Promise.all(Array.from({ length: 4 }, () => p.connect()));
    try {
      const start = performance.now(), unavailable = await grant(21);
      const elapsedMs = +(performance.now() - start).toFixed(2);
      assert.equal(unavailable.status, 503); await unavailable.arrayBuffer();
      assert.ok(elapsedMs >= 450 && elapsedMs < 2500);
      report.connectionTimeout = { status: unavailable.status, elapsedMs };
    } finally { for (const client of occupied) client.release(); }
    const reconnected = await grant(22);
    assert.equal(reconnected.status, 200); await reconnected.arrayBuffer();
    report.connectionTimeout.recoveryStatus = reconnected.status;
    assert.equal(p.waitingCount, 0);
    assert.ok(p.totalCount <= 4);
    // Compare before/after telemetry using only aggregate fields.
    const { mediaAuthorizationTelemetry } = await import("../src/lib/media-authorization-telemetry.ts");
    report.operationalWindow = mediaAuthorizationTelemetry.flush();
    assert.equal(report.operationalWindow.alert, true);
  }
} finally {
  for (const restore of restores) restore();
  if (item) await db.delete(media).where(eq(media.id, item.id));
  await db.delete(accounts).where(inArray(accounts.userId, users));
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await database.mediaAuthorizationPool?.end(); await pool.end();
  if (oldSecret === undefined) delete process.env.SHARED_MEDIA_EDGE_SECRET; else process.env.SHARED_MEDIA_EDGE_SECRET = oldSecret;
}
const output = new URL("../../../generated-artifacts/edge-authorization/", import.meta.url);
await mkdir(output, { recursive: true });
const label = process.argv[2] === "baseline" ? "baseline" : "protected";
await writeFile(new URL(`${label}.json`, output), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
