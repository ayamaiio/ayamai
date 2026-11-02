import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { db, pool, mediaItemsTable as media } from "@workspace/db";
import { eq } from "drizzle-orm";
import { localMediaPath, mediaObjectExists, putMediaPreview, readMediaRange } from "./r2Storage";
import { previewKey, renderPreview } from "./preview-render";
import { logger } from "./logger";

// One decoder/download per process; at most 128 queued IDs, never source bytes.
// Object existence is durable state, so a restart simply retries missing derivatives on demand.
const queued = new Map<string, boolean>();
const failures = new Map<string, number>();
let working = false;
export function isPreviewPending(id: string) { return queued.has(id); }

export async function withPreviewLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 1984))", [id]);
    return await action();
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 1984))", [id]); }
    finally { client.release(); }
  }
}

export async function generateMediaPreview(id: string, force = false) {
  await withPreviewLock(id, async () => {
    const [item] = await db.select().from(media).where(eq(media.id, id)).limit(1);
    if (!item || item.moderationState !== "active") return;
    const key = previewKey(item.objectKey);
    if (!force && await mediaObjectExists(key)) return;
    const dir = await mkdtemp(join(tmpdir(), "media-preview-"));
    const signal = AbortSignal.timeout(5 * 60_000);
    try {
      // Local-library mode: the object is already a file on this machine, so
      // render straight from it. Copying a multi-GB episode to /tmp first cost
      // ~16s per video; seeking the original costs about a second.
      const localPath = localMediaPath(item.objectKey);
      if (localPath && existsSync(localPath)) {
        const body = await renderPreview(localPath, item.mediaType, join(dir, "poster.png"));
        await putMediaPreview(key, body);
        failures.delete(id);
        return;
      }
      // Stream to a private, disposable file rather than buffering multi-GB originals.
      const source = join(dir, "source");
      const result = await readMediaRange(item.objectKey, undefined, signal);
      if (!(result.Body instanceof Readable)) throw new Error("Preview source is not readable.");
      let bytes = 0;
      const bound = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          callback(bytes > Math.min(item.size, 5 * 1024 ** 3) ? new Error("Preview source exceeds recorded size.") : null, chunk);
        },
      });
      await pipeline(result.Body, bound, createWriteStream(source, { mode: 0o600 }), { signal });
      if (bytes !== item.size) throw new Error("Preview source is truncated.");
      const body = await renderPreview(source, item.mediaType, join(dir, "poster.png"));
      // R2 PUT replaces atomically only after rendering succeeds. A failed regeneration
      // retains the previous valid preview. Deletion takes the same database lock.
      await putMediaPreview(key, body);
      failures.delete(id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

export function enqueuePreview(id: string, force = false): boolean {
  if (force) failures.delete(id);
  if ((failures.get(id) ?? 0) > Date.now()) return false;
  if (queued.has(id)) { queued.set(id, queued.get(id)! || force); return true; }
  if (queued.size >= 128) return false;
  queued.set(id, force);
  if (!working) void drain();
  return true;
}

// Decoding is CPU-bound and independent per item, so the queue runs a small
// pool instead of one item at a time. Six fills a 60-tile grid in about a
// second and a half while leaving the machine usable.
const CONCURRENCY = Math.max(1, Number(process.env.PREVIEW_CONCURRENCY ?? 6));

async function drain() {
  working = true;
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  } finally { working = false; }
}

async function worker() {
  while (queued.size) {
    const [id, force] = queued.entries().next().value!;
    // Consume this request's force flag. A new rebuild request arriving while
    // this item is active sets it again, and must not be dropped on completion.
    queued.set(id, false);
    try { await generateMediaPreview(id, force); }
    catch {
      // Do not log decoder stderr: it may contain private source metadata.
      logger.warn({ mediaId: id }, "Media preview generation failed; original remains available.");
      if (failures.size >= 1024) failures.delete(failures.keys().next().value!);
      failures.set(id, Date.now() + 60_000);
    } finally { if (!queued.get(id)) queued.delete(id); }
  }
}