import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db, socialAccountsTable as accounts, profilesTable as profiles, mediaItemsTable as media,
  commentsTable as comments, blocksTable as blocks, reportsTable as reports,
  savedPostsTable as saves, watchSignalsTable as signals, watchSettingsTable,
} from "@workspace/db";
import {
  GetSocialProfileQueryParams, GetSocialCommentsQueryParams,
  ActOnSocialPostBody, CreateSocialCommentBody, ModerateSocialReportBody,
  GetSocialPostParams, GetSocialProfileParams, DeleteSocialCommentParams, ModerateSocialReportParams,
  UpdateSocialAccountBody, UpdateSocialProfileBody, GetSocialFeedQueryParams, GetSavedSocialPostsQueryParams,
} from "@workspace/api-zod";
import { requireAuth, getRequestUserId } from "../middlewares/requireAuth";
import { accessibleMedia, isModerator, postValues, publicEligible, requireAdult, SocialError, socialLimit, unblocked } from "../lib/social-access";
import { profileDTO, postDTOs } from "../lib/social-posts";
import { socialFeed } from "../lib/social-feed";
import { recordSocialTelemetry } from "../lib/social-telemetry";
import { videoViewCounts } from "../lib/video-views";
import { canonicalHashtag } from "../lib/annotation-labels";

import { savedSocialPosts } from "../lib/social-saved";

