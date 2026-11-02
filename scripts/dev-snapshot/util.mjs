import { spawnSync, spawn } from "node:child_process";
import readline from "node:readline";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function postgresEnv(extra = {}) {
  const env = { ...process.env, PGCONNECT_TIMEOUT: "10", PGOPTIONS: "", ...extra };
  // A libpq hostaddr or service from the shell must not redirect an explicit URL.
  for (const key of ["PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE"]) delete env[key];
  return env;
}

export function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    ...opts,
    env: ["psql", "pg_dump"].includes(cmd) ? postgresEnv(opts.env) : { ...process.env, ...(opts.env || {}) },
  });
  if (res.error) throw new Error(`${cmd} failed to start`);
  if (res.status !== 0) {
    // Arguments, COPY diagnostics and provider errors can contain credentials/data.
    throw new Error(`${cmd} exited ${res.status}`);
  }
  return res.stdout;
}

export function psql(url, sql, { tuplesOnly = true, snapshot } = {}) {
  const args = [url, "-v", "ON_ERROR_STOP=1", "-X", "-q"];
  if (tuplesOnly) args.push("-A", "-t");
  if (snapshot) args.push("-1", "-c", `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '${snapshot}'`);
  args.push("-c", sql);
  return sh("psql", args, { env: { PGOPTIONS: "-c default_transaction_read_only=on" } });
}

export function parseUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error("Invalid PostgreSQL URL"); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("DATABASE_URL must be postgres://");
  // Reject all libpq overrides (including service, hostaddr, options, duplicates).
  if (u.search || u.hash) throw new Error("PostgreSQL URL query parameters and fragments are forbidden");
  return {
    host: u.hostname,
    port: u.port || "5432",
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    user: decodeURIComponent(u.username || ""),
  };
}

export function redactUrl(url) {
  return "<database connection>";
}

export function assertLocalTarget(url, { allowDb, allowHost, allowPort }) {
  const t = parseUrl(url);
  const problems = [];
  if (allowHost !== "127.0.0.1" || String(allowPort) !== "5434") throw new Error("Only isolated loopback port 5434 is allowed");
  if (t.host !== allowHost) problems.push(`host ${t.host} != ${allowHost}`);
  if (String(t.port) !== String(allowPort)) problems.push(`port ${t.port} != ${allowPort}`);
  if (t.database !== allowDb) problems.push(`database ${t.database} != ${allowDb}`);
  if (problems.length) {
    throw new Error(
      `Refusing non-local target (${redactUrl(url)}): ${problems.join("; ")}. ` +
        `Restores may only touch the isolated development database.`,
    );
  }
  return t;
}

export function sha256File(file) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
}

export function ensureDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode });
  try {
    fs.chmodSync(dir, mode);
  } catch {}
}

export function writePrivate(file, data) {
  fs.writeFileSync(file, data, { mode: 0o600, flag: "wx" });
  try {
    fs.chmodSync(file, 0o600);
  } catch {}
}

export function gpg(args, passphraseFile) {
  return sh(
    "gpg",
    ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-file", passphraseFile, ...args],
    { env: { GNUPGHOME: process.env.GNUPGHOME || path.join(os.homedir(), ".gnupg") } },
  );
}

// Keep the exporting transaction alive until schema, catalog, data, manifest and
// identities have all imported the very same MVCC snapshot.
export async function withSourceSnapshot(source, fn) {
  parseUrl(source);
  const child = spawn("psql", [source, "-X", "-q", "-A", "-t", "-w", "-v", "ON_ERROR_STOP=1"], {
    env: postgresEnv({ PGOPTIONS: "-c default_transaction_read_only=on" }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume(); // Never expose database diagnostics.
  const closed = new Promise((resolve) => { child.on("error", () => resolve(1)); child.on("close", resolve); });
  const lines = readline.createInterface({ input: child.stdout });
  const exported = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Snapshot export timed out")), 15000);
    lines.once("line", (line) => {
      clearTimeout(timer);
      /^[0-9A-F]+-[0-9A-F]+-\d+$/i.test(line.trim()) ? resolve(line.trim()) : reject(new Error("Invalid exported snapshot"));
    });
    closed.then(() => { clearTimeout(timer); reject(new Error("Snapshot export failed")); });
  });
  child.stdin.on("error", () => {});
  child.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n");
  try { return await fn(await exported); }
  finally {
    child.stdin.end("ROLLBACK;\n\\q\n");
    await closed;
    lines.close();
  }
}
