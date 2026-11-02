#!/usr/bin/env node
// Bounded local-directory importer for the private library.
// Dry-run by default. Content-addressed object keys make re-runs idempotent.
// No schema, access, or membership changes.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const MAX_TITLE = 255;
const MAX_SINGLE_UPLOAD = 5 * 1024 ** 3;
const BATCH = 200;

const TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/gif': ['.gif'],
  'image/webp': ['.webp'], 'image/avif': ['.avif'], 'image/bmp': ['.bmp'],
  'image/heic': ['.heic'], 'image/heif': ['.heif'],
  'video/mp4': ['.mp4'], 'video/x-m4v': ['.m4v'], 'video/webm': ['.webm'],
  'video/x-matroska': ['.mkv'], 'video/x-msvideo': ['.avi'], 'video/quicktime': ['.mov'],
  'video/mpeg': ['.mpg', '.mpeg'], 'video/3gpp': ['.3gp'],
};
const BY_EXT = new Map();
for (const [mime, exts] of Object.entries(TYPES)) for (const e of exts) BY_EXT.set(e, mime);

const mediaTypeOf = (mime) => (mime.startsWith('image/') ? 'image' : 'video');

/** Cheap container-signature check so mislabelled files cannot enter the library. */
function signatureOk(head, mime) {
  const ascii = (from, to) => head.toString('latin1', from, to);
  switch (mime) {
    case 'image/jpeg': return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/png': return head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case 'image/gif': return ascii(0, 4) === 'GIF8';
    case 'image/webp': return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/bmp': return ascii(0, 2) === 'BM';
    case 'image/avif': return ascii(4, 8) === 'ftyp' && /avi[fs]/.test(ascii(8, 12));
    case 'image/heic': case 'image/heif': return ascii(4, 8) === 'ftyp' && /hei[cfm]|mif1|msf1/.test(ascii(8, 12));
    case 'video/mp4': case 'video/x-m4v': case 'video/quicktime': case 'video/3gpp': return ascii(4, 8) === 'ftyp';
    case 'video/webm': case 'video/x-matroska': return head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case 'video/x-msvideo': return ascii(0, 4) === 'RIFF' && ascii(8, 11) === 'AVI';
    case 'video/mpeg': return head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01;
    default: return false;
  }
}

async function walk(dir, out, skip) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
      await walk(full, out, skip);
    } else if (entry.isFile()) out.push(full);
  }
  return out;
}

