import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, avg, count, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db, mediaItemsTable as media, creatorFollowsTable as follows,
  profilesTable as profiles, videoReviewsTable as reviews } from "@workspace/db";
import { GetVideoCollectionQueryParams, GetVideoReviewsParams, GetVideoReviewsQueryParams,
  SetVideoReviewBody, DeleteVideoReviewQueryParams } from "@workspace/api-zod";
import { requireAuth, getRequestUserId } from "../middlewares/requireAuth";
import { accessibleMedia, requireAdult, publicEligible, socialLimit, SocialError, unblocked } from "../lib/social-access";
import { globalLibraryReader } from "../lib/library-access";
import { postDTOs } from "../lib/social-posts";

const router: IRouter = Router();
router.use("/social", requireAuth, (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
const run = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch((e: unknown) => e instanceof SocialError
      ? res.status(e.status).json({ error: e.message }) : next(e));
  };
const cursorSchema = z.object({
  source: z.enum(["all", "mine", "saved"]), id: z.uuid(), duration: z.number().finite().min(-1),
});
const duration = sql<number>`coalesce(${media.durationSeconds}, -1)`;
router.get("/social/videos", run(async (req, res) => {
  const parsed = GetVideoCollectionQueryParams.safeParse(req.query);
  if (!parsed.success) throw new SocialError(400, "Invalid video filters.");
  const uid = getRequestUserId(req), source = parsed.data.source ?? "all";
  await requireAdult(uid);
  await socialLimit(uid, "video-list", 90);
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (parsed.data.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(parsed.data.cursor, "base64url").toString("utf8"))); }
    catch { throw new SocialError(400, "Invalid video cursor."); }
    if (cursor.source !== source) throw new SocialError(400, "Start a new collection when changing source.");
  }
  const rows = await db.select().from(media).where(and(
    eq(media.mediaType, "video"), eq(media.moderationState, "active"),
    or(globalLibraryReader(uid), and(unblocked(uid), or(eq(media.userId, uid), publicEligible))),
    source === "all" ? undefined : source === "mine" ? eq(media.userId, uid) : sql`(
      (${media.userId}=${uid} and ${media.isFavorite}=true) or
      exists (select 1 from social_saved_posts s where s.user_id=${uid} and s.media_id=${media.id})
    )`,
    cursor ? sql`(${duration} < ${cursor.duration} or (${duration} = ${cursor.duration} and ${media.id} < ${cursor.id}::uuid))` : undefined,
  )).orderBy(desc(duration), desc(media.id)).limit(25);
  const page = rows.slice(0, 24), last = page.at(-1), hasMore = rows.length > 24;
  res.json({ items: await postDTOs(page, uid), hasMore,
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify({
      source, id: last.id, duration: last.durationSeconds ?? -1,
    })).toString("base64url") : null });
}));

