#!/usr/bin/env node
// Ayamai dev-snapshot: production-to-local database/media snapshot tooling.
// Read-only against the source, atomic + guarded restore into an isolated DB.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { EXCLUDED_TABLES, DENIED_COLUMNS, IDENTITY_COLUMN_HINTS } from "./policy.mjs";
import {
  buildCaptureArgs, splitCaptureOutput, countRows,
  buildRestoreArgs, validateIdentityMap, safeDestPath, verifyIntegrity,
  unknownTables, isAllowedTable, validByteCap, copyMediaBody, assertNoSymlinks,
} from "./lib.mjs";
import {
  sh, psql, parseUrl, redactUrl, assertLocalTarget, sha256File, stamp, ensureDir, writePrivate, gpg, withSourceSnapshot,
} from "./util.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SNAP_ROOT = process.env.AYAMAI_SNAPSHOT_ROOT || path.join(os.homedir(), "ayamai-snapshots");

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const has = (flag) => process.argv.includes(flag);
const positional = (n = 3) => (process.argv[n] && !process.argv[n].startsWith("-") ? process.argv[n] : null);

function snapshotDir(name) {
  const dir = path.isAbsolute(name) ? name : path.join(SNAP_ROOT, name);
  if (!fs.existsSync(dir)) throw new Error(`snapshot not found: ${dir}`);
  return dir;
}
function latestSnapshot() {
  const dirs = fs.existsSync(SNAP_ROOT)
    ? fs.readdirSync(SNAP_ROOT).map((d) => path.join(SNAP_ROOT, d))
        .filter((d) => fs.existsSync(path.join(d, "index.json"))).sort()
    : [];
  if (!dirs.length) throw new Error("no snapshots available");
  return dirs[dirs.length - 1];
}
function resolveSnapshot() {
  const p = positional();
  return p ? snapshotDir(p) : (arg("--snapshot") ? snapshotDir(arg("--snapshot")) : latestSnapshot());
}

function passphraseFile() {
  const f = arg("--passphrase-file") || process.env.AYAMAI_SNAPSHOT_PASSPHRASE_FILE;
  if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile() || fs.statSync(f).size === 0) {
    throw new Error("passphrase file required: --passphrase-file or AYAMAI_SNAPSHOT_PASSPHRASE_FILE");
  }
  return f;
}

function decryptAll(dir, tmp) {
  verifyIntegrity(dir);
  const pass = passphraseFile();
  ensureDir(tmp);
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".gpg"))) {
    gpg(["--decrypt", "-o", path.join(tmp, f.replace(/\.gpg$/, "")), path.join(dir, f)], pass);
  }
  return tmp;
}