function parseArgs(argv) {
  const args = { dirs: [], apply: false, collection: null, limit: Infinity, concurrency: 4, expectRoot: null, skip: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--collection') args.collection = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (a === '--expect-root') args.expectRoot = argv[++i];
    else if (a === '--skip-dir') args.skip.add(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
    else args.dirs.push(a);
  }
  if (!args.dirs.length) {
    throw new Error('Usage: import-local-dir.mjs <dir...> [--apply --expect-root PATH] [--collection NAME] [--limit N] [--concurrency N]');
  }
  return args;
}

function requireConfig(args) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const parsed = new URL(url);
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol) || parsed.hostname !== '127.0.0.1') {
    throw new Error('Refusing a non-loopback or non-PostgreSQL database; this importer is local-only.');
  }
  const root = process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim();
  if (!root) throw new Error('AYAMAI_LOCAL_MEDIA_ROOT is not set.');
  const resolved = path.resolve(root);
  if (args.apply) {
    if (!args.expectRoot) throw new Error('--apply requires --expect-root <resolved media root>.');
    if (path.resolve(args.expectRoot) !== resolved) {
      throw new Error(`Destination mismatch: --expect-root ${args.expectRoot} != ${resolved}`);
    }
  }
  return resolved;
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function readHead(file, bytes = 16) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = requireConfig(args);

  const require = createRequire(new URL('../lib/db/package.json', import.meta.url));
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();

  const stats = { scanned: 0, supported: 0, unsupported: 0, tooBig: 0, badSignature: 0,
                  duplicateInRun: 0, alreadyPresent: 0, inserted: 0, wouldInsert: 0, failed: 0, bytes: 0 };
  const seen = new Set();
  const queue = [];

  // A single pg client cannot serve interleaved queries from concurrent workers,
  // so every database access is serialized through one chain.
  let chain = Promise.resolve();
  const withLock = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  };
  const query = (text, params) => withLock(() => client.query(text, params));

  const drain = () => withLock(async () => {
    while (queue.length) {
      const chunk = queue.splice(0, BATCH);
      await client.query('BEGIN');
      try {
        for (const r of chunk) {
          const res = await client.query(
            `INSERT INTO media_items
               (user_id,title,collection,description,tags,visibility,attribution,moderation_state,
                original_name,object_key,content_type,media_type,size,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (object_key) DO NOTHING RETURNING id`,
            [r.userId, r.title, r.collection, r.description, r.tags, r.visibility, r.attribution,
             r.moderationState, r.originalName, r.objectKey, r.contentType, r.mediaType, r.size, r.createdAt]);
          if (res.rowCount) stats.inserted++; else stats.alreadyPresent++;
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  });

  try {
    const owners = await query("SELECT user_id FROM access_memberships WHERE role='owner' AND status='active' LIMIT 2");
    if (owners.rows.length !== 1) throw new Error('Expected exactly one active owner membership; no changes made.');
    const owner = owners.rows[0].user_id;

    const files = [];
    for (const dir of args.dirs) {
      const abs = path.resolve(dir);
      if (!(await stat(abs).catch(() => null))?.isDirectory()) throw new Error(`Not a directory: ${dir}`);
      await walk(abs, files, args.skip);
    }
    stats.scanned = files.length;
    files.sort();
    const baseDir = path.resolve(args.dirs[0]);

    const candidates = [];
    for (const file of files) {
      const mime = BY_EXT.get(path.extname(file).toLowerCase());
      if (!mime) { stats.unsupported++; continue; }
      const info = await stat(file);
      if (info.size === 0) { stats.unsupported++; continue; }
      if (info.size > MAX_SINGLE_UPLOAD) { stats.tooBig++; continue; }
      candidates.push({ file, mime, size: info.size, mtime: info.mtime });
      if (candidates.length >= args.limit) break;
    }
    stats.supported = candidates.length;
    console.log(`scanned=${stats.scanned} supported=${candidates.length} unsupported=${stats.unsupported} ` +
                `tooBig=${stats.tooBig} mode=${args.apply ? 'APPLY' : 'dry-run'} root=${root}`);

    let processed = 0;
    const worker = async () => {
      for (;;) {
        const item = candidates.shift();
        if (!item) return;
        try {
          if (!signatureOk(await readHead(item.file), item.mime)) { stats.badSignature++; continue; }
          const sha = await hashFile(item.file);
          if (seen.has(sha)) { stats.duplicateInRun++; continue; }
          seen.add(sha);

          const ext = path.extname(item.file).toLowerCase();
          const objectKey = `media/${owner}/local/${sha}${ext}`;
          if ((await query('SELECT 1 FROM media_items WHERE object_key=$1', [objectKey])).rowCount) {
            stats.alreadyPresent++;
            continue;
          }

          if (args.apply) {
            const final = path.join(root, objectKey);
            const tmp = `${final}.tmp-${randomUUID()}`;
            await mkdir(path.dirname(final), { recursive: true });
            await pipeline(createReadStream(item.file), createWriteStream(tmp));
            if ((await stat(tmp)).size !== item.size) { await rm(tmp, { force: true }); throw new Error('Size changed while copying.'); }
            await rename(tmp, final);
          }

          if (args.apply) {
            queue.push({
              userId: owner,
              title: path.basename(item.file, path.extname(item.file)).trim().slice(0, MAX_TITLE) || 'Untitled',
              collection: args.collection ?? null,
              description: `Imported from local archive.\nSource: ${path.relative(baseDir, item.file)}\nSHA-256: ${sha}\nOriginal size: ${item.size} bytes`,
              tags: ['local-import'], visibility: 'private', attribution: 'anonymous', moderationState: 'active',
              originalName: path.basename(item.file), objectKey, contentType: item.mime,
              mediaType: mediaTypeOf(item.mime), size: item.size, createdAt: item.mtime,
            });
            if (queue.length >= BATCH) await drain();
          } else {
            stats.wouldInsert++;
          }
          stats.bytes += item.size;
        } catch (error) {
          stats.failed++;
          if (stats.failed <= 5) console.error(`failed: ${path.relative(baseDir, item.file)}: ${error.message}`);
        } finally {
          processed++;
          if (processed % 25 === 0) {
            console.error(`progress=${processed} inserted=${stats.inserted} dupInRun=${stats.duplicateInRun} present=${stats.alreadyPresent} failed=${stats.failed}`);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));
    if (args.apply) await drain();
    console.log(JSON.stringify({ ...stats, mode: args.apply ? 'apply' : 'dry-run', root, owner }));
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Local import failed: ${error.message}`); process.exitCode = 1; });
}
