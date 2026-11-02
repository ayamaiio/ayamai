// Fill in preview tiles for the whole library.
//
//   cd artifacts/api-server
//   set -a; . ../../.local/runtime.env; set +a
//   node scripts/backfill-previews.mjs [--concurrency 6] [--kind video|image|all] [--limit 500]
//
// Tiles are generated on demand, one screenful at a time, so a fresh library is
// black rectangles until each has been rendered. This walks the library once and
// leaves the grid instant afterwards. It skips items that already have a tile,
// so it is safe to run again after more imports.
//
// Rendering is the real renderer (preview-render.ts). Only "write the bytes next
// to the object" is repeated here, because the storage module pulls in the
// database package and this script deliberately runs without it.
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { renderPreview } from "../src/lib/preview-render.ts";

const require = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Client } = require("pg");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const CONCURRENCY = Math.max(1, Number(arg("--concurrency", 6)));
const KIND = arg("--kind", "all");
const LIMIT = Number(arg("--limit", Number.MAX_SAFE_INTEGER));

const root = process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim();
if (!root) { console.error("AYAMAI_LOCAL_MEDIA_ROOT is not set; this tool only fills local libraries."); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set. Source .local/runtime.env first."); process.exit(1); }

function objectPath(objectKey) {
  const base = resolve(root);
  const segments = objectKey.split("/");
  if (!objectKey || objectKey.startsWith("/") || segments.some((p) => !p || p === "." || p === ".." || p.includes("\\"))) return undefined;
  const target = resolve(base, ...segments);
  return target.startsWith(`${base}${sep}`) ? target : undefined;
}
const tilePath = (source) => `${source}.previews/v1/tile.jpg`;
const exists = async (path) => { try { await stat(path); return true; } catch { return false; } };

const work = await mkdtemp(join(tmpdir(), "preview-backfill-"));
const started = Date.now();
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  `select id, object_key, media_type from media_items
    where moderation_state = 'active' and ($1 = 'all' or media_type = $1)
    order by (media_type = 'video') desc, created_at desc`,
  [KIND],
);
await client.end();

console.log(`scanning ${rows.length} rows (concurrency ${CONCURRENCY}, ${KIND})`);
const todo = [];
for (const row of rows) {
  if (todo.length >= LIMIT) break;
  const source = objectPath(row.object_key);
  if (!source || await exists(tilePath(source))) continue;
  todo.push({ ...row, source });
  if (todo.length % 2000 === 0) process.stdout.write(`\r  missing ${todo.length}   `);
}
console.log(`\nmissing ${todo.length} of ${rows.length}`);

let done = 0;
let failed = 0;
let cursor = 0;

async function worker() {
  for (;;) {
    const row = todo[cursor++];
    if (!row) return;
    try {
      if (!(await exists(row.source))) throw new Error("missing source");
      const body = await renderPreview(row.source, row.media_type, join(work, `${row.id}.png`));
      const target = tilePath(row.source);
      await mkdir(join(target, ".."), { recursive: true });
      const temp = `${target}.${process.pid}.${cursor}.tmp`;
      await writeFile(temp, body);
      await rename(temp, target);
      await rm(join(work, `${row.id}.png`), { force: true });
      done += 1;
    } catch {
      failed += 1;
    }
    if ((done + failed) % 50 === 0) {
      const per = (Date.now() - started) / 1000 / Math.max(1, done + failed);
      console.log(`  ${done} ok, ${failed} failed, ${per.toFixed(2)}s/item, ~${Math.round((per * (todo.length - done - failed)) / 60)} min left`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`finished: ${done} generated, ${failed} failed, ${((Date.now() - started) / 60000).toFixed(1)} min`);
await rm(work, { recursive: true, force: true });
process.exit(0);
