// Explicitly approved synthetic-canary provisioning only. Never app publishing.
// New canary credentials are consumed/generated in memory, never logged/written.
import { readFile, writeFile } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { checkReadiness } from "./readiness.mjs";
import { BASELINE, BUCKET, FIXTURE, MAX_BYTES } from "./protocol.mjs";

const dir = fileURLToPath(new URL(".", import.meta.url));
const requireTool = createRequire(new URL("../../../artifacts/api-server/package.json", import.meta.url));
const account = "53dcf89689e1f019f32eacc9be31cd6b";
const apiName = "ayamai-edge-canary-api", gatewayName = "ayamai-edge-canary";
const base = `/v4/accounts/${account}`;
class SafeError extends Error {}
const insist = (ok, message) => { if (!ok) throw new SafeError(message); };
const load = async name => JSON.parse(await readFile(`${dir}${name}`, "utf8"));
let redact = s => s;

export async function requestWithActivation(fetchOnce, { active, path, pause = () => new Promise(r => setTimeout(r, 1500)) }) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetchOnce();
    // Health is intentionally available (200) during the probe phase. It is
    // not activation evidence. Other handlers are rejected (503) pre-dispatch.
    if (!active || response.headers.get("X-Canary-Phase") !== "probe"
      || (response.status !== 503 && path !== "/control/health")) return response;
    await response.body?.cancel();
    await pause();
  }
  throw new SafeError("Gateway activation has not propagated; endpoint will be disabled.");
}