async function video(req: Request) {
  const parsed = GetVideoReviewsParams.safeParse(req.params);
  if (!parsed.success) throw new SocialError(400, "Invalid video.");
  const uid = getRequestUserId(req);
  await requireAdult(uid);
  const item = await accessibleMedia(parsed.data.id, uid);
  if (item.mediaType !== "video") throw new SocialError(400, "Ratings and reviews are for videos.");
  return { uid, item };
}
const reviewDTO = (r: typeof reviews.$inferSelect, uid: string) => ({
  id: r.id, rating: r.rating, text: r.text, revision: r.revision,
  isOwn: r.userId === uid, updatedAt: r.updatedAt.toISOString(),
});
router.get("/social/posts/:id/reviews", run(async (req, res) => {
  const query = GetVideoReviewsQueryParams.safeParse(req.query);
  if (!query.success) throw new SocialError(400, "Invalid review page.");
  const { uid, item } = await video(req);
  await socialLimit(uid, "review-read", 120);
  let canReadOthers = uid === item.userId;
  // Never provide a follower-based oracle for an anonymous uploader's identity.
  if (!canReadOthers && item.attribution === "profile") {
    const [follow] = await db.select({ id: profiles.id }).from(follows)
      .innerJoin(profiles, eq(profiles.id, follows.profileId))
      .where(and(eq(follows.userId, uid), eq(profiles.userId, item.userId))).limit(1);
    canReadOthers = !!follow;
  }
  const [own] = await db.select().from(reviews).where(and(eq(reviews.userId, uid), eq(reviews.mediaId, item.id))).limit(1);
  const visible = and(eq(reviews.mediaId, item.id), unblocked(uid, sql`${reviews.userId}`),
    or(eq(reviews.userId, uid), and(eq(reviews.publicContext, true),
      sql`${item.visibility === "public" && item.attribution === "profile"}`)));
  const offset = query.data.offset ?? 0;
  const [rows, totals] = canReadOthers ? await Promise.all([
    db.select().from(reviews).where(visible).orderBy(desc(reviews.updatedAt), desc(reviews.id)).offset(offset).limit(25),
    db.select({ total: count(), average: avg(reviews.rating) }).from(reviews).where(visible),
  ]) : [[], []];
  res.json({ ownReview: own ? reviewDTO(own, uid) : null,
    items: rows.slice(0, 24).map((r) => reviewDTO(r, uid)), canReadOthers,
    count: Number(totals[0]?.total ?? 0),
    averageRating: totals[0]?.average ? Number(totals[0].average) : null,
    nextOffset: offset + Math.min(24, rows.length), hasMore: rows.length > 24 });
}));
router.put("/social/posts/:id/reviews", run(async (req, res) => {
  const body = SetVideoReviewBody.safeParse(req.body);
  if (!body.success) throw new SocialError(400, "Use a rating from 1 to 5 and a review of at most 5,000 characters.");
  const { uid, item } = await video(req);
  await socialLimit(uid, "review-write", 30);
  const { rating, expectedRevision, expectedReviewId } = body.data, text = body.data.text.trim();
  const conflict = () => new SocialError(409, "Your review changed elsewhere. Keep your draft and reload the saved review.");
  const result = await db.transaction(async (tx) => {
    const where = and(eq(reviews.userId, uid), eq(reviews.mediaId, item.id));
    const [current] = await tx.select().from(reviews).where(where).for("update");
    if (!current) {
      if (expectedRevision !== 0 || expectedReviewId !== null) throw conflict();
      const [created] = await tx.insert(reviews).values({ userId: uid, mediaId: item.id, rating, text,
        publicContext: item.visibility === "public" && item.attribution === "profile" })
        .onConflictDoNothing().returning();
      if (!created) throw conflict();
      return created;
    }
    if (current.id !== expectedReviewId || current.revision !== expectedRevision) {
      // Idempotent exact retry, without applying a stale/different draft.
      if ((current.id === expectedReviewId || expectedReviewId === null && expectedRevision === 0) &&
        current.revision === expectedRevision + 1 && current.rating === rating && current.text === text) return current;
      throw conflict();
    }
    const [updated] = await tx.update(reviews).set({ rating, text, revision: current.revision + 1, updatedAt: new Date() })
      .where(and(where, eq(reviews.id, expectedReviewId), eq(reviews.revision, expectedRevision))).returning();
    if (!updated) throw conflict();
    return updated;
  });
  res.json(reviewDTO(result, uid));
}));
router.delete("/social/posts/:id/reviews", run(async (req, res) => {
  const query = DeleteVideoReviewQueryParams.safeParse(req.query);
  if (!query.success) throw new SocialError(400, "A saved review revision is required.");
  const { uid, item } = await video(req);
  await socialLimit(uid, "review-delete", 30);
  const where = and(eq(reviews.userId, uid), eq(reviews.mediaId, item.id));
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(reviews).where(where).for("update");
    if (!current) return;
    if (current.id !== query.data.reviewId || current.revision !== query.data.expectedRevision)
      throw new SocialError(409, "Your review changed elsewhere. Reload before deleting.");
    await tx.delete(reviews).where(and(where, eq(reviews.id, query.data.reviewId), eq(reviews.revision, query.data.expectedRevision)));
  });
  res.sendStatus(204);
}));
export default router;
