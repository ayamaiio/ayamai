// Isolated-canary session controls. Never bind to application data or buckets.
const FLAGS = {
  public: true, removed: false, deleted: false, rights: true,
  viewerAccepted: true, publisherAccepted: true,
  viewerBlocksPublisher: false, publisherBlocksViewer: false,
};
const COOKIE = "__Host-ayamai-canary";
export const headers = {
  "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
export const json = (value, status = 200, extra = {}) =>
  new Response(JSON.stringify(value), { status, headers: { ...headers, "Content-Type": "application/json", ...extra } });
export async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    x => x.toString(16).padStart(2, "0")).join("");
}
async function payload(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new Error("Invalid input");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid input");
  const parts = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); throw new Error("Invalid input"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("Invalid input");
  return body;
}
export function validateEvidence(value) {
  if (!value || !["wifi", "cellular"].includes(value.network) ||
    !["relay", "edge"].includes(value.transport) ||
    !["HEAD", "range", "cancellation", "revocation", "seek"].includes(value.kind) ||
    typeof value.passed !== "boolean") throw new Error("Invalid evidence");
  const allowed = new Set(["network", "transport", "kind", "detail", "passed", "status",
    "bytes", "expectedBytes", "range", "clientCancelled", "upstreamCancellationVerified", "position"]);
  if (Object.keys(value).some(k => !allowed.has(k))) throw new Error("Invalid evidence");
  const details = ["HEAD", "closed", "open", "suffix", "invalid", "multiple", "cancel", "seek",
    ...Object.keys(FLAGS).flatMap(flag => ["GET", "HEAD", "RANGE"].map(method => `${flag}:${method}`))];
  if (!details.includes(value.detail)) throw new Error("Invalid evidence");
  for (const key of ["status", "bytes", "expectedBytes", "position"]) {
    if (value[key] !== undefined && (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 20_000_000)) throw new Error("Invalid evidence");
  }
  if (value.range !== undefined && (typeof value.range !== "string" || !/^bytes [0-9*/ -]{1,100}$/.test(value.range))) throw new Error("Invalid evidence");
  for (const key of ["clientCancelled", "upstreamCancellationVerified"])
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw new Error("Invalid evidence");
  const expectedKind = value.detail === "HEAD" ? "HEAD" :
    ["closed", "open", "suffix", "invalid", "multiple"].includes(value.detail) ? "range" :
    value.detail === "cancel" ? "cancellation" : value.detail === "seek" ? "seek" : "revocation";
  if (value.kind !== expectedKind) throw new Error("Invalid evidence");
  // Client cancellation is evidence, never a verified upstream-cancellation pass.
  if (value.kind === "cancellation" && (value.passed || value.upstreamCancellationVerified !== false))
    throw new Error("Unverified cancellation");
  return { ...value };
}
export function networkComplete(evidence, network) {
  const required = ["HEAD", "closed", "open", "suffix", "invalid", "multiple", "seek",
    ...Object.keys(FLAGS).flatMap(f => ["GET", "HEAD", "RANGE"].map(m => `${f}:${m}`))];
  return ["relay", "edge"].every(transport =>
    required.every(detail => evidence.some(e => e.network === network && e.transport === transport && e.detail === detail && e.passed)) &&
    evidence.some(e => e.network === network && e.transport === transport && e.detail === "cancel" && e.clientCancelled));
}
export async function sessionRoute(request, env, control) {
  const url = new URL(request.url), path = url.pathname;
  if (!env.DB || env.CANARY_BUCKET !== "ayamai-edge-canary" || env.CANARY_ONLY !== "synthetic-v1")
    return json({ error: "Isolated test storage unavailable." }, 503);
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Method not allowed." }, 405);
  if (request.method === "POST" && request.headers.get("Origin") !== url.origin)
    return json({ error: "Origin denied." }, 403);
  try {
    if (path === "/session/redeem" && request.method === "POST") {
      const { invitation } = await payload(request);
      if (typeof invitation !== "string" || !/^[a-f0-9]{64}$/.test(invitation)) return json({ error: "Invalid private link." }, 401);
      const now = Date.now(), tokenHash = await hash(invitation);
      // Atomic, single-use invitation consumption. No public session creation.
      const used = await env.DB.prepare("UPDATE guided_invites SET used = 1 WHERE token_hash = ? AND expires_ms > ? AND used = 0 RETURNING token_hash")
        .bind(tokenHash, now).first();
      if (!used) return json({ error: "This private link has expired or was already used. Reopen this page in the Safari tab where you started, or request a new link." }, 401);
      const created = await control("run", {});
      const run = await created.json();
      if (!created.ok || typeof run.runId !== "string") return json({ error: "Could not start the isolated run. Request a fresh link." }, 503);
      const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      await env.DB.prepare("INSERT INTO guided_sessions(token_hash, run_id, expires_ms) VALUES (?, ?, ?)")
        .bind(await hash(token), run.runId, now + 7_200_000).run();
      return json({ connected: true }, 200, { "Set-Cookie": `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=7200` });
    }
    const token = request.headers.get("Cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ error: "Open your private test link to start." }, 401);
    const sessionHash = await hash(token), now = Date.now();
    const session = await env.DB.prepare("SELECT * FROM guided_sessions WHERE token_hash = ? AND expires_ms > ?").bind(sessionHash, now).first();
    if (!session) return json({ error: "Test session expired. Your saved results are retained; request a new link." }, 401);
    const window = Math.floor(now / 60_000);
    const quota = await env.DB.prepare(`UPDATE guided_sessions SET calls = CASE WHEN window_ms = ? THEN calls + 1 ELSE 1 END, window_ms = ?
      WHERE token_hash = ? AND (window_ms != ? OR calls < 240) RETURNING calls`).bind(window, window, sessionHash, window).first();
    if (!quota) return json({ error: "Too many requests. Retry in a minute." }, 429, { "Retry-After": "60" });
    const evidence = async () => {
      const rows = await env.DB.prepare("SELECT result_json FROM guided_evidence WHERE session_hash = ? ORDER BY evidence_key LIMIT 200")
        .bind(sessionHash).all();
      return rows.results.map(row => JSON.parse(row.result_json));
    };
    if (path === "/session" && request.method === "GET") {
      const health = await control("health");
      if (!health.ok) return json({ error: "Canary health check failed. Saved results are retained." }, 503);
      const h = await health.json();
      return json({ fixtureBytes: h.bytes, fixtureReady: h.fixtureReady, productionStack: false,
        wifiDone: !!session.wifi_done, cellularDone: !!session.cellular_done, evidence: await evidence() });
    }
    if (request.method !== "POST") return json({ error: "Not found." }, 404);
    const body = await payload(request);
    if (path === "/session/ticket") return control("ticket", { runId: session.run_id });
    if (path === "/session/state") {
      if (!body.state || Object.keys(body.state).length !== Object.keys(FLAGS).length ||
        Object.keys(FLAGS).some(k => typeof body.state[k] !== "boolean")) return json({ error: "Invalid state." }, 400);
      return control("state", { runId: session.run_id, state: body.state });
    }
    if (path === "/session/evidence") {
      const result = validateEvidence(body);
      const key = `${result.network}/${result.transport}/${result.detail}`;
      await env.DB.prepare(`INSERT INTO guided_evidence(session_hash, evidence_key, result_json, updated_ms) VALUES (?, ?, ?, ?)
        ON CONFLICT(session_hash, evidence_key) DO UPDATE SET result_json=excluded.result_json, updated_ms=excluded.updated_ms`)
        .bind(sessionHash, key, JSON.stringify(result), now).run();
      return json({ saved: true });
    }
    if (path === "/session/finish") {
      if (!["wifi", "cellular"].includes(body.network)) return json({ error: "Invalid network." }, 400);
      if (!networkComplete(await evidence(), body.network)) return json({ error: "Some device checks failed or were not saved. Press Retry to run this network again." }, 409);
      // Two fixed SQL statements; no interpolated column or client-supplied run id.
      const sql = body.network === "wifi" ? "UPDATE guided_sessions SET wifi_done=1 WHERE token_hash=?" :
        "UPDATE guided_sessions SET cellular_done=1 WHERE token_hash=?";
      await env.DB.prepare(sql).bind(sessionHash).run();
      return json({ saved: true, deviceChecksCollected: true, overallVerified: false });
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    const invalid = /Invalid|Unverified/.test(error.message);
    // No request URLs, headers, cookies, body values, or credentials are logged.
    if (!invalid) console.error(JSON.stringify({ event: "canary_session_failed", operation: path.split("/").at(-1) }));
    return json({ error: invalid ? "Invalid test input." : "Could not save or load results. Keep this page open and retry." }, invalid ? 400 : 503);
  }
}