// Guarantees decrypted plaintext never survives a failure path.
async function withDecrypted(dir, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ayamai-snap-"));
  try {
    decryptAll(dir, tmp);
    return await fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function dataTables(url, snapshot) {
  const out = psql(url, `select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' order by 1`, { snapshot });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function columnsOf(url, table, snapshot) {
  const out = psql(url, `select column_name||E'\\t'||is_nullable||E'\\t'||data_type
    from information_schema.columns where table_schema='public' and table_name='${table}'
    order by ordinal_position`, { snapshot });
  return out.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const [name, nullable, dataType] = line.split("\t");
    return { name, nullable: nullable === "YES", dataType, table };
  });
}

function identityColumns(url, snapshot) {
  const out = psql(url, `select table_name||'.'||column_name from information_schema.columns
    where table_schema='public' and column_name in (${[...IDENTITY_COLUMN_HINTS].map((c) => `'${c}'`).join(",")})`, { snapshot });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

async function cmdSnapshot() {
  const source = arg("--source") || process.env.AYAMAI_SNAPSHOT_SOURCE_URL;
  if (!source) throw new Error("snapshot source required: --source <postgres url> (read-only)");
  const pass = passphraseFile(); // Validate before connecting or writing plaintext.
  const label = (arg("--label") || "prod").replace(/[^a-zA-Z0-9_-]/g, "");
  const dir = path.join(SNAP_ROOT, `${stamp()}-${label}`);
  ensureDir(SNAP_ROOT);
  ensureDir(dir);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ayamai-capture-"));
  let complete = false;
  try {
    await withSourceSnapshot(source, async (snapshot) => {

      const readOnly = { PGOPTIONS: "-c default_transaction_read_only=on" };
      const t = parseUrl(source);
      console.log(`source: ${t.host}:${t.port}/${t.database} (read-only session)`);

      const present = dataTables(source, snapshot);
      const unreviewed = unknownTables(present);
      if (unreviewed.length) {
        throw new Error(`refusing to snapshot: unreviewed table(s) present: ${unreviewed.join(", ")}. ` +
          "Add them to ALLOWED_TABLES or EXCLUDED_TABLES in policy.mjs after a privacy review.");
      }
      const tables = present.filter(isAllowedTable);

      for (const section of ["pre-data", "post-data"]) {
        sh("pg_dump", ["--schema-only", "--schema=public", "--section=" + section,
          "--no-owner", "--no-privileges", "--no-comments", "--snapshot", snapshot,
          "-w", "-d", source, "-f", path.join(tmp, section + ".sql")], { env: readOnly });
      }

      const marker = `__AYAMAI_END_${crypto.randomUUID()}__`;
      const colsByName = {};
      for (const table of tables) colsByName[table] = columnsOf(source, table, snapshot);
      const out = sh("psql", buildCaptureArgs(source, tables, colsByName, marker, snapshot), { env: readOnly });
      const segments = splitCaptureOutput(out, marker, tables.length);

      const counts = {};
      const blocks = tables.map((table, i) => {
        counts[table] = countRows(segments[i]);
        const cols = colsByName[table].map((c) => `"${c.name}"`).join(", ");
        return `COPY public."${table}" (${cols}) FROM stdin;\n${segments[i]}\\.\n`;
      });
      const rows = Object.values(counts).reduce((a, b) => a + b, 0);
      writePrivate(path.join(tmp, "data.sql"), blocks.join("\n"));
      console.log(`tables: ${tables.length}, rows: ${rows}, excluded: ${EXCLUDED_TABLES.size}`);

      const media = psql(source, `select json_build_object(
          'id', id, 'object_key', object_key, 'size', size, 'content_type', content_type,
          'media_type', media_type, 'visibility', visibility, 'collection', collection,
          'created_at', created_at, 'user_id', user_id)
        from public.media_items order by created_at`, { snapshot });
      const mediaRows = media.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const manifest = {
        generated_at: new Date().toISOString(),
        source: { host: t.host, port: t.port, database: t.database },
        media: mediaRows,
        totals: {
          media_count: mediaRows.length,
          media_bytes: mediaRows.reduce((a, m) => a + Number(m.size || 0), 0),
          rows,
          tables: counts,
        },
        checksums: { algorithm: "none-in-source", note: "media_items has no checksum column; media-copy records SHA-256 + ETag" },
      };
      writePrivate(path.join(tmp, "manifest.json"), JSON.stringify(manifest, null, 2));

      const identCols = identityColumns(source, snapshot);
      const ids = new Set();
      for (const tc of identCols) {
        const [table, col] = tc.split(".");
        const vals = psql(source, `select distinct "${col}" from public."${table}" where "${col}" is not null`, { snapshot });
        vals.split("\n").map((v) => v.trim()).filter(Boolean).forEach((v) => ids.add(v));
      }
      writePrivate(path.join(tmp, "identity-map.template.json"), JSON.stringify({
        note: "Map each production Clerk subject to a Clerk TEST-instance user id. Unmapped ids become inert placeholders.",
        mappings: Object.fromEntries([...ids].map((id) => [id, ""])),
      }, null, 2));

      const meta = {
        schema_version: 3,
        created_at: new Date().toISOString(),
        source: { host: t.host, port: t.port, database: t.database },
        excluded_tables: [...EXCLUDED_TABLES],
        denied_columns: [...DENIED_COLUMNS],
        identity_columns: identCols.filter((tc) => isAllowedTable(tc.split(".")[0])),
        identity_ids: [...ids],
        tables: counts,
      };
      writePrivate(path.join(tmp, "meta.json"), JSON.stringify(meta, null, 2));

      const index = { encrypted: true, files: {} };
      for (const f of ["pre-data.sql", "post-data.sql", "data.sql", "manifest.json", "meta.json", "identity-map.template.json"]) {
        const full = path.join(tmp, f);
        const digest = sha256File(full);
        gpg(["--cipher-algo", "AES256", "--symmetric", "-o", path.join(dir, `${f}.gpg`), full], pass);
        fs.unlinkSync(full);
        try { fs.chmodSync(path.join(dir, `${f}.gpg`), 0o600); } catch {}
        index.files[`${f}.gpg`] = { sha256: sha256File(path.join(dir, `${f}.gpg`)), plaintext_sha256: digest };
      }
      writePrivate(path.join(dir, "index.json"), JSON.stringify(index, null, 2));
      complete = true;
      console.log(`snapshot complete: ${dir}`);
      console.log(`media: ${manifest.totals.media_count} items / ${manifest.totals.media_bytes} bytes`);
      console.log("next: decrypt the identity map template into a private file before restoring");
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!complete) fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function cmdRestore() {
  const dir = resolveSnapshot();
  const target = arg("--target") || process.env.AYAMAI_LOCAL_DATABASE_URL;
  if (!target) throw new Error("restore target required: --target or AYAMAI_LOCAL_DATABASE_URL");
  assertLocalTarget(target, {
    allowDb: process.env.AYAMAI_SNAPSHOT_ALLOW_DB || "ayamai_local",
    allowHost: "127.0.0.1",
    allowPort: "5434",
  });
  verifyIntegrity(dir);

  const mapFile = arg("--identity-map") || path.join(dir, "identity-map.json");
  const identityMap = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, "utf8")) : { mappings: {} };

  const backupDir = path.join(SNAP_ROOT, "backups");
  ensureDir(backupDir);
  const backup = path.join(backupDir, `local-${stamp()}.dump`);
  writePrivate(backup, "");
  sh("pg_dump", ["-Fc", "--no-owner", "--no-privileges", "-w", "-d", target, "-f", backup]);
  console.log(`local backup: ${backup}`);

  const result = await withDecrypted(dir, async (tmp) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, "manifest.json"), "utf8"));
    const meta = JSON.parse(fs.readFileSync(path.join(tmp, "meta.json"), "utf8"));
    if (meta.schema_version !== 3 || !Array.isArray(meta.identity_columns) || !Array.isArray(meta.identity_ids)) {
      throw new Error("snapshot predates identity_columns metadata; re-capture it before restoring");
    }

    const pairs = validateIdentityMap(identityMap, meta.identity_ids);
    const stmts = [
      "CREATE TEMP TABLE _identity_map(prod text primary key, dev text not null) ON COMMIT PRESERVE ROWS;",
    ];
    if (pairs.length) {
      const values = pairs.map(([k, v]) => `('${String(k).replace(/'/g, "''")}','${String(v).replace(/'/g, "''")}')`).join(",");
      stmts.push(`INSERT INTO _identity_map VALUES ${values};`);
    }
    for (const tc of meta.identity_columns) {
      const [table, col] = tc.split(".");
      if (!/^[a-z0-9_]+$/.test(table) || !/^[a-z0-9_]+$/.test(col)) continue;
      stmts.push(`UPDATE public."${table}" s SET "${col}" = COALESCE(
          (SELECT m.dev FROM _identity_map m WHERE m.prod = s."${col}"),
          'dev-unmapped:' || md5(s."${col}"))
        WHERE s."${col}" IS NOT NULL;`);
    }
    writePrivate(path.join(tmp, "99-map.sql"), stmts.join("\n") + "\n");
    writePrivate(path.join(tmp, "00-reset.sql"), "DROP SCHEMA IF EXISTS public CASCADE;\n");

    const checks = Object.entries(manifest.totals.tables).map(([table, count]) => {
      if (!isAllowedTable(table) || !Number.isSafeInteger(count) || count < 0) throw new Error("Invalid row-count metadata");
      return `DO $$ BEGIN IF (SELECT count(*) FROM public."${table}") <> ${count} THEN RAISE EXCEPTION 'Snapshot row count mismatch'; END IF; END $$;`;
    });
    writePrivate(path.join(tmp, "100-verify.sql"), checks.join("\n"));
    sh("psql", buildRestoreArgs(target, ["00-reset.sql", "pre-data.sql", "data.sql", "99-map.sql", "post-data.sql", "100-verify.sql"]
      .map((f) => path.join(tmp, f))), { env: { PGOPTIONS: "-c client_min_messages=warning" } });

    const mismatches = [];
    for (const [table, expected] of Object.entries(manifest.totals.tables)) {
      const actual = Number(psql(target, `select count(*) from public."${table}"`).trim());
      if (actual !== expected) mismatches.push(`${table}: expected ${expected}, got ${actual}`);
    }
    return { manifest, mismatches, mapped: pairs.length };
  });

  console.log(`restored ${Object.keys(result.manifest.totals.tables).length} tables into ${redactUrl(target)}`);
  console.log(`identity mappings applied: ${result.mapped} (unmapped -> inert dev-unmapped:*)`);
  if (result.mismatches.length) {
    console.log(`row count mismatches: ${result.mismatches.join("; ")}`);
    process.exitCode = 1;
  } else console.log("row counts verified");
}