const router: IRouter = Router();
router.use("/social", requireAuth, (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
const run = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch((error: unknown) => error instanceof SocialError
    ? res.status(error.status).json({ error: error.message }) : next(error));
};
const idOf = (req: Request) => {
  const p = GetSocialPostParams.safeParse(req.params);
  if (!p.success) throw new SocialError(400, "Invalid post ID.");
  return p.data.id;
};
async function accountDTO(req: Request) {
  const uid = getRequestUserId(req);
  const [account] = await db.select().from(accounts).where(eq(accounts.userId, uid)).limit(1);
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, uid)).limit(1);
  return { adultAccepted: !!account?.acceptedAt, collaborativeConsent: account?.collaborativeConsent ?? false,
    isModerator: isModerator(req), profile: profile ? profileDTO(profile) : null };
}
router.get("/social/me", run(async (req, res) => res.json(await accountDTO(req))));
router.patch("/social/me", run(async (req, res) => {
  const body = UpdateSocialAccountBody.safeParse(req.body);
  if (!body.success) throw new SocialError(400, "Invalid account preferences.");
  const uid = getRequestUserId(req);
  await socialLimit(uid, "account", 20);
  const consent = body.data.adultConfirmed === true && body.data.policyAccepted === true;
  if (body.data.adultConfirmed !== undefined || body.data.policyAccepted !== undefined) {
    if (!consent) throw new SocialError(400, "Adults only. Both age and policy confirmation are required.");
  }
  await db.insert(accounts).values({ userId: uid, ...(consent ? { acceptedAt: new Date() } : {}),
    ...(body.data.collaborativeConsent !== undefined ? { collaborativeConsent: body.data.collaborativeConsent } : {}) })
    .onConflictDoUpdate({ target: accounts.userId, set: {
      ...(consent ? { acceptedAt: new Date() } : {}),
      ...(body.data.collaborativeConsent !== undefined ? { collaborativeConsent: body.data.collaborativeConsent } : {}),
      userId: uid,
    } });
  res.json(await accountDTO(req));
}));
router.put("/social/profile", run(async (req, res) => {
  const body = UpdateSocialProfileBody.safeParse(req.body);
  if (!body.success || !body.data.displayName.trim()) throw new SocialError(400, "Use a handle with 3–24 lowercase letters, numbers or underscores and a display name.");
  const uid = getRequestUserId(req); await requireAdult(uid); await socialLimit(uid, "profile", 10);
  try {
    const [profile] = await db.insert(profiles).values({ userId: uid, ...body.data, displayName: body.data.displayName.trim() })
      .onConflictDoUpdate({ target: profiles.userId, set: body.data }).returning();
    res.json(profileDTO(profile));
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === "23505") throw new SocialError(409, "That handle is already taken.");
    throw error;
  }
}));
router.get("/social/saved", run(async (req, res) => {
  const query = GetSavedSocialPostsQueryParams.safeParse(req.query);
  if (!query.success) throw new SocialError(400, "Invalid saved-post options.");
  const uid = getRequestUserId(req);
  await socialLimit(uid, "saved", 90);
  res.json(await savedSocialPosts(uid, query.data));
}));
router.get("/social/feed", run(async (req, res) => {
  const body = GetSocialFeedQueryParams.safeParse(req.query);
  if (!body.success) throw new SocialError(400, "Invalid feed options.");
  const uid = getRequestUserId(req); await socialLimit(uid, "feed", 90);
  let hashtag = "";
  try { hashtag = body.data.hashtag?.trim() ? canonicalHashtag(body.data.hashtag) : ""; }
  catch { throw new SocialError(400, "Invalid hashtag."); }
  res.json(await socialFeed(uid, body.data.sessionId, body.data.lane ?? "for-you", body.data.type ?? "all", body.data.offset ?? 0, hashtag, body.data.lengthPreference ?? "balanced"));
}));
router.get("/social/profiles/:id", run(async (req, res) => {
  const params = GetSocialProfileParams.safeParse(req.params), query = GetSocialProfileQueryParams.safeParse(req.query);
  if (!params.success || !query.success) throw new SocialError(400, "Invalid profile request.");
  const uid = getRequestUserId(req); await requireAdult(uid);
  const [p] = await db.select().from(profiles).where(and(eq(profiles.id, params.data.id), unblocked(uid, sql`${profiles.userId}`))).limit(1);
  if (!p) throw new SocialError(404, "Profile not found.");
  const posts = await db.select().from(media).where(and(eq(media.userId, p.userId), eq(media.attribution, "profile"), publicEligible, unblocked(uid)))
    .orderBy(desc(media.publishedAt), media.id).offset(query.data.offset ?? 0).limit(25);
  res.json({ profile: profileDTO(p), posts: await postDTOs(posts.slice(0, 24), uid), hasMore: posts.length > 24 });
}));
router.get("/social/posts/:id", run(async (req, res) => {
  const uid = getRequestUserId(req), item = await accessibleMedia(idOf(req), uid);
  res.json((await postDTOs([item], uid))[0]);
}));
router.patch("/social/posts/:id", run(async (req, res) => {
  const uid = getRequestUserId(req), item = await accessibleMedia(idOf(req), uid);
  if (item.userId !== uid) throw new SocialError(404, "Post not found.");
  await socialLimit(uid, "post-edit", 40);
  const values = await postValues(uid, req.body);
  if (!Object.keys(values).length) throw new SocialError(400, "Post details are required.");
  const [updated] = await db.update(media).set({ ...values, publishedAt: values.visibility === "public" ? item.publishedAt ?? new Date() : null })
    .where(and(eq(media.id, item.id), eq(media.userId, uid), eq(media.moderationState, "active"))).returning();
  if (!updated) throw new SocialError(404, "Post not found.");
  if (values.visibility !== item.visibility) await db.update(signals).set({ publicReaction: false }).where(eq(signals.mediaId, item.id));
  res.json((await postDTOs([updated], uid))[0]);
}));
router.post("/social/posts/:id/action", run(async (req, res) => {
  const body = ActOnSocialPostBody.safeParse(req.body);
  if (!body.success) throw new SocialError(400, "Invalid post action.");
  const uid = getRequestUserId(req), item = await accessibleMedia(idOf(req), uid);
  await socialLimit(uid, "action", 100);
  const action = body.data.action;
  if (["like", "dislike", "clear-reaction"].includes(action)) {
    const reaction = action === "clear-reaction" ? null : action;
    const publicReaction = item.visibility === "public";
    await db.insert(signals).values({ userId: uid, mediaId: item.id, reaction, publicReaction })
      .onConflictDoUpdate({ target: [signals.userId, signals.mediaId], set: { reaction, publicReaction, updatedAt: new Date() } });
  } else if (action === "save") {
    await db.transaction(async (tx) => {
      await tx.insert(saves).values({ userId: uid, mediaId: item.id }).onConflictDoNothing();
      if (item.userId === uid) await tx.update(media).set({ isFavorite: true }).where(eq(media.id, item.id));
    });
  } else if (action === "unsave") {
    await db.transaction(async (tx) => {
      await tx.delete(saves).where(and(eq(saves.userId, uid), eq(saves.mediaId, item.id)));
      if (item.userId === uid) await tx.update(media).set({ isFavorite: false }).where(eq(media.id, item.id));
    });
  } else if (action === "block") {
    if (item.userId === uid) throw new SocialError(400, "You cannot block your own account.");
    await db.insert(blocks).values({ userId: uid, blockedUserId: item.userId }).onConflictDoNothing();
    res.json({ post: null }); return;
  } else if (action === "report") {
    await requireAdult(uid); await socialLimit(uid, "report", 10, 3600000);
    const reason = body.data.reason?.trim();
    if (!reason) throw new SocialError(400, "Please explain the concern.");
    await db.insert(reports).values({ userId: uid, mediaId: item.id, reason }).onConflictDoNothing();
  }
  const current = await accessibleMedia(item.id, uid);
  res.json({ post: (await postDTOs([current], uid))[0] });
}));
router.post("/social/posts/:id/events", run(async (req, res) => {
  const uid = getRequestUserId(req), item = await accessibleMedia(idOf(req), uid);
  await socialLimit(uid, "events", 180);
  const accepted = await recordSocialTelemetry(uid, item, req.body);
  const current = await accessibleMedia(item.id, uid);
  const counts = await videoViewCounts([current], uid);
  res.json({ accepted, viewCount: counts.get(item.id) ?? 0, viewCountVisibility: current.visibility });
}));
function commentDTO(comment: typeof comments.$inferSelect, uid: string, owner: string) {
  // All comments deliberately anonymous: posting a comment must not link an anonymous uploader to their named profile.
  return { id: comment.id, text: comment.text, createdAt: comment.createdAt.toISOString(), canDelete: comment.userId === uid || owner === uid };
}
router.get("/social/posts/:id/comments", run(async (req, res) => {
  const query = GetSocialCommentsQueryParams.safeParse(req.query);
  if (!query.success) throw new SocialError(400, "Invalid comment page.");
  const uid = getRequestUserId(req), item = await accessibleMedia(idOf(req), uid);
  const rows = await db.select().from(comments).where(and(eq(comments.mediaId, item.id), unblocked(uid, sql`${comments.userId}`),
    item.visibility === "public" ? eq(comments.publicContext, true) : undefined))
    .orderBy(desc(comments.createdAt), comments.id).offset(query.data.offset ?? 0).limit(31);
  res.json({ comments: rows.slice(0, 30).map((c) => commentDTO(c, uid, item.userId)), hasMore: rows.length > 30 });
}));
router.post("/social/posts/:id/comments", run(async (req, res) => {
  const body = CreateSocialCommentBody.safeParse(req.body);
  if (!body.success || !body.data.text.trim()) throw new SocialError(400, "Write a comment of 1–1,000 characters.");
  const uid = getRequestUserId(req), item = await accessibleMedia(idOf(req), uid);
  await requireAdult(uid); await socialLimit(uid, "comments", 15);
  const [created] = await db.insert(comments).values({ userId: uid, mediaId: item.id, requestId: body.data.requestId, text: body.data.text.trim(), publicContext: item.visibility === "public" })
    .onConflictDoNothing({ target: [comments.userId, comments.requestId] }).returning();
  const [existing] = created ? [created] : await db.select().from(comments).where(and(eq(comments.userId, uid), eq(comments.requestId, body.data.requestId), eq(comments.mediaId, item.id))).limit(1);
  if (!existing) throw new SocialError(409, "This request ID was used for another comment.");
  if (existing.text !== body.data.text.trim()) throw new SocialError(409, "This request ID was used for different comment text. Submit a new comment.");
  res.status(201).json(commentDTO(existing, uid, item.userId));
}));
router.delete("/social/comments/:id", run(async (req, res) => {
  const parsed = DeleteSocialCommentParams.safeParse(req.params);
  if (!parsed.success) throw new SocialError(400, "Invalid comment ID.");
  const uid = getRequestUserId(req);
  const [comment] = await db.select().from(comments).where(eq(comments.id, parsed.data.id)).limit(1);
  if (!comment) { res.sendStatus(204); return; }
  const item = await accessibleMedia(comment.mediaId, uid);
  if (comment.userId !== uid && item.userId !== uid) throw new SocialError(404, "Comment not found.");
  await db.delete(comments).where(eq(comments.id, comment.id));
  res.sendStatus(204);
}));
router.get("/social/moderation", run(async (req, res) => {
  if (!isModerator(req)) throw new SocialError(403, "Moderator access required.");
  await requireAdult(getRequestUserId(req));
  const rows = await db.select({ id: reports.id, mediaId: reports.mediaId, reason: reports.reason, createdAt: reports.createdAt })
    .from(reports).where(eq(reports.status, "open")).orderBy(reports.createdAt).limit(100);
  res.json({ reports: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
}));
router.post("/social/moderation/:id", run(async (req, res) => {
  if (!isModerator(req)) throw new SocialError(403, "Moderator access required.");
  await requireAdult(getRequestUserId(req));
  const params = ModerateSocialReportParams.safeParse(req.params), body = ModerateSocialReportBody.safeParse(req.body);
  if (!params.success || !body.success) throw new SocialError(400, "Invalid review action.");
  const uid = getRequestUserId(req);
  await db.transaction(async (tx) => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, params.data.id)).for("update");
    if (!report) throw new SocialError(404, "Report not found.");
    if (report.status !== "open") return;
    if (body.data.action === "remove") await tx.update(media).set({ moderationState: "removed", visibility: "private" }).where(eq(media.id, report.mediaId));
    await tx.update(reports).set({ status: body.data.action === "remove" ? "removed" : "dismissed", moderatorId: uid }).where(eq(reports.id, report.id));
  });
  res.sendStatus(204);
}));
export default router;
