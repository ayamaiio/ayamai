import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { BUCKET, MAX_BYTES, MAX_GRANTS } from "./protocol.mjs";

export function checkReadiness(evidence, api, gateway, now = Date.now()) {
  const blockers = [];
  const check = (ok, text) => { if (!ok) blockers.push(text); };
  check(evidence?.workersPlan === "free", "Workers Free has not been verified. Never upgrade to Paid.");
  check(/^[0-9a-f]{32}$/i.test(evidence?.accountId ?? "")
    && api?.account_id === evidence.accountId && gateway?.account_id === evidence.accountId,
    "Both configurations must explicitly select the verified canary Cloudflare account.");
  const age = now - Date.parse(evidence?.verifiedAt);
  check(Number.isFinite(age) && age >= 0 && age < 86_400_000, "Provider evidence must be less than 24 hours old.");
  for (const permission of ["workersWrite", "d1Write", "r2BindingRead"]) {
    check(evidence?.permissions?.[permission] === "verified", `${permission} permission/scope is not verified.`);
  }
  check(evidence?.bucket?.name === BUCKET && evidence.bucket.managedPublic === false
    && evidence.bucket.customDomains === 0 && evidence.bucket.storageClass === "Standard", "Private Standard canary bucket isolation is not verified.");
  check(evidence?.fixture?.key === "benign-test-pattern.mp4"
    && Number.isSafeInteger(evidence.fixture.bytes) && evidence.fixture.bytes > 0
    && evidence.fixture.bytes <= MAX_BYTES && evidence.fixture.contentType === "video/mp4", "Fixture HEAD, MIME and maximum 16 MiB size need verification.");
  const safeKeys = new Set(["name", "main", "compatibility_date", "workers_dev", "preview_urls", "observability", "vars", "r2_buckets", "services", "assets", "d1_databases", "account_id"]);
  for (const config of [api, gateway]) {
    check(config && Object.keys(config).every(k => safeKeys.has(k)), "Unexpected routes, triggers, build hooks or infrastructure in configuration.");
    check(config?.r2_buckets?.length === 1 && config.r2_buckets[0].binding === "MEDIA"
      && config.r2_buckets[0].bucket_name === BUCKET && Object.keys(config.r2_buckets[0]).every(k => ["binding", "bucket_name"].includes(k)), "Only the private canary R2 binding is permitted.");
    check(config?.vars?.CANARY_ONLY === "synthetic-v1" && config.vars.CANARY_BUCKET === BUCKET
      && Object.keys(config.vars).length === 2, "Unknown/inherited application settings are forbidden.");
    check(config?.observability?.enabled === false && config.preview_urls === false, "Request URL logging and preview URLs must remain disabled.");
  }
  check(api?.name === "ayamai-edge-canary-api" && api.main === "authority.mjs"
    && api.workers_dev === false && !api.services && !api.assets, "Authority must be service-binding-only, not publicly routed.");
  check(api?.d1_databases?.length === 1 && api.d1_databases[0].binding === "DB"
    && api.d1_databases[0].database_name === "ayamai-edge-canary-db"
    && /^[0-9a-f-]{36}$/i.test(api.d1_databases[0].database_id)
    && Object.keys(api.d1_databases[0]).every(k => ["binding", "database_name", "database_id"].includes(k))
    && api.d1_databases[0].database_id === evidence?.isolatedD1Id, "Dedicated empty canary D1 ID is not verified.");
  check(gateway?.name === "ayamai-edge-canary" && gateway.main === "gateway.mjs"
    && gateway.workers_dev === true && !gateway.d1_databases
    && gateway.services?.length === 1 && gateway.services[0].binding === "AUTHORITY"
    && gateway.services[0].service === "ayamai-edge-canary-api"
    && Object.keys(gateway.services[0]).length === 2, "Gateway must use only the fixed private authority service binding.");
  check(gateway?.assets?.directory === "./harness" && gateway.assets.binding === "ASSETS"
    && gateway.assets.run_worker_first === true, "Harness assets must remain isolated and worker-guarded.");
  check(evidence?.isolationReview === "verified", "Confirm no production secrets, data, DB bindings, routes or bucket policy changes.");
  check(evidence?.privateIngress === "verified", "Private service-binding ingress has not been verified in Cloudflare.");
  check(evidence?.budgetApprovedUsd === 3 && evidence?.costReview === "verified", "The additional-infrastructure cost review against the $3/month ceiling is incomplete.");
  check(evidence?.deploymentPermission === "explicitly-approved", "Explicit canary-only deployment permission has not been recorded.");
  return {
    deploymentAllowed: blockers.length === 0, blockers,
    limits: { monthlyAuthorizedRequests: MAX_GRANTS, maxR2Reads: MAX_GRANTS * 2, fixtureMaxBytes: MAX_BYTES },
    conservativeIncrementalUsd: { workersFree: 0, d1Free: 0, r2ClassB: 0.36, r2Storage: 0.015, total: 0.375 },
    costCaveats: [
      "Assumes verified Workers Free and Standard R2; no paid logging, extra copies, Class A operations or other services.",
      "R2 estimate pessimistically uses one full million Class B operations and one GB-month with no shared free allowance.",
      "Provider/account spending outside this isolated workload is not capped by this code.",
      "Runtime quotas fail closed. This script never provisions, deploys, enables routes or changes an account plan.",
    ],
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const evidence = JSON.parse(readFileSync(process.argv[2] || `${directory}readiness-evidence.json`, "utf8"));
  const api = JSON.parse(readFileSync(`${directory}wrangler.authority.example.json`, "utf8"));
  const gateway = JSON.parse(readFileSync(`${directory}wrangler.gateway.example.json`, "utf8"));
  const report = checkReadiness(evidence, api, gateway);
  const output = JSON.stringify(report, null, 2);
  if (process.argv[3]) writeFileSync(process.argv[3], output + "\n");
  console.log(output);
  process.exitCode = report.deploymentAllowed ? 0 : 1;
}