async function main() {
  insist(process.argv.includes("--apply"), "Requires explicit --apply; no cloud changes made.");
  const evidence = await load("readiness-evidence.json");
  const apiConfig = await load("wrangler.authority.example.json");
  const gatewayConfig = await load("wrangler.gateway.example.json");
  insist(evidence.deploymentPermission === "explicitly-approved", "Canary creation approval is missing.");
  insist(evidence.accountId === account && apiConfig.account_id === account && gatewayConfig.account_id === account, "Account selection mismatch.");
  const operator = process.env.CANARY_OPERATOR_SECRET;
  insist(typeof operator === "string" && operator.length > 0, "CANARY_OPERATOR_SECRET is not available to the provisioning process.");
  insist(operator.length >= 32, "CANARY_OPERATOR_SECRET is shorter than 32 characters; update it through secure input.");
  insist(operator.length <= 256 && /^[\x20-\x7e]+$/.test(operator),
    "CANARY_OPERATOR_SECRET must be at most 256 characters, using letters, numbers, spaces or ASCII punctuation without line breaks.");
  // Domain-separated canary-only keys, stable across interrupted provisioning.
  // The operator password is the canary root credential; rotating it rotates all.
  const derive = label => createHmac("sha256", operator).update(`ayamai-canary:${account}:${label}:v1`).digest("hex");
  const service = derive("service"), ticket = derive("ticket");
  const sensitive = [operator, service, ticket];
  redact = s => sensitive.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), String(s));
  const sdk = new ReplitConnectors();
  const cf = async (path, method = "GET", body, headers = {}) => {
    insist(path.startsWith(base + "/"), "Cross-account request refused.");
    let response;
    try {
      response = await sdk.proxy("cloudflare", path, {
        method, headers: { ...(body && typeof body !== "string" ? { "Content-Type": "application/json" } : {}), ...headers },
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      });
    } catch { throw new SafeError(`Cloudflare proxy failed: ${method} ${path}`); }
    const data = await response.json();
    if (!response.ok || !data.success) {
      const details = redact(JSON.stringify(data.errors ?? [])).slice(0,600);
      throw new SafeError(`Cloudflare HTTP ${response.status}: ${method} ${path}: ${details}`);
    }
    return data.result;
  };

  // Fresh read-only checks precede every Worker upload. No plan mutation exists.
  const subscriptions = await cf(base + "/subscriptions");
  insist(Array.isArray(subscriptions) && subscriptions.every(s => s.rate_plan?.id === "r2_paid"),
    "Unexpected subscription/Workers Paid: stop for plan review; never upgrade.");
  const bucket = await cf(base + `/r2/buckets/${BUCKET}`);
  const managed = await cf(base + `/r2/buckets/${BUCKET}/domains/managed`);
  const domains = await cf(base + `/r2/buckets/${BUCKET}/domains/custom`);
  insist(bucket.name === BUCKET && bucket.storage_class === "Standard" && managed.enabled === false
    && Array.isArray(domains.domains) && domains.domains.length === 0, "Private Standard canary bucket check failed.");
  const databases = await cf(base + "/d1/database");
  const db = databases.find(d => d.uuid === evidence.isolatedD1Id && d.name === "ayamai-edge-canary-db");
  insist(db && db.uuid === apiConfig.d1_databases[0].database_id, "Isolated database identity mismatch.");
  const tables = await cf(base + `/d1/database/${db.uuid}/query`, "POST", {
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name;",
  });
  insist(tables[0]?.results?.map(t => t.name).join(",") === "canary_budget,canary_metrics,canary_runs", "Unexpected database schema.");
  const scripts = await cf(base + "/workers/scripts");
  for (const name of [apiName, gatewayName]) {
    if (!scripts.some(s => s.id === name)) continue;
    insist(process.argv.includes("--resume"), "Canary Worker already exists; explicit --resume required.");
    const settings = await cf(base + `/workers/scripts/${name}/settings`);
    insist(settings.bindings?.some(b => b.name === "CANARY_ONLY" && b.text === "synthetic-v1")
      && settings.bindings.some(b => b.type === "r2_bucket" && b.name === "MEDIA" && b.bucket_name === BUCKET),
    "Existing Worker is not a verified synthetic canary; refusing overwrite.");
  }
  const pending = checkReadiness(evidence, apiConfig, gatewayConfig);
  const allowedPending = ["workersWrite", "r2BindingRead", "Fixture HEAD", "Confirm no production",
    "Private service-binding", "additional-infrastructure cost review"];
  insist(pending.blockers.every(b => allowedPending.some(prefix => b.includes(prefix))), "Unexpected pre-provisioning readiness blocker.");

  const { build } = requireTool("esbuild");
  const compile = async options => (await build({
    absWorkingDir: dir, bundle: true, format: "esm", platform: "browser", target: "es2022",
    write: false, logLevel: "silent", ...options,
  })).outputFiles[0].text;
  const apiSource = await compile({ entryPoints: ["authority.mjs"] });
  const assets = {
    html: await readFile(`${dir}harness/index.html`, "utf8"),
    script: await readFile(`${dir}harness/measure.js`, "utf8"),
  };
  const gatewaySource = await compile({ stdin: {
    contents: `import {createGatewayRuntime} from "./gateway-runtime.mjs";export default createGatewayRuntime(${JSON.stringify(assets)});`,
    resolveDir: dir, sourcefile: "gateway-entry.mjs", loader: "js",
  } });
  const plain = (name, text) => ({ type: "plain_text", name, text });
  const secret = (name, text) => ({ type: "secret_text", name, text });
  const common = [
    plain("CANARY_ONLY", "synthetic-v1"), plain("CANARY_BUCKET", BUCKET),
    { type: "r2_bucket", name: "MEDIA", bucket_name: BUCKET },
    secret("CANARY_SERVICE_SECRET", service), secret("CANARY_TICKET_SECRET", ticket),
  ];
  const metadata = (bindings) => ({
    main_module: "main.js", compatibility_date: "2026-10-01", bindings,
    tags: ["ayamai-synthetic-canary"], logpush: false, observability: { enabled: false },
  });
  const upload = async (name, source, bindings) => {
    insist([apiName, gatewayName].includes(name), "Non-canary Worker name refused.");
    const boundary = "canary" + randomBytes(16).toString("hex");
    const part = (name, type, value, filename = "") =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ""}\r\nContent-Type: ${type}\r\n\r\n${value}\r\n`;
    const body = part("metadata", "application/json", JSON.stringify(metadata(bindings)))
      + part("main.js", "application/javascript+module", source, "main.js") + `--${boundary}--\r\n`;
    await cf(base + `/workers/scripts/${name}`, "PUT", body, { "Content-Type": `multipart/form-data; boundary=${boundary}` });
  };
  const subdomain = (name, enabled) => cf(base + `/workers/scripts/${name}/subdomain`, "POST", { enabled, previews_enabled: false });
  const gatewayBindings = phase => [...common,
    { type: "service", name: "AUTHORITY", service: apiName, environment: "production" },
    secret("CANARY_OPERATOR_SECRET", operator), plain("CANARY_DEPLOYMENT_PHASE", phase),
  ];
  let gatewayEnabled = false;
  try {
    await upload(apiName, apiSource, [...common, { type: "d1", name: "DB", id: db.uuid }]);
    await subdomain(apiName, false);
    const privateEndpoint = await cf(base + `/workers/scripts/${apiName}/subdomain`);
    insist(privateEndpoint.enabled === false && privateEndpoint.previews_enabled === false, "Authority ingress is not private.");
    await upload(gatewayName, gatewaySource, gatewayBindings("probe"));
    await subdomain(gatewayName, false);
    const accountDomain = await cf(base + "/workers/subdomain");
    insist(/^[a-z0-9-]+$/.test(accountDomain.subdomain), "Invalid provider subdomain.");
    const origin = `https://${gatewayName}.${accountDomain.subdomain}.workers.dev`;
    await subdomain(gatewayName, true);
    gatewayEnabled = true;
    let activationExpected = false;
    // Retry only positively identified pre-dispatch probe responses, never an
    // ambiguous write failure. Metadata activation can propagate after upload.
    const request = (path, options = {}) => requestWithActivation(() => fetch(origin + path, {
      ...options, redirect: "error", signal: AbortSignal.timeout(30_000),
    }), { active: activationExpected, path });
    const control = async (action, data) => {
      const r = await request("/control/" + action, {
        method: data ? "POST" : "GET",
        headers: { Authorization: `Bearer ${operator}`, ...(data ? { "Content-Type": "application/json" } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      insist(r.ok, `Canary control ${action} failed: HTTP ${r.status}`);
      return r.json();
    };
    let health;
    for (let attempt = 0; attempt < 6; attempt++) {
      try { health = await control("health"); break; }
      catch { if (attempt === 5) throw new SafeError("Private ingress/fixture health failed; gateway will be disabled."); }
      await new Promise(r => setTimeout(r, 2000));
    }
    insist(health.privateIngress && health.fixtureReady && health.bucket === BUCKET
      && health.contentType === "video/mp4" && health.bytes > 0 && health.bytes <= MAX_BYTES, "Private fixture validation failed.");
    insist((await request("/")).status === 503, "Probe phase unexpectedly serves the harness.");
    insist((await request("/control/health")).status === 401, "Anonymous controls are not blocked.");

    const verified = {
      ...evidence, verifiedAt: new Date().toISOString(), workersPlan: "free",
      permissions: { workersWrite: "verified", d1Write: "verified", r2BindingRead: "verified" },
      fixture: { key: FIXTURE, bytes: health.bytes, contentType: health.contentType },
      isolationReview: "verified", privateIngress: "verified", costReview: "verified",
      gatewayOrigin: origin, physicalIphoneSamples: 0, workerCpuEvidence: "not-measured",
    };
    const gate = checkReadiness(verified, apiConfig, gatewayConfig);
    insist(gate.deploymentAllowed && gate.conservativeIncrementalUsd.total <= 3, "Final readiness gate refused activation.");
    await upload(gatewayName, gatewaySource, gatewayBindings("ready"));
    activationExpected = true;
    const activated = await request("/control/health", { headers: { Authorization: `Bearer ${operator}` } });
    insist(activated.ok && activated.headers.get("X-Canary-Phase") === "ready", "Gateway activation is not verified.");
    await activated.body?.cancel();
    const run = await control("run", {});
    const ticketData = await control("ticket", { runId: run.runId });
    const checks = [];
    for (const transport of ["edge", "relay"]) {
      const path = `/${transport}/${ticketData.id}?ticket=${encodeURIComponent(ticketData.ticket)}`;
      const head = await request(path, { method: "HEAD" });
      insist(head.status === 200, `Synthetic ${transport} HEAD check failed: HTTP ${head.status}, phase ${head.headers.get("X-Canary-Phase") ?? "unmarked"}.`);
      const range = await request(path, { headers: { Range: "bytes=0-15" } });
      insist(range.status === 206 && (await range.arrayBuffer()).byteLength === 16, "Synthetic range check failed.");
      const invalid = await request(path, { headers: { Range: "bytes=0-1,3-4" } });
      insist(invalid.status === 416, "Multiple-range rejection failed.");
      checks.push({ transport, head: 200, range: 206, multipleRange: 416 });
    }
    await control("state", { runId: run.runId, state: { ...BASELINE, public: false } });
    for (const transport of ["edge", "relay"]) {
      const r = await request(`/${transport}/${ticketData.id}?ticket=${encodeURIComponent(ticketData.ticket)}`, { method: "HEAD" });
      insist(r.status === 404, "Old-ticket privacy revocation failed.");
    }
    await control("state", { runId: run.runId, state: BASELINE });
    const html = await request("/");
    insist(html.status === 200 && (await html.text()).includes("Physical-device measurements"), "Harness verification failed.");
    verified.observations = [...evidence.observations,
      "Verified live private authority service binding, exact R2 fixture HEAD, anonymous-control rejection, both transports HEAD/ranges and old-ticket privacy revocation. Gateway probe phase blocked all non-health paths before readiness passed.",
      "REST packaging embeds the exact local harness files; no external assets, production API, production database or R2 S3 credentials.",
      "All smoke checks are synthetic HTTP checks, NOT physical Safari playback or CPU evidence."];
    await writeFile(`${dir}readiness-evidence.json`, JSON.stringify(verified, null, 2) + "\n");
    console.log(JSON.stringify({ ready: true, gatewayOrigin: origin, fixtureBytes: health.bytes,
      conservativeAdditionalMonthlyUsd: gate.conservativeIncrementalUsd.total, checks, physicalIphoneSamples: 0 }, null, 2));
  } catch (error) {
    if (gatewayEnabled) {
      try { await subdomain(gatewayName, false); }
      catch { throw new SafeError("Verification failed AND gateway disable failed; inspect the canary immediately."); }
    }
    throw error;
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof SafeError ? redact(error.message) : "Canary provisioning stopped on an unexpected error; no secret values logged.");
    process.exitCode = 1;
  });
}
