// Shared policy, argument and filesystem helpers exercised directly by tests.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ALLOWED_TABLES, EXCLUDED_TABLES, DENIED_COLUMNS, SANITIZED_COLUMNS, REVIEWED_COLUMNS } from "./policy.mjs";

export function isAllowedTable(name) {
  return ALLOWED_TABLES.has(name);
}
export function isKnownTable(name) {
  return ALLOWED_TABLES.has(name) || EXCLUDED_TABLES.has(name);
}
export function unknownTables(present) {
  return present.filter((t) => !isKnownTable(t));
}

export function emptyValueFor(dataType) {
  const t = String(dataType || "").toLowerCase();
  if (t === "jsonb") return "'{}'::jsonb";
  if (t === "json") return "'{}'::json";
  if (t.endsWith("[]")) return "'{}'";
  return "''";
}

// A column is either passed through, nulled, type-emptied, or redacted with a
// stable placeholder (denied NOT NULL text columns keep their constraint).
export function columnExpr(col) {
  const name = String(col.name).toLowerCase();
  if (!DENIED_COLUMNS.has(name) && !REVIEWED_COLUMNS[col.table]?.includes(col.name)) throw new Error("Unreviewed snapshot column; update policy after privacy review");
  if (col.table === "social_profiles" && name === "handle") return "('dev-' || md5(user_id))";
  // Preserve only reviewed gallery fields, never original names or unknown JSON keys.
  if (col.table === "media_items" && name === "gallery_images") return `(SELECT COALESCE(jsonb_agg(jsonb_build_object('id', g->>'id', 'objectKey', g->>'objectKey', 'originalName', '', 'contentType', g->>'contentType', 'size', g->'size')), '[]'::jsonb) FROM jsonb_array_elements(gallery_images) g)`;
  if (DENIED_COLUMNS.has(name)) return col.nullable ? "NULL" : "('redacted-' || substr(md5(ctid::text),1,12))";
  if (SANITIZED_COLUMNS.has(`${col.table}.${name}`)) return col.nullable ? "NULL" : emptyValueFor(col.dataType);
  return `"${col.name}"`;
}

// The capture runs as one REPEATABLE READ transaction so every table sees the
// same snapshot; each COPY is followed by a unique marker used to split output.
export function buildCaptureArgs(source, tables, colsByName, marker, snapshot) {
  const args = [source, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1",
    "-c", "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"];
  if (snapshot) args.push("-c", `SET TRANSACTION SNAPSHOT '${snapshot}'`);
  for (const table of tables) {
    const cols = colsByName[table];
    args.push("-c", `COPY (SELECT ${cols.map(columnExpr).join(", ")} FROM public."${table}") TO STDOUT`);
    args.push("-c", String.raw`\echo ${marker}`);
  }
  return args;
}

export function splitCaptureOutput(out, marker, tableCount) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = out.replace(/\r\n/g, "\n").split(new RegExp(`^${escaped}(?:\\n|$)`, "m"));
  if (parts.length !== tableCount + 1 || parts.at(-1) !== "") throw new Error("Incomplete capture markers");
  return parts.slice(0, -1);
}

export function countRows(segment) {
  return segment ? segment.replace(/\n$/, "").split("\n").length : 0;
}