async function cmdVerify() {
  const dir = resolveSnapshot();
  verifyIntegrity(dir);
  await withDecrypted(dir, async (tmp) => {
    const meta = JSON.parse(fs.readFileSync(path.join(tmp, "meta.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, "manifest.json"), "utf8"));
    console.log(`ok ${path.basename(dir)}: ${Object.keys(meta.tables).length} tables, ` +
      `${manifest.totals.media_count} media, created ${meta.created_at}`);
  });
}

async function cmdMediaPlan() {
  const dir = resolveSnapshot();
  await withDecrypted(dir, async (tmp) => {
    const m = JSON.parse(fs.readFileSync(path.join(tmp, "manifest.json"), "utf8"));
    const byVisibility = {};
    for (const item of m.media) {
      byVisibility[item.visibility] = byVisibility[item.visibility] || { count: 0, bytes: 0 };
      byVisibility[item.visibility].count++;
      byVisibility[item.visibility].bytes += Number(item.size || 0);
    }
    console.log(`media items: ${m.totals.media_count}, bytes: ${m.totals.media_bytes}`);
    for (const [k, v] of Object.entries(byVisibility)) console.log(`  ${k}: ${v.count} items, ${v.bytes} bytes`);
    console.log("copy is NOT performed here. Requires --owner, --dest, --max-bytes, --confirm-copy.");
  });
}

async function cmdMediaCopy() {
  const dir = resolveSnapshot();
  const owner = arg("--owner");
  if (!owner) throw new Error("--owner <production clerk user id> required: scope limits the copy to that owner's objects");
  const prefix = arg("--prefix") || `media/${owner}/`;
  const maxBytes = validByteCap(arg("--max-bytes"));
  const dest = path.resolve(arg("--dest") || path.join(SNAP_ROOT, "media", path.basename(dir)));
  const confirm = has("--confirm-copy");

  await withDecrypted(dir, async (tmp) => {
    const m = JSON.parse(fs.readFileSync(path.join(tmp, "manifest.json"), "utf8"));
    const scoped = m.media.filter((i) => String(i.object_key).startsWith(prefix));
    for (const item of scoped) {
      if (String(item.user_id) !== String(owner)) {
        throw new Error(`object ${item.object_key} belongs to ${item.user_id}, not ${owner}; refusing cross-owner copy`);
      }
      assertNoSymlinks(safeDestPath(dest, item.object_key));
      if (!Number.isSafeInteger(Number(item.size)) || Number(item.size) < 0) throw new Error("Invalid media size");
    }
    const total = scoped.reduce((a, i) => a + Number(i.size || 0), 0);
    console.log(`scope ${prefix}: ${scoped.length}/${m.media.length} objects, ${total} bytes`);
    if (!Number.isSafeInteger(total) || total > maxBytes) throw new Error(`selection is ${total} bytes > --max-bytes ${maxBytes}`);
    if (!confirm) {
      for (const i of scoped.slice(0, 5)) console.log(`  ${i.object_key} (${i.size} B)`);
      console.log("dry run only. Pass --confirm-copy, --dest and read-only R2 credentials to fetch.");
      return;
    }
    for (const name of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_R2_ACCESS_KEY_ID", "CLOUDFLARE_R2_SECRET_ACCESS_KEY", "CLOUDFLARE_R2_BUCKET_NAME"]) {
      if (!process.env[name]) throw new Error(`missing ${name} (read-only R2 credentials for the source bucket)`);
    }
    const { createRequire } = await import("node:module");
    const req = createRequire(path.join(REPO_ROOT, "artifacts/api-server/package.json"));
    const { S3Client, GetObjectCommand } = req("@aws-sdk/client-s3");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
      },
    });
    assertNoSymlinks(dest);
    const budget = { remaining: maxBytes };
    const checksums = {};
    for (const item of scoped) {
      const out = safeDestPath(dest, item.object_key);
      // Reads only: this client has no upload/delete calls.
      const res = await client.send(new GetObjectCommand({ Bucket: process.env.CLOUDFLARE_R2_BUCKET_NAME, Key: item.object_key }));
      if (res.ContentLength != null && Number(res.ContentLength) !== Number(item.size)) {
        res.Body?.destroy?.();
        throw new Error("Media content length mismatch");
      }
      const copied = await copyMediaBody(res.Body, out, Number(item.size), budget);
      const written = copied.bytes;
      checksums[item.object_key] = { ...copied, etag: res.ETag || null };
      console.log(`  fetched ${item.object_key} -> ${written} B`);
    }
    const receipt = Buffer.from(JSON.stringify({ scope: prefix, fetched_at: new Date().toISOString(), objects: checksums }, null, 2));
    await copyMediaBody([receipt], path.join(dest, "checksums.json"), receipt.length, { remaining: receipt.length });
    console.log(`media copied to ${dest} (source objects were only read)`);
  });
}

function cmdList() {
  if (!fs.existsSync(SNAP_ROOT)) return console.log("no snapshots");
  for (const d of fs.readdirSync(SNAP_ROOT).sort()) {
    if (fs.existsSync(path.join(SNAP_ROOT, d, "index.json"))) console.log(d);
  }
}

const commands = {
  snapshot: cmdSnapshot, "snapshot-prod": cmdSnapshot,
  restore: cmdRestore, "restore-local": cmdRestore,
  reset: cmdRestore, "reset-local": cmdRestore,
  verify: cmdVerify, "media-plan": cmdMediaPlan, "media-copy": cmdMediaCopy, list: cmdList,
};
try {
  if (!commands[process.argv[2]]) {
    console.log(`usage: cli.mjs <${Object.keys(commands).join("|")}> [options]`);
    process.exitCode = 1;
  } else await commands[process.argv[2]]();
} catch (err) {
  // Unknown errors (JSON, SDK, filesystem) can embed private data or credentials.
  console.error("ERROR: snapshot command failed; database/provider diagnostics suppressed.");
  process.exitCode = 1;
}
