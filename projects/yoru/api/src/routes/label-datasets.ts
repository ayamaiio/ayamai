import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, desc, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db, mediaItemsTable as media, mediaAnnotationsTable as annotations,
  labelExportsTable as exports, labelExportRowsTable as rows,
} from "@workspace/db";
import { requireAuth, getRequestUserId } from "../middlewares/requireAuth";
import { adultAccepted, publicEligible, socialLimit, SocialError, unblocked } from "../lib/social-access";
import { canonicalHashtag, LabelValidationError } from "../lib/annotation-labels";

const router: IRouter = Router();
router.use("/social", requireAuth, (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
const run = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch((err: unknown) => {
      if (err instanceof SocialError) return res.status(err.status).json({ error: err.message });
      if (err instanceof LabelValidationError || err instanceof z.ZodError) return res.status(400).json({ error: "Invalid labeling filters or cursor." });
      return next(err);
    });
  };
const tagSchema = z.string().max(80).transform((v) => v.trim() ? canonicalHashtag(v) : undefined).optional();
const queueSchema = z.object({
  status: z.enum(["all", "unlabeled", "draft", "reviewed"]).default("all"),
  tag: tagSchema, limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(1000).optional(),
});
const cursorSchema = z.object({
  after: z.uuid(), cutoff: z.iso.datetime(), status: z.enum(["all", "unlabeled", "draft", "reviewed"]), tag: z.string().nullable(),
});
async function allowed(uid: string) {
  return and(eq(media.moderationState, "active"), unblocked(uid),
    await adultAccepted(uid) ? or(eq(media.userId, uid), publicEligible) : eq(media.userId, uid))!;
}
const personalTag = (tag?: string) => tag ? sql`${tag} = any(${annotations.tags})` : undefined;
const statusFilter = (status: string) => status === "all" ? undefined
  : status === "unlabeled" ? sql`coalesce(${annotations.revision}, 0) = 0`
  : and(gt(annotations.revision, 0), eq(annotations.reviewStatus, status));

router.get("/social/label-queue", run(async (req, res) => {
  const uid = getRequestUserId(req), input = queueSchema.parse(req.query);
  await socialLimit(uid, "label-queue", 120);
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (input.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"))); }
    catch { throw new SocialError(400, "Invalid queue cursor."); }
    if (cursor.status !== input.status || cursor.tag !== (input.tag ?? null)) throw new SocialError(400, "Start a new queue after changing filters.");
  }
  const cutoff = cursor?.cutoff ?? new Date().toISOString();
  const page = await db.select({
    mediaId: media.id, title: media.title, mediaType: media.mediaType,
    revision: sql<number>`coalesce(${annotations.revision}, 0)`,
    reviewStatus: sql<string>`case when coalesce(${annotations.revision}, 0) = 0 then 'unlabeled' else ${annotations.reviewStatus} end`,
  }).from(media).leftJoin(annotations, and(eq(annotations.mediaId, media.id), eq(annotations.userId, uid)))
    .where(and(await allowed(uid), sql`${media.createdAt} <= ${cutoff}::timestamptz`,
      cursor ? gt(media.id, cursor.after) : undefined, statusFilter(input.status), personalTag(input.tag)))
    .orderBy(media.id).limit(input.limit + 1);
  const items = page.slice(0, input.limit);
  const nextCursor = page.length > input.limit ? Buffer.from(JSON.stringify({
    after: items.at(-1)!.mediaId, cutoff, status: input.status, tag: input.tag ?? null,
  })).toString("base64url") : null;
  res.json({ items, nextCursor });
}));

// Versions describe the format, not the creation order of a dataset.
const metadata = {
  manifestVersion: 1, schemaVersion: 1, taxonomyVersion: 1,
  format: "application/x-ndjson", ordering: "mediaId ascending, current label then audit revision ascending",
  taxonomy: {
    kind: "personal-open-vocabulary", normalization: "NFKC/lowercase; hashtags and attribute keys use annotation canonicalization v1",
    reviewStatus: ["draft", "reviewed"], confidence: ["unsure", "confident"],
    vocabulary: "Canonical tags and attribute values are embedded in each current_label record.",
  },
  records: {
    current_label: "Exactly one current revision per selected media at snapshot; only these records are training labels.",
    audit: "Prior/current revision number, schemaVersion, reviewStatus, confidence and timestamp only; never additional training truth.",
  },
  accessPolicy: "Access is rechecked on every page. Deleted, blocked, moderated or newly inaccessible media are omitted. No original bytes or storage locators.",
  retentionDays: 7,
};
function manifest(row: typeof exports.$inferSelect) {
  return { id: row.id, manifestVersion: 1, schemaVersion: 1, taxonomyVersion: 1,
    snapshotAt: row.snapshotAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
    status: row.status, tag: row.tag, recordCount: row.recordCount, metadata: row.metadata };
}
async function cleanupExpired() {
  // Bounded opportunistic maintenance; expiry is enforced independently on reads.
  await db.execute(sql`delete from ${exports} where id in
    (select id from ${exports} where expires_at < now() order by expires_at limit 20)`);
}
router.get("/social/label-exports", run(async (req, res) => {
  const uid = getRequestUserId(req);
  await socialLimit(uid, "label-exports-list", 60);
  await cleanupExpired();
  const items = await db.select().from(exports).where(and(eq(exports.userId, uid), gt(exports.expiresAt, new Date())))
    .orderBy(desc(exports.snapshotAt), desc(exports.id)).limit(20);
  res.json({ items: items.map(manifest) });
}));

router.post("/social/label-exports", run(async (req, res) => {
  const uid = getRequestUserId(req);
  const input = z.object({ status: z.enum(["all", "draft", "reviewed"]).default("reviewed"), tag: tagSchema }).strict().parse(req.body);
  await socialLimit(uid, "label-export-create", 3);
  await cleanupExpired();
  const access = await allowed(uid);
  const result = await db.transaction(async (tx) => {
    // INSERT ... SELECT uses the same MVCC snapshot as all other transaction
    // reads. No application-side collection or history array grows with size.
    const [clock] = (await tx.execute<{ at: string }>(sql`select transaction_timestamp()::text as at`)).rows;
    const at = new Date(clock.at);
    const [dataset] = await tx.insert(exports).values({
      userId: uid, snapshotAt: at, expiresAt: new Date(at.getTime() + 7 * 86400_000),
      status: input.status, tag: input.tag ?? null, metadata,
    }).returning();
    await tx.execute(sql`
      insert into label_export_rows (export_id, ordinal, media_id, record)
      with selected as (
        select ${media.id} as media_id, ${media.mediaType} as media_type, ${media.contentType} as content_type,
          ${annotations.revision} as revision, ${annotations.tags} as tags, ${annotations.attributes} as attributes,
          ${annotations.notes} as notes, ${annotations.reviewStatus} as review_status,
          ${annotations.confidence} as confidence, ${annotations.sourceUrl} as source_url,
          ${annotations.updatedAt} as updated_at
        from ${media} join ${annotations} on ${annotations.mediaId}=${media.id} and ${annotations.userId}=${uid}
        where ${access} and ${annotations.revision}>0
          ${input.status === "all" ? sql`` : sql`and ${annotations.reviewStatus}=${input.status}`}
          ${input.tag ? sql`and ${input.tag}=any(${annotations.tags})` : sql``}
      ), records as (
        select s.media_id, 0 as sort_revision, jsonb_build_object(
          'recordType','current_label', 'mediaId',s.media_id, 'mediaType',s.media_type, 'contentType',s.content_type,
          'revision',s.revision, 'schemaVersion',1, 'taxonomyVersion',1, 'tags',s.tags, 'attributes',s.attributes,
          'notes',s.notes, 'reviewStatus',s.review_status, 'confidence',s.confidence,
          'provenance',jsonb_build_object('kind','personal_annotation','sourceUrl',s.source_url,'updatedAt',s.updated_at)
        ) as record from selected s
        union all
        select s.media_id, h.revision as sort_revision, jsonb_build_object(
          'recordType','audit', 'mediaId',s.media_id, 'revision',h.revision, 'schemaVersion',h.schema_version,
          'reviewStatus',h.payload->>'reviewStatus', 'confidence',h.payload->>'confidence', 'createdAt',h.created_at
        ) as record from selected s join media_annotation_history h
          on h.media_id=s.media_id and h.user_id=${uid} and h.revision<=s.revision
      )
      select ${dataset.id}::uuid, row_number() over(order by media_id,sort_revision)::integer, media_id, record from records`);
    const [{ count }] = (await tx.execute<{ count: number }>(sql`select count(*)::integer as count from ${rows} where ${rows.exportId}=${dataset.id}`)).rows;
    const [saved] = await tx.update(exports).set({ recordCount: count }).where(eq(exports.id, dataset.id)).returning();
    return saved;
  }, { isolationLevel: "repeatable read" });
  res.status(201).json(manifest(result));
}));

router.get("/social/label-exports/:id/rows", run(async (req, res) => {
  const uid = getRequestUserId(req), id = z.uuid().parse(req.params.id);
  const input = z.object({
    cursor: z.coerce.number().int().min(0).max(2147483647).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  }).parse(req.query);
  await socialLimit(uid, "label-export-page", 120);
  const [dataset] = await db.select().from(exports).where(and(eq(exports.id, id), eq(exports.userId, uid), gt(exports.expiresAt, new Date()))).limit(1);
  if (!dataset) throw new SocialError(404, "Export not found or expired.");
  // Scan at most limit frozen rows even if all of them were revoked. Always
  // advance over revoked rows, so resume cannot loop forever on an empty page.
  const access = await allowed(uid);
  const page = await db.select({ ordinal: rows.ordinal,
    record: sql<Record<string, unknown> | null>`case when ${access} then ${rows.record} else null end`,
  }).from(rows).innerJoin(media, eq(media.id, rows.mediaId))
    .where(and(eq(rows.exportId, id), gt(rows.ordinal, input.cursor))).orderBy(rows.ordinal).limit(input.limit);
  const nextCursor = page.at(-1)?.ordinal ?? input.cursor;
  const [more] = await db.select({ ordinal: rows.ordinal }).from(rows)
    .where(and(eq(rows.exportId, id), gt(rows.ordinal, nextCursor))).limit(1);
  res.json({ jsonl: page.filter((r) => r.record).map((r) => JSON.stringify(r.record) + "\n").join(""), nextCursor, done: !more });
}));

export default router;
