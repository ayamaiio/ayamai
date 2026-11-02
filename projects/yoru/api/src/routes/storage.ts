import { Router, type IRouter } from "express";
import { RequestCaptureUploadBody } from "@workspace/api-zod";
import { captureKey } from "../lib/browser-capture";
import { socialLimit, SocialError } from "../lib/social-access";
import {
  RequestMediaUploadUrlBody,
  RequestMediaUploadUrlResponse,
} from "@workspace/api-zod";
import {
  createUploadUrl,
  isSupportedMediaContentType,
  makeMediaObjectKey,
  maxSingleUploadBytes,
} from "../lib/r2Storage";
import {
  getRequestUserId,
  requireAuth,
} from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(requireAuth);

router.post("/capture/uploads", async (req, res): Promise<void> => {
  const parsed = RequestCaptureUploadBody.safeParse(req.body);
  if (!parsed.success || !req.get("X-Capture-Account")) {
    res.status(400).json({ error: "Pair an account and select a supported file up to 20 MiB." });
    return;
  }
  const uid = getRequestUserId(req);
  try { await socialLimit(uid, "browser-capture", 6, 60_000); }
  catch (error) {
    if (error instanceof SocialError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
  const objectKey = captureKey(uid, parsed.data.sha256);
  res.set("Cache-Control", "private, no-store").json({
    objectKey, uploadUrl: await createUploadUrl(objectKey, parsed.data.contentType),
  });
});

router.post("/storage/uploads/request-url", async (req, res): Promise<void> => {
  const parsed = RequestMediaUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, size, contentType, mediaType } = parsed.data;
  if (size > maxSingleUploadBytes) {
    res.status(413).json({
      error: "Files must be 5 GB or smaller for this first upload flow.",
    });
    return;
  }
  if (!isSupportedMediaContentType(mediaType, contentType)) {
    res.status(415).json({ error: "This image or video format is not supported." });
    return;
  }

  const objectKey = makeMediaObjectKey(getRequestUserId(req));
  const uploadUrl = await createUploadUrl(objectKey, contentType);
  res.json(
    RequestMediaUploadUrlResponse.parse({
      uploadUrl,
      objectKey,
    }),
  );
});

export default router;