// Restores must be atomic: all files are applied inside one transaction.
export function buildRestoreArgs(target, files) {
  return [target, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-1", ...files.flatMap((f) => ["-f", f])];
}

const RESERVED = "dev-unmapped:";

export function validateIdentityMap(map, productionIds = Object.keys(map?.mappings || {})) {
  if (!map || typeof map.mappings !== "object" || Array.isArray(map.mappings) || map.mappings === null) throw new Error("identity map requires a mappings object");
  const prodIds = new Set(productionIds);
  for (const [prod, dev] of Object.entries(map.mappings)) {
    if (!prodIds.has(prod)) throw new Error("identity map contains an unknown production subject");
    if (typeof dev === "string" && dev.startsWith(RESERVED)) throw new Error("identity map may not target the reserved dev-unmapped prefix");
    if (typeof dev !== "string" || (dev && (dev.trim() !== dev || !/^[A-Za-z0-9_-]+$/.test(dev)))) throw new Error("identity map target must be a valid subject string");
  }
  const pairs = Object.entries(map?.mappings || {}).filter(([, v]) => v);
  const seen = new Map();
  for (const [prod, dev] of pairs) {
    if (seen.has(dev)) {
      throw new Error(`identity map maps both ${seen.get(dev)} and ${prod} to ${dev}; one dev account must not inherit two identities`);
    }
    seen.set(dev, prod);
  }
  for (const [prod, dev] of pairs) {
    if (prodIds.has(dev)) throw new Error(`identity map target ${dev} is itself a production subject`);
  }
  return pairs;
}

// Every media object must stay inside the destination directory.
export function safeDestPath(dest, objectKey) {
  const root = path.resolve(dest);
  if (typeof objectKey !== "string" || objectKey.includes("\\") || objectKey.includes("\0") || /^[a-z]:/i.test(objectKey)) throw new Error("object key escapes destination");
  const rel = String(objectKey).replace(/^\/+/, "");
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`object key escapes destination: ${objectKey}`);
  }
  return resolved;
}

export function validByteCap(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error("--max-bytes must be a positive safe integer");
  return Number(value);
}

export function assertNoSymlinks(file) {
  const full = path.resolve(file);
  const root = path.parse(full).root;
  let current = root;
  for (const part of full.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlink in media destination"); }
    catch (err) { if (err.code !== "ENOENT") throw err; }
  }
}

// Walk pinned directory descriptors, so a parent cannot be swapped for a
// symlink between validation and open. Node has no portable openat interface;
// fail closed outside Linux rather than silently use a race-prone fallback.
export async function copyMediaBody(body, out, expected, budget) {
  try {
    if (process.platform !== "linux") throw new Error("Race-safe media copy requires Linux with /proc/self/fd (use a local container)");
    assertNoSymlinks(out);
  } catch (err) { body.destroy?.(); throw err; }
  const parts = path.resolve(out).split(path.sep).filter(Boolean);
  const leaf = parts.pop();
  let parent = fs.openSync("/", fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  let fd;
  let pinned;
  try {
    for (const part of parts) {
      const next = `/proc/self/fd/${parent}/${part}`;
      try { fs.mkdirSync(next, { mode: 0o700 }); } catch (err) { if (err.code !== "EEXIST") throw err; }
      const opened = fs.openSync(next, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      fs.closeSync(parent); parent = opened;
    }
    pinned = `/proc/self/fd/${parent}/${leaf}`;
    fd = fs.openSync(pinned, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  } catch (err) { fs.closeSync(parent); body.destroy?.(); throw err; }
  const hash = crypto.createHash("sha256");
  let written = 0;
  let complete = false;
  try {
    for await (const incoming of body) {
      const chunk = Buffer.isBuffer(incoming) ? incoming : Buffer.from(incoming);
      if (written + chunk.length > expected || budget.remaining < chunk.length) throw new Error("Media download exceeds byte cap or declared size");
      fs.writeFileSync(fd, chunk);
      hash.update(chunk); written += chunk.length; budget.remaining -= chunk.length;
    }
    if (written !== expected) throw new Error("Media download size mismatch");
    complete = true;
    return { bytes: written, sha256: hash.digest("hex") };
  } finally {
    fs.closeSync(fd);
    try { if (!complete) { body.destroy?.(); fs.unlinkSync(pinned); } }
    finally { fs.closeSync(parent); }
  }
}

// Detects bit-rot / partial copies before any database write happens.
export function verifyIntegrity(dir, hashFile = (f) => sha256(fs.readFileSync(f))) {
  const indexFile = path.join(dir, "index.json");
  if (!fs.existsSync(indexFile)) throw new Error(`snapshot is incomplete (no index.json): ${dir}`);
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  for (const [name, meta] of Object.entries(index.files || {})) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) throw new Error(`snapshot file missing: ${name}`);
    if (meta.sha256 && hashFile(full) !== meta.sha256) throw new Error(`snapshot file corrupt: ${name}`);
  }
  return index;
}

export function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
