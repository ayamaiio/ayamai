import { postValues } from "../social-access";
import { ImportWorkerPoller } from "./worker-poller";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db, pool, importJobsTable as jobs, importFilesTable as files, mediaItemsTable as media, type ImportJobRow, type ImportFileRow } from "@workspace/db";
import { abortImportUpload, beginImportUpload, deleteMediaObject, finishImportUpload, uploadImportPart, verifyUploadedObject } from "../r2Storage";
import { openSealedSource } from "./source-crypto";
import { detectMedia, publicImportError } from "./providers";
import { openImportSource } from "./cloud-source";
import { ImportError, type Provider } from "./network";
import { logger } from "../logger";
import { enqueuePreview } from "../media-previews";

const PART_BYTES = 8 * 1024 * 1024;
export const IMPORT_WORKER_LOCK = 682934105;
const storage = { abortImportUpload, beginImportUpload, deleteMediaObject, finishImportUpload, uploadImportPart, verifyUploadedObject, openSource: openImportSource, enqueuePreview };
type ImportDependencies = Omit<typeof storage, "enqueuePreview"> & { enqueuePreview?: typeof enqueuePreview };

async function cleanFile(file: ImportFileRow, deps: ImportDependencies) {
  if (file.uploadId) {
    await deps.abortImportUpload(file.objectKey, file.uploadId);
    await db.update(files).set({ uploadId: null }).where(eq(files.id, file.id));
  }
  // Never delete a completed media object, including after a crash between commit and job finalization.
  const [existing] = await db.select({ id: media.id }).from(media).where(eq(media.objectKey, file.objectKey)).limit(1);
  if (!existing) await deps.deleteMediaObject(file.objectKey);
  return existing;
}

async function transfer(job: ImportJobRow, file: ImportFileRow, signal: AbortSignal, deps: ImportDependencies) {
  const existing = await cleanFile(file, deps);
  if (existing) {
    await db.update(files).set({ status: "complete", mediaId: existing.id, bytesTransferred: file.size, error: null }).where(eq(files.id, file.id));
    deps.enqueuePreview?.(existing.id);
    return;
  }
  signal.throwIfAborted();
  await db.update(files).set({ status: "transferring", bytesTransferred: 0, error: null }).where(eq(files.id, file.id));
  const stream = await deps.openSource(job.provider as Provider, openSealedSource(job.encryptedSource, job.userId), file.sourceId, signal, job.userId);
  stream.on("error", () => {});
  let uploadId: string | undefined;
  let received = 0;
  let buffer = Buffer.alloc(0);
  let buffered = 0;
  let contentType = "";
  let mediaType = "";
  const parts: { ETag: string; PartNumber: number }[] = [];
  const abort = () => stream.destroy(new ImportError("Import stopped."));
  signal.addEventListener("abort", abort, { once: true });
  async function initialize() {
    const detected = await detectMedia(buffer.subarray(0, Math.min(buffered, 8192)));
    contentType = detected.contentType;
    mediaType = detected.mediaType;
    uploadId = await deps.beginImportUpload(file.objectKey, contentType, signal);
    await db.update(files).set({ uploadId }).where(eq(files.id, file.id));
  }
  async function sendPart(body: Buffer) {
    signal.throwIfAborted();
    parts.push(await deps.uploadImportPart(file.objectKey, uploadId!, parts.length + 1, body, signal));
    await db.update(files).set({ bytesTransferred: parts.reduce((sum, _part, index) => sum + (index === parts.length - 1 ? body.length : PART_BYTES), 0) }).where(eq(files.id, file.id));
  }
  try {
    buffer = Buffer.allocUnsafe(PART_BYTES);
    for await (const data of stream) {
      signal.throwIfAborted();
      const chunk = Buffer.from(data);
      received += chunk.length;
      if (received > file.size || received > 5 * 1024 ** 3) throw new ImportError("The source changed size or exceeds the 5 GB limit. Preview the link again.");
      let offset = 0;
      while (offset < chunk.length) {
        const length = Math.min(PART_BYTES - buffered, chunk.length - offset);
        chunk.copy(buffer, buffered, offset, offset + length);
        offset += length;
        buffered += length;
        if (!uploadId && buffered >= 8192) await initialize();
        if (buffered === PART_BYTES) {
          await sendPart(buffer);
          buffer = Buffer.allocUnsafe(PART_BYTES);
          buffered = 0;
        }
      }
    }
    if (received !== file.size) throw new ImportError("The source was truncated or changed size. Preview the link again.");
    if (!uploadId) await initialize();
    if (buffered) await sendPart(buffer.subarray(0, buffered));
    signal.throwIfAborted();
    await deps.finishImportUpload(file.objectKey, uploadId!, parts, signal);
    await db.update(files).set({ uploadId: null }).where(eq(files.id, file.id));
    if (!await deps.verifyUploadedObject(file.objectKey, received, contentType)) throw new ImportError("The imported object could not be verified. Retry this file.");
    const mediaId = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for("update");
      if (!current || current.status === "cancelling" || signal.aborted) throw new ImportError("Import stopped.");
      const [created] = await tx.insert(media).values({
        ...await postValues(job.userId, job.posting),
        userId: job.userId, title: file.name.replace(/\.[^.]+$/, "").trim() || file.name,
        originalName: file.name, objectKey: file.objectKey, contentType, mediaType, size: received,
        collection: job.collection,
      }).onConflictDoNothing({ target: media.objectKey }).returning({ id: media.id });
      const [saved] = created ? [created] : await tx.select({ id: media.id }).from(media).where(and(eq(media.objectKey, file.objectKey), eq(media.userId, job.userId)));
      if (!saved) throw new Error("Import registration failed.");
      await tx.update(files).set({ status: "complete", mediaId: saved.id, bytesTransferred: received, error: null }).where(eq(files.id, file.id));
      return saved.id;
    });
    deps.enqueuePreview?.(mediaId);
  } finally {
    stream.destroy();
    signal.removeEventListener("abort", abort);
  }
}

