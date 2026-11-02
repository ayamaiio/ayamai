import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, cloudAccountsTable, importJobsTable as jobs, importFilesTable as files, type ImportJobRow, type ImportFileRow } from "@workspace/db";
import {
  ActOnImportJobBody, ActOnImportJobParams, PreviewImportLinkResponse, ListImportJobsResponse,
  PreviewImportLinkBody, StartImportJobBody, StartImportJobParams,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { requireAuth, getRequestUserId } from "../middlewares/requireAuth";
import { ImportError } from "../lib/imports/network";
import { parseShareLink, previewSource, publicImportError, type SourceFile } from "../lib/imports/providers";
import { sealSource } from "../lib/imports/source-crypto";
import { postValues, SocialError } from "../lib/social-access";

const router: IRouter = Router();
router.use(requireAuth);

export async function serializeImportJob(job: ImportJobRow, prefetched?: ImportFileRow[]) {
  const rows = prefetched ?? await db.select().from(files).where(eq(files.jobId, job.id)).orderBy(files.id);
  return PreviewImportLinkResponse.parse({
    id: job.id, provider: job.provider, status: job.status, createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(), error: job.error,
    files: rows.map((file) => ({
      id: file.id, name: file.name, size: file.size, status: file.status,
      bytesTransferred: file.bytesTransferred, error: file.error, mediaId: file.mediaId,
    })),
  });
}

router.get("/imports", async (req, res) => {
  const rows = await db.select().from(jobs).where(eq(jobs.userId, getRequestUserId(req)))
    .orderBy(sql`case when ${jobs.status} in ('queued', 'processing', 'cancelling', 'preview') then 0 else 1 end`, desc(jobs.createdAt)).limit(30);
  const allFiles = rows.length ? await db.select().from(files).where(inArray(files.jobId, rows.map((job) => job.id))).orderBy(files.id) : [];
  const grouped = new Map<string, ImportFileRow[]>();
  for (const file of allFiles) grouped.set(file.jobId, [...grouped.get(file.jobId) ?? [], file]);
  res.json(ListImportJobsResponse.parse({ jobs: await Promise.all(rows.map((job) => serializeImportJob(job, grouped.get(job.id) ?? []))) }));
});

export async function createImportPreview(userId: string, provider: string, encryptedSource: string, load: () => Promise<SourceFile[]>, accountId?: string) {
  let job: ImportJobRow | undefined;
  try {
    // Reservation is durable before provider access; failures also count toward rate limits.
    job = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 5319))`);
      const [recent] = await tx.select({ total: count() }).from(jobs).where(and(eq(jobs.userId, userId), gt(jobs.createdAt, new Date(Date.now() - 60_000))));
      if ((recent?.total ?? 0) >= 5) throw new ImportError("You can preview five links per minute. Please wait a moment.");
      const [previews] = await tx.select({ total: count() }).from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.status, "preview"), gt(jobs.expiresAt, new Date())));
      if ((previews?.total ?? 0) >= 10) throw new ImportError("You have ten pending previews. Cancel an unused preview before adding another.");
      const [created] = await tx.insert(jobs).values({
        userId, provider, encryptedSource,
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      }).returning();
      return created!;
    });
    const descriptors = await load();
    if (descriptors.length > 200 || descriptors.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 ** 3) throw new ImportError("Import up to 200 files and 50 GB per link. Share a smaller selection.");
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 5319))`);
      const [current] = await tx.select().from(jobs).where(eq(jobs.id, job!.id)).for("update");
      if (!current || current.status !== "preview") throw new ImportError("This preview was cancelled.");
      if (accountId) {
        const [account] = await tx.select({ id: cloudAccountsTable.id }).from(cloudAccountsTable).where(and(
          eq(cloudAccountsTable.id, accountId), eq(cloudAccountsTable.userId, userId), eq(cloudAccountsTable.provider, provider),
        ));
        if (!account) throw new ImportError("This cloud account was disconnected. Connect again to create a preview.");
      }
      await tx.insert(files).values(descriptors.map((file) => {
        const id = randomUUID();
        return { ...file, id, jobId: job!.id, objectKey: `media/${userId}/import-${id}` };
      }));
    });
    return await serializeImportJob(job);
  } catch (error) {
    if (job) await db.update(jobs).set({ status: "failed", encryptedSource: "", error: publicImportError(error) }).where(and(eq(jobs.id, job.id), eq(jobs.status, "preview")));
    throw error;
  }
}

