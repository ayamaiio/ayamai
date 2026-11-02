import { Router, type IRouter } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetMediaViewUrlParams, GetMediaPreviewResponse } from "@workspace/api-zod";
import { requireAuth, getRequestUserId } from "../middlewares/requireAuth";
import { accessibleMedia, SocialError, socialLimit } from "../lib/social-access";
import { createMediaTicket, openMediaTicket } from "../lib/media-tickets";
import { enqueuePreview, isPreviewPending } from "../lib/media-previews";
import { previewKey, PREVIEW_MAX_BYTES } from "../lib/preview-render";
import { mediaObjectExists, readMediaRange } from "../lib/r2Storage";
import { db, membersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isActiveAccessMember } from "../lib/access-control";

const router: IRouter = Router();

// This is a scoped, opaque bearer URL, not a public R2 URL. Recheck permissions on
// every image request, including visibility changes, moderation, blocks and deletion.
router.get("/media/:id/preview/image", async (req, res): Promise<void> => {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  const params = GetMediaViewUrlParams.safeParse(req.params);
  const viewer = params.success && typeof req.query.ticket === "string" ? openMediaTicket(`preview:${params.data.id}`, req.query.ticket) : null;
  if (!params.success || !viewer) { res.sendStatus(404); return; }
  try {
    const [member] = await db.select({ id: membersTable.userId }).from(membersTable).where(eq(membersTable.userId, viewer)).limit(1);
    if (!member || !await isActiveAccessMember(viewer)) { res.sendStatus(404); return; }
    const item = await accessibleMedia(params.data.id, viewer);
    const result = await readMediaRange(previewKey(item.objectKey));
    if (!(result.Body instanceof Readable)) throw new Error("Missing preview body.");
    if (!result.ContentLength || result.ContentLength > PREVIEW_MAX_BYTES) {
      result.Body.destroy();
      throw new Error("Invalid preview size.");
    }
    res.set({ "Content-Type": "image/jpeg", "Content-Length": String(result.ContentLength), "Content-Disposition": 'inline; filename="preview.jpg"' });
    await pipeline(result.Body, res);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    if (error instanceof SocialError || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) res.sendStatus(404);
    else res.sendStatus(502);
  }
});

router.get("/media/:id/preview", requireAuth, async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const params = GetMediaViewUrlParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid media ID." }); return; }
  try {
    const userId = getRequestUserId(req);
    const item = await accessibleMedia(params.data.id, userId);
    const exists = await mediaObjectExists(previewKey(item.objectKey));
    res.json(GetMediaPreviewResponse.parse({
      status: exists ? (isPreviewPending(item.id) ? "pending" : "ready") : enqueuePreview(item.id) ? "pending" : "unavailable",
      url: exists ? `${req.baseUrl}/media/${item.id}/preview/image?ticket=${createMediaTicket(`preview:${item.id}`, userId)}` : null,
      contentType: "image/jpeg",
    }));
  } catch (error) {
    if (error instanceof SocialError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.post("/media/:id/preview", requireAuth, async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const params = GetMediaViewUrlParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid media ID." }); return; }
  try {
    const userId = getRequestUserId(req);
    const item = await accessibleMedia(params.data.id, userId);
    if (item.userId !== userId) { res.sendStatus(404); return; }
    await socialLimit(userId, "regenerate-preview", 10);
    if (!enqueuePreview(item.id, true)) { res.sendStatus(429); return; }
    res.sendStatus(202);
  } catch (error) {
    if (error instanceof SocialError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});
export default router;
