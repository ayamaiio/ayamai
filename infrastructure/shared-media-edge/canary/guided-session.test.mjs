import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sessionRoute, hash, networkComplete, validateEvidence } from "./guided-session.mjs";
function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./guided-schema.sql", import.meta.url), "utf8"));
  return { prepare(sql) {
    return { bind(...args) { const stmt = db.prepare(sql); return {
      async first() { return stmt.get(...args) ?? null; },
      async run() { return stmt.run(...args); },
      async all() { return { results: stmt.all(...args) }; },
    }; } };
  } };
}
const origin = "https://canary.test";
const request = (path, body, cookie, originHeader = origin) => new Request(origin + path, {
  method: body ? "POST" : "GET", headers: { ...(body ? { "Content-Type": "application/json", Origin: originHeader } : {}),
    ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
});
test("single-use link, cookie persistence, scoped run, CSRF and private evidence", async () => {
  const env = { DB: database(), CANARY_BUCKET: "ayamai-edge-canary", CANARY_ONLY: "synthetic-v1" };
  const invitation = "a".repeat(64);
  await env.DB.prepare("INSERT INTO guided_invites(token_hash, expires_ms) VALUES (?,?)").bind(await hash(invitation), Date.now() + 60_000).run();
  const controls = [];
  const control = async (action, body) => {
    controls.push({ action, body });
    return Response.json(action === "run" ? { runId: "fixed-run" } : action === "health" ?
      { bytes: 895998, fixtureReady: true } : { ok: true });
  };
  assert.equal((await sessionRoute(request("/session"), env, control)).status, 401);
  assert.equal((await sessionRoute(request("/session/redeem", { invitation }, null, "https://evil.test"), env, control)).status, 403);
  const login = await sessionRoute(request("/session/redeem", { invitation }), env, control);
  assert.equal(login.status, 200);
  const cookie = login.headers.get("Set-Cookie").split(";")[0];
  assert.match(login.headers.get("Set-Cookie"), /Secure; HttpOnly; SameSite=Strict/);
  assert.equal((await sessionRoute(request("/session/redeem", { invitation }), env, control)).status, 401);
  assert.equal((await sessionRoute(request("/session/finish", { network: "wifi" }, cookie), env, control)).status, 409);
  await sessionRoute(request("/session/ticket", { runId: "attacker" }, cookie), env, control);
  assert.equal(controls.at(-1).body.runId, "fixed-run");
  const e = { network: "wifi", transport: "edge", kind: "range", detail: "closed", passed: true, status: 206, bytes: 512 };
  assert.equal((await sessionRoute(request("/session/evidence", e, cookie), env, control)).status, 200);
  const reload = await (await sessionRoute(request("/session", null, cookie), env, control)).json();
  assert.equal(reload.evidence.length, 1);
  assert.equal((await sessionRoute(request("/session/evidence", { ...e, ticket: "not allowed" }, cookie), env, control)).status, 400);
  assert.equal((await sessionRoute(request("/session", null, "__Host-ayamai-canary=" + "b".repeat(64)), env, control)).status, 401);
});
test("validation never treats client cancellation as upstream proof", () => {
  const e = { network: "wifi", transport: "edge", kind: "cancellation", detail: "cancel", passed: false,
    clientCancelled: true, upstreamCancellationVerified: false };
  assert.deepEqual(validateEvidence(e), e);
  assert.throws(() => validateEvidence({ ...e, passed: true }));
  assert.throws(() => validateEvidence({ ...e, upstreamCancellationVerified: true }));
  assert.throws(() => validateEvidence({ ...e, network: "guessed" }));
  assert.equal(networkComplete([], "wifi"), false);
});
test("session rate limit is persistent and expired invitations fail", async () => {
  const env = { DB: database(), CANARY_BUCKET: "ayamai-edge-canary", CANARY_ONLY: "synthetic-v1" };
  const token = "c".repeat(64), h = await hash(token), window = Math.floor(Date.now() / 60_000);
  await env.DB.prepare("INSERT INTO guided_sessions(token_hash,run_id,expires_ms,window_ms,calls) VALUES (?,?,?,?,?)")
    .bind(h, "run", Date.now()+60000, window, 240).run();
  const r = await sessionRoute(request("/session", null, `__Host-ayamai-canary=${token}`), env, async () => Response.json({}));
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("Retry-After"), "60");
});
test("all required network checks persist completion, without claiming overall verification", async () => {
  const env = { DB: database(), CANARY_BUCKET: "ayamai-edge-canary", CANARY_ONLY: "synthetic-v1" };
  const token = "d".repeat(64), sessionHash = await hash(token);
  await env.DB.prepare("INSERT INTO guided_sessions(token_hash,run_id,expires_ms) VALUES (?,?,?)")
    .bind(sessionHash, "workflow-qa", Date.now()+60000).run();
  const flags = ["public", "removed", "deleted", "rights", "viewerAccepted", "publisherAccepted", "viewerBlocksPublisher", "publisherBlocksViewer"];
  const required = ["HEAD", "closed", "open", "suffix", "invalid", "multiple", "seek",
    ...flags.flatMap(f => ["GET", "HEAD", "RANGE"].map(m => `${f}:${m}`))];
  for (const network of ["wifi", "cellular"]) {
    for (const transport of ["relay", "edge"]) {
      for (const detail of [...required, "cancel"]) {
        const result = { network, transport, detail, passed: detail !== "cancel",
          ...(detail === "cancel" ? { clientCancelled: true, upstreamCancellationVerified: false } : {}) };
        await env.DB.prepare("INSERT INTO guided_evidence(session_hash,evidence_key,result_json,updated_ms) VALUES (?,?,?,?)")
          .bind(sessionHash, `${network}/${transport}/${detail}`, JSON.stringify(result), Date.now()).run();
      }
    }
    const finish = await sessionRoute(request("/session/finish", { network }, `__Host-ayamai-canary=${token}`), env, async () => Response.json({}));
    assert.equal(finish.status, 200);
    assert.equal((await finish.json()).overallVerified, false);
  }
  const result = await (await sessionRoute(request("/session", null, `__Host-ayamai-canary=${token}`), env,
    async () => Response.json({ fixtureReady: true, bytes: 895998 }))).json();
  assert.equal(result.wifiDone, true);
  assert.equal(result.cellularDone, true);
  assert.equal(result.evidence.length, 128);
});
