import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, playbackBookmarksTable as bookmarks } from "@workspace/db";
import { GetPlaybackBookmarkParams, SetPlaybackBookmarkBody } from "@workspace/api-zod";
import { requireAuth, getRequestUserId } from "../middlewares/requireAuth";
import { accessibleMedia, SocialError, socialLimit } from "../lib/social-access";

const router: IRouter = Router();
const path = "/media/:id/playback-bookmark/:viewerId";
router.use(path, requireAuth, (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
const run = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch((e: unknown) => e instanceof SocialError
      ? res.status(e.status).json({ error: e.message }) : next(e));
  };
async function context(req: Request) {
  const params = GetPlaybackBookmarkParams.safeParse(req.params);
  if (!params.success) throw new SocialError(400, "Invalid video.");
  const uid = getRequestUserId(req);
  // This parameter is a stale-session guard, never an authority to select another viewer.
  if (params.data.viewerId !== uid) throw new SocialError(403, "Your account changed. Reopen the video.");
  const item = await accessibleMedia(params.data.id, uid);
  if (item.mediaType !== "video") throw new SocialError(400, "Playback bookmarks are for videos.");
  await socialLimit(uid, "playback-bookmark", 120);
  return { uid, item };
}
router.get(path, run(async (req, res) => {
  const { uid, item } = await context(req);
  const [bookmark] = await db.select().from(bookmarks).where(and(eq(bookmarks.userId, uid), eq(bookmarks.mediaId, item.id)));
  res.json({ seconds: bookmark?.seconds ?? (item.userId === uid ? item.progressSeconds : null) });
}));
router.put(path, run(async (req, res) => {
  const parsed = SetPlaybackBookmarkBody.safeParse(req.body);
  if (!parsed.success || !Number.isFinite(parsed.data.seconds)) throw new SocialError(400, "Invalid playback position.");
  const { uid, item } = await context(req);
  const seconds = item.durationSeconds && Number.isFinite(item.durationSeconds)
    ? Math.min(parsed.data.seconds, item.durationSeconds) : parsed.data.seconds;
  await db.insert(bookmarks).values({ userId: uid, mediaId: item.id, seconds })
    .onConflictDoUpdate({ target: [bookmarks.userId, bookmarks.mediaId], set: { seconds, updatedAt: new Date() } });
  res.json({ seconds });
}));
export default router;
