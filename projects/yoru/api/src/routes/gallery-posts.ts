import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router, type IRouter } from "express";
import { CreateGalleryPostBody, CreateGalleryPostResponse, GetGalleryAttachmentViewUrlParams, GetGalleryAttachmentViewUrlResponse } from "@workspace/api-zod";
import { getRequestUserId, requireAuth } from "../middlewares/requireAuth";
import { accessibleMedia, SocialError, socialLimit } from "../lib/social-access";
import { createMediaTicket, openMediaTicket } from "../lib/media-tickets";
import { sharedStreamMedia } from "../lib/shared-delivery";
import { MediaAuthorizationBusy } from "../lib/media-authorization-budget";
import { readMediaRange } from "../lib/r2Storage";
import { enqueuePreview } from "../lib/media-previews";
import { recordGalleryPost } from "../lib/gallery-posts";
import { db, membersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isActiveAccessMember } from "../lib/access-control";

const router: IRouter = Router();

router.post("/media/posts", requireAuth, async (req, res) => {
  const parsed = CreateGalleryPostBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose up to 20 supported images and valid post details." }); return; }
  try {
    const userId = getRequestUserId(req);
    await socialLimit(userId, "gallery:create", 15);
    const item = await recordGalleryPost(userId, parsed.data);
    enqueuePreview(item.id);
    res.status(201).json(CreateGalleryPostResponse.parse({
      id: item.id, title: item.title, collection: item.collection, originalName: item.originalName,
      mediaType: item.mediaType, contentType: item.contentType, size: item.size, isFavorite: item.isFavorite,
      progressSeconds: item.progressSeconds, createdAt: item.createdAt,
    }));
  } catch (error) {
    if (error instanceof SocialError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.get("/media/:id/attachments/:attachmentId/view-url", requireAuth, async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const parsed = GetGalleryAttachmentViewUrlParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid image." }); return; }
  try {
    const viewer = getRequestUserId(req);
    const item = await accessibleMedia(parsed.data.id, viewer);
    const image = item.galleryImages.find(image => image.id === parsed.data.attachmentId);
    if (!image) throw new SocialError(404, "Image not found.");
    const ticket = createMediaTicket(item.id, viewer);
    res.json(GetGalleryAttachmentViewUrlResponse.parse({
      url: `${req.baseUrl}/gallery-streams/${item.id}/${image.id}?ticket=${encodeURIComponent(ticket)}`,
      contentType: image.contentType,
    }));
  } catch (error) {
    if (error instanceof SocialError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

// Opaque, short-lived parent-scoped tickets; no storage locators or uploader IDs.
// This transport deliberately stays on the API origin; production edge routing is unchanged.
router.get("/gallery-streams/:id/:attachmentId", async (req, res) => {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  const parsed = GetGalleryAttachmentViewUrlParams.safeParse(req.params);
  const viewer = parsed.success && typeof req.query.ticket === "string" ? openMediaTicket(parsed.data.id, req.query.ticket) : null;
  if (!parsed.success || !viewer) { res.sendStatus(404); return; }
  const range = req.get("range");
  if (range && (!/^bytes=(?:\d+-\d*|-\d+)$/.test(range) || range.length > 80)) { res.sendStatus(416); return; }
  const abort = new AbortController();
  const onClose = () => { if (!res.writableFinished) abort.abort(); };
  res.on("close", onClose);
  try {
    const [member] = await db.select({ id: membersTable.userId }).from(membersTable).where(eq(membersTable.userId, viewer)).limit(1);
    if (!member || !await isActiveAccessMember(viewer)) throw new SocialError(404, "Post not found.");
    const accessible = await accessibleMedia(parsed.data.id, viewer);
    const item = accessible.visibility === "public" ? await sharedStreamMedia(accessible.id, viewer) : accessible;
    const image = item.galleryImages.find(image => image.id === parsed.data.attachmentId);
    if (!image) throw new SocialError(404, "Image not found.");
    const result = await readMediaRange(image.objectKey, range, abort.signal);
    if (!(result.Body instanceof Readable)) { res.sendStatus(502); return; }
    res.status(range ? 206 : 200).set({
      "Accept-Ranges": "bytes", "Content-Type": image.contentType, "Content-Disposition": 'inline; filename="media"',
    });
    if (result.ContentRange) res.set("Content-Range", result.ContentRange);
    if (result.ContentLength !== undefined) res.set("Content-Length", String(result.ContentLength));
    if (req.method === "HEAD") { result.Body.destroy(); res.end(); return; }
    await pipeline(result.Body, res);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    if (error instanceof MediaAuthorizationBusy) { res.set("Retry-After", "1").sendStatus(error.status); return; }
    res.sendStatus(error instanceof SocialError ? 404 : (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 416 ? 416 : 502);
  } finally { res.off("close", onClose); }
});

export default router;