router.post("/imports/preview", async (req, res) => {
  const parsed = PreviewImportLinkBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Paste a valid share link up to 4096 characters." }); return; }
  const userId = getRequestUserId(req);
  try {
    const source = parseShareLink(parsed.data.url);
    res.status(201).json(await createImportPreview(userId, source.provider, sealSource(source.url, userId),
      () => previewSource(source.provider, source.url, AbortSignal.timeout(25_000))));
  } catch (error) { res.status(400).json({ error: publicImportError(error) }); }
});

router.post("/imports/:id/start", async (req, res) => {
  const params = StartImportJobParams.safeParse(req.params);
  const body = StartImportJobBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Choose files from a valid preview." }); return; }
  const userId = getRequestUserId(req);
  try {
    await postValues(userId, body.data.posting);
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 5319))`);
      const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, params.data.id), eq(jobs.userId, userId))).for("update");
      if (!job) return undefined;
      // Duplicate confirmation is idempotent.
      if (job.status !== "preview") return job;
      if (job.expiresAt < new Date() || !job.encryptedSource) throw new ImportError("This preview expired. Paste the link again.");
      const ownFiles = await tx.select().from(files).where(eq(files.jobId, job.id));
      const selection = [...new Set(body.data.fileIds)];
      if (!selection.length || selection.some((id) => !ownFiles.some((file) => file.id === id))) throw new ImportError("The selected files do not belong to this preview.");
      const [active] = await tx.select({ total: count() }).from(jobs).where(and(eq(jobs.userId, userId), inArray(jobs.status, ["queued", "processing", "cancelling"])));
      if ((active?.total ?? 0) >= 3) throw new ImportError("Three imports are already active. Wait for one to finish.");
      await tx.update(files).set({ status: "skipped" }).where(eq(files.jobId, job.id));
      await tx.update(files).set({ status: "queued" }).where(and(eq(files.jobId, job.id), inArray(files.id, selection)));
      const [updated] = await tx.update(jobs).set({
        posting: body.data.posting ?? null,
        status: "queued", collection: body.data.collection?.trim().replace(/\s+/g, " ") || null, error: null,
      }).where(eq(jobs.id, job.id)).returning();
      return updated;
    });
    if (!result) { res.status(404).json({ error: "Import not found." }); return; }
    res.json(await serializeImportJob(result));
  } catch (error) { res.status(error instanceof SocialError ? error.status : 400).json({ error: error instanceof SocialError ? error.message : publicImportError(error) }); }
});

router.post("/imports/:id/action", async (req, res) => {
  const params = ActOnImportJobParams.safeParse(req.params);
  const body = ActOnImportJobBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid import action." }); return; }
  const userId = getRequestUserId(req);
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 5319))`);
      const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, params.data.id), eq(jobs.userId, userId))).for("update");
      if (!job) return undefined;
      if (body.data.action === "cancel") {
        if (["complete", "cancelled", "failed"].includes(job.status)) return job;
        if (job.status === "preview") {
          await tx.update(files).set({ status: "cancelled" }).where(eq(files.jobId, job.id));
          const [updated] = await tx.update(jobs).set({ status: "cancelled", encryptedSource: "" }).where(eq(jobs.id, job.id)).returning();
          return updated;
        }
        const [updated] = await tx.update(jobs).set({ status: "cancelling" }).where(eq(jobs.id, job.id)).returning();
        return updated;
      }
      if (job.status !== "failed") throw new ImportError("Only failed imports can be retried. To import a cancelled job, preview its link again.");
      if (!job.encryptedSource || job.expiresAt < new Date()) throw new ImportError("Paste and preview this link again before retrying.");
      const [active] = await tx.select({ total: count() }).from(jobs).where(and(eq(jobs.userId, userId), inArray(jobs.status, ["queued", "processing", "cancelling"])));
      if ((active?.total ?? 0) >= 3) throw new ImportError("Three imports are already active. Wait for one to finish.");
      const retryable = await tx.select({ id: files.id }).from(files).where(and(eq(files.jobId, job.id), eq(files.status, "failed")));
      if (!retryable.length) throw new ImportError("There are no failed files to retry. Preview the link again.");
      await tx.update(files).set({ status: "queued", error: null, bytesTransferred: 0 }).where(and(eq(files.jobId, job.id), eq(files.status, "failed")));
      const [updated] = await tx.update(jobs).set({ status: "queued", error: null }).where(eq(jobs.id, job.id)).returning();
      return updated;
    });
    if (!result) { res.status(404).json({ error: "Import not found." }); return; }
    res.json(await serializeImportJob(result));
  } catch (error) { res.status(400).json({ error: publicImportError(error) }); }
});

export default router;
