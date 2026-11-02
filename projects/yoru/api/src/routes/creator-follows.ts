import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, count, desc, eq, lt, sql } from "drizzle-orm";
import { db, creatorFollowsTable as follows, profilesTable as profiles } from "@workspace/db";
import { GetCreatorFollowParams, SetCreatorFollowBody, GetFollowedCreatorsQueryParams } from "@workspace/api-zod";
import { requireAuth, getRequestUserId } from "../middlewares/requireAuth";
import { requireAdult, socialLimit, SocialError, unblocked } from "../lib/social-access";
import { profileDTO } from "../lib/social-posts";

const router: IRouter = Router();
router.use("/social", requireAuth, (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
const run = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch((e: unknown) => e instanceof SocialError
      ? res.status(e.status).json({ error: e.message }) : next(e));
  };
async function target(req: Request) {
  const p = GetCreatorFollowParams.safeParse(req.params);
  if (!p.success) throw new SocialError(400, "Invalid profile.");
  const uid = getRequestUserId(req);
  await requireAdult(uid);
  const [profile] = await db.select().from(profiles).where(and(eq(profiles.id, p.data.id),
    unblocked(uid, sql`${profiles.userId}`))).limit(1);
  if (!profile) throw new SocialError(404, "Profile not found.");
  return { uid, profile };
}
async function relationship(uid: string, profile: typeof profiles.$inferSelect) {
  const [own, totals] = await Promise.all([
    db.select().from(follows).where(and(eq(follows.userId, uid), eq(follows.profileId, profile.id))).limit(1),
    db.select({ total: count() }).from(follows).where(and(eq(follows.profileId, profile.id),
      unblocked(uid, sql`${follows.userId}`), unblocked(profile.userId, sql`${follows.userId}`))),
  ]);
  return { following: own.length > 0, followerCount: Number(totals[0]?.total ?? 0), isOwnProfile: uid === profile.userId };
}
router.get("/social/profiles/:id/follow", run(async (req, res) => {
  const { uid, profile } = await target(req);
  await socialLimit(uid, "follow-read", 120);
  res.json(await relationship(uid, profile));
}));
router.put("/social/profiles/:id/follow", run(async (req, res) => {
  const parsed = SetCreatorFollowBody.safeParse(req.body);
  if (!parsed.success) throw new SocialError(400, "Choose follow or unfollow.");
  const { uid, profile } = await target(req);
  if (uid === profile.userId) throw new SocialError(400, "You cannot follow yourself.");
  await socialLimit(uid, "follow-write", 60);
  if (parsed.data.following) await db.insert(follows).values({ userId: uid, profileId: profile.id }).onConflictDoNothing();
  else await db.delete(follows).where(and(eq(follows.userId, uid), eq(follows.profileId, profile.id)));
  res.json(await relationship(uid, profile));
}));
router.get("/social/following", run(async (req, res) => {
  const parsed = GetFollowedCreatorsQueryParams.safeParse(req.query);
  if (!parsed.success) throw new SocialError(400, "Invalid profile cursor.");
  const uid = getRequestUserId(req);
  await requireAdult(uid);
  await socialLimit(uid, "following-list", 90);
  const rows = await db.select({ profile: profiles }).from(follows)
    .innerJoin(profiles, eq(follows.profileId, profiles.id))
    .where(and(eq(follows.userId, uid), unblocked(uid, sql`${profiles.userId}`),
      parsed.data.cursor ? lt(profiles.id, parsed.data.cursor) : undefined))
    .orderBy(desc(profiles.id)).limit(25);
  const items = rows.slice(0, 24).map((r) => profileDTO(r.profile));
  res.json({ items, hasMore: rows.length > 24, nextCursor: rows.length > 24 ? items.at(-1)!.id : null });
}));
export default router;