export async function processImportJob(job: ImportJobRow, outerSignal: AbortSignal, deps: ImportDependencies = storage) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, outerSignal, AbortSignal.timeout(45 * 60_000)]);
  let checking = false;
  const check = setInterval(() => {
    if (checking) return;
    checking = true;
    void db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, job.id)).then(([current]) => {
      if (!current || current.status === "cancelling") controller.abort();
    }).catch(() => controller.abort()).finally(() => { checking = false; });
  }, 1000);
  check.unref();
  try {
    if (job.expiresAt < new Date()) {
      await db.update(jobs).set({ status: "cancelling", error: "This import link expired. Preview the link again." }).where(eq(jobs.id, job.id));
      controller.abort();
    } else if (job.status === "cancelling") controller.abort();
    else await db.update(jobs).set({ status: "processing", error: null }).where(eq(jobs.id, job.id));
    const pending = await db.select().from(files).where(and(eq(files.jobId, job.id), inArray(files.status, ["queued", "transferring"]))).orderBy(asc(files.id));
    for (const file of pending) {
      try {
        signal.throwIfAborted();
        await transfer(job, file, signal, deps);
      } catch (error) {
        // A lost advisory-lock connection hands ownership to the next worker.
        // Do not change its state or delete its objects from this old worker.
        if (outerSignal.aborted) throw error;
        try { await cleanFile((await db.select().from(files).where(eq(files.id, file.id)))[0]!, deps); }
        catch { throw new ImportError("Storage cleanup is waiting for connectivity. This job will recover automatically."); }
        const message = signal.aborted ? "Import stopped. Completed files remain in your library." : publicImportError(error);
        await db.update(files).set({ status: signal.aborted ? "cancelled" : "failed", error: message, bytesTransferred: 0 }).where(eq(files.id, file.id));
      }
    }
    const states = await db.select({ status: files.status }).from(files).where(eq(files.jobId, job.id));
    const cancelled = signal.aborted || states.some((f) => f.status === "cancelled");
    const failed = states.some((f) => f.status === "failed");
    await db.update(jobs).set({ status: cancelled ? "cancelled" : failed ? "failed" : "complete",
      error: failed ? "Some files need another try. Completed files are already in your library." : null,
      ...(!failed ? { encryptedSource: "" } : {}),
    }).where(eq(jobs.id, job.id));
  } finally { clearInterval(check); }
}

export function startImportWorker() {
  const poller = new ImportWorkerPoller(async () => {
    const controller = new AbortController();
    let finish = async () => {};
    let locked = false;
    const onError = () => controller.abort();
    try {
      const connection = await pool.connect();
      finish = async () => {
        try {
          if (locked) await connection.query("select pg_advisory_unlock($1)", [IMPORT_WORKER_LOCK]);
          connection.release();
        } catch { connection.release(true); }
        connection.removeListener("error", onError);
      };
      connection.on("error", onError);
      const result = await connection.query("select pg_try_advisory_lock($1) as locked", [IMPORT_WORKER_LOCK]);
      locked = result.rows[0]?.locked === true;
      if (!locked) return;
      // One worker globally: bounded transfer concurrency across deployment instances.
      const [job] = await db.select().from(jobs).where(inArray(jobs.status, ["queued", "processing", "cancelling"])).orderBy(asc(jobs.createdAt)).limit(1);
      if (job) await processImportJob(job, controller.signal);
      await db.update(jobs).set({ encryptedSource: "" }).where(and(lt(jobs.expiresAt, new Date()), inArray(jobs.status, ["preview", "complete", "failed", "cancelled"])));
    } finally {
      await finish();
    }
  }, (retry) => {
    // Raw errors can contain a signed URL or MEGA key. Log only bounded retry state.
    logger.warn(retry, "Cloud import worker will retry after a storage or database interruption.");
  });
  const timer = setInterval(() => { void poller.tick(); }, 3000);
  timer.unref();
  void poller.tick();
  return timer;
}
