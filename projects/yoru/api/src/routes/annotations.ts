import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { isDeepStrictEqual } from "node:util";
import { and, eq, or, sql } from "drizzle-orm";
import {
  db, mediaAnnotationsTable as annotations, mediaAnnotationHistoryTable as history, mediaItemsTable as media,
} from "@workspace/db";
import { GetSocialPostParams, UpdatePostAnnotationBody } from "@workspace/api-zod";
import { requireAuth, getRequestUserId } from "../middlewares/requireAuth";
import { accessibleMedia, adultAccepted, publicEligible, socialLimit, SocialError, unblocked } from "../lib/social-access";
import { canonicalHashtag, canonicalAttributes, canonicalSourceUrl, LabelValidationError } from "../lib/annotation-labels";

const router: IRouter = Router();
router.use("/social", requireAuth, (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
const run = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch((error: unknown) => {
      if (error instanceof SocialError) return res.status(error.status).json({ error: error.message });
      if (error instanceof LabelValidationError) return res.status(400).json({ error: error.message });
      return next(error);
    });
  };
const mediaId = (req: Request) => {
  const parsed = GetSocialPostParams.safeParse(req.params);
  if (!parsed.success) throw new SocialError(400, "Invalid post ID.");
  return parsed.data.id;
};
function annotationDTO(mediaId: string, row?: typeof annotations.$inferSelect) {
  return {
    mediaId, revision: row?.revision ?? 0, schemaVersion: 1,
    tags: row?.tags ?? [], attributes: row?.attributes ?? {}, notes: row?.notes ?? "",
    reviewStatus: row?.reviewStatus ?? "draft", confidence: row?.confidence ?? "unsure",
    sourceUrl: row?.sourceUrl ?? null, updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

router.get("/social/posts/:id/annotation", run(async (req, res) => {
  const uid = getRequestUserId(req), id = mediaId(req);
  await accessibleMedia(id, uid);
  const [row] = await db.select().from(annotations).where(and(eq(annotations.userId, uid), eq(annotations.mediaId, id))).limit(1);
  res.json(annotationDTO(id, row));
}));

router.put("/social/posts/:id/annotation", run(async (req, res) => {
  const uid = getRequestUserId(req), id = mediaId(req);
  await accessibleMedia(id, uid);
  await socialLimit(uid, "annotation", 120);
  const parsed = UpdatePostAnnotationBody.safeParse(req.body);
  if (!parsed.success) throw new SocialError(400, "Invalid annotation. Check field lengths and revision.");
  const input = parsed.data;
  const values = {
    tags: [...new Set(input.tags.map(canonicalHashtag))],
    attributes: canonicalAttributes(input.attributes), notes: input.notes,
    reviewStatus: input.reviewStatus, confidence: input.confidence, sourceUrl: canonicalSourceUrl(input.sourceUrl),
  };
  const row = await db.transaction(async (tx) => {
    await tx.insert(annotations).values({ userId: uid, mediaId: id }).onConflictDoNothing();
    const [current] = await tx.select().from(annotations).where(and(eq(annotations.userId, uid), eq(annotations.mediaId, id))).for("update");
    if (input.expectedRevision !== current.revision) {
      // A retry of the same successful replacement is safe, but a stale
      // different draft must never overwrite another device's changes.
      const same = current.revision === input.expectedRevision + 1 &&
        Object.entries(values).every(([key, value]) => isDeepStrictEqual(current[key as keyof typeof current], value));
      if (same) return current;
      throw new SocialError(409, "These labels changed on another device. Reload the latest version before saving.");
    }
    const revision = current.revision + 1;
    const [saved] = await tx.update(annotations).set({ ...values, revision, updatedAt: new Date() })
      .where(and(eq(annotations.userId, uid), eq(annotations.mediaId, id))).returning();
    await tx.insert(history).values({ userId: uid, mediaId: id, revision, schemaVersion: 1,
      payload: { ...values, rawTags: input.tags, rawAttributes: input.attributes } });
    return saved;
  });
  res.json(annotationDTO(id, row));
}));

router.get("/social/labels", run(async (req, res) => {
  const uid = getRequestUserId(req);
  await socialLimit(uid, "label-catalog", 120);
  if (req.query.prefix !== undefined && (typeof req.query.prefix !== "string" || req.query.prefix.length > 80)) {
    throw new SocialError(400, "Invalid hashtag prefix.");
  }
  const rawPrefix = typeof req.query.prefix === "string" ? req.query.prefix.trim().replace(/^#+/, "") : "";
  const prefix = rawPrefix ? canonicalHashtag(rawPrefix) : "";
  const adult = await adultAccepted(uid);
  const allowed = and(eq(media.moderationState, "active"), unblocked(uid),
    adult ? or(eq(media.userId, uid), publicEligible) : eq(media.userId, uid));
  // Only the viewer's annotations may enter their catalog. No label/notes from
  // another account are selected, even when both users label the same post.
  const rows = await db.execute<{ tag: string; count: string }>(sql`
    with labels as (
      select distinct ${media.id} as media_id,
        lower(regexp_replace(ltrim(trim(normalize(t.tag, NFKC)), '#'), '\\s+', '-', 'g')) as tag
      from ${media}
      left join ${annotations} on ${annotations.mediaId}=${media.id} and ${annotations.userId}=${uid}
      cross join lateral unnest(${media.tags} || coalesce(${annotations.tags}, '{}'::text[])) as t(tag)
      where ${allowed}
    )
    select tag, count(*)::text as count from labels
    where tag<>'' and starts_with(tag, ${prefix})
    group by tag order by count(*) desc, tag asc limit 50`);
  res.json({ items: rows.rows.map((row) => ({ tag: row.tag, count: Number(row.count) })) });
}));

export default router;
