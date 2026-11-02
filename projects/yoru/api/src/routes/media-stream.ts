import { Router, type IRouter } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetSocialPostParams } from "@workspace/api-zod";
import { openMediaTicket } from "../lib/media-tickets";
import { SocialError } from "../lib/social-access";
import { sharedStreamMedia } from "../lib/shared-delivery";
import { readMediaRange } from "../lib/r2Storage";
import { MediaAuthorizationBusy } from "../lib/media-authorization-budget";

type StreamDependencies = {
  authorize: (id: string, viewer: string) => Promise<{ objectKey: string; contentType: string }>;
  read: (key: string, range?: string, signal?: AbortSignal) => Promise<{ Body?: unknown; ContentRange?: string; ContentLength?: number }>;
  ticket: typeof openMediaTicket;
};

export function createMediaStreamRouter(deps: StreamDependencies = {
  authorize: sharedStreamMedia, read: readMediaRange, ticket: openMediaTicket,
}): IRouter {
const router: IRouter = Router();
// Ticket is a five-minute encrypted bearer credential, equivalent to a presigned URL.
// It contains no visible account ID; every new Range request rechecks access.
router.get("/streams/:id", async (req, res) => {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  const params = GetSocialPostParams.safeParse(req.params);
  const viewer = params.success && typeof req.query.ticket === "string" ? deps.ticket(params.data.id, req.query.ticket) : null;
  if (!params.success || !viewer) { res.sendStatus(404); return; }
  const range = req.get("range");
  if (range && (!/^bytes=(?:\d+-\d*|-\d+)$/.test(range) || range.length > 80)) { res.sendStatus(416); return; }
  const abort = new AbortController();
  let source: Readable | undefined;
  let sourceFailed = false;
  let phase: "authorization" | "storage" | "transfer" = "authorization";
  const disconnected = () => abort.signal.aborted || res.destroyed || req.aborted;
  const onClose = () => { if (!res.writableFinished) abort.abort(); };
  res.on("close", onClose);
  try {
    const item = await deps.authorize(params.data.id, viewer);
    // Authorization can finish after a swipe away. Do not start an R2 request.
    if (disconnected()) return;
    phase = "storage";
    const result = await deps.read(item.objectKey, range, abort.signal);
    if (result.Body instanceof Readable) source = result.Body;
    // Some transports resolve even after cancellation; still release their body.
    if (disconnected()) return;
    if (!source) throw new Error("Media response body unavailable");
    source.once("error", () => { if (!abort.signal.aborted) sourceFailed = true; });
    res.status(range ? 206 : 200).set({ "Accept-Ranges": "bytes", "Content-Type": item.contentType, "Content-Disposition": 'inline; filename="media"' });
    if (result.ContentRange) res.set("Content-Range", result.ContentRange);
    if (result.ContentLength !== undefined) res.set("Content-Length", String(result.ContentLength));
    if (req.method === "HEAD") { res.end(); return; }
    phase = "transfer";
    await pipeline(source, res, { signal: abort.signal });
  } catch (error) {
    // Disconnects are normal in the scroll feed, not upstream 502 failures.
    // A source error may itself destroy the response, so don't hide that error.
    if (disconnected() && !sourceFailed) return;
    if (error instanceof MediaAuthorizationBusy) { res.set("Retry-After", "1").sendStatus(error.status); return; }
    const rawStatus = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
    const upstreamStatus = typeof rawStatus === "number" && Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : undefined;
    const status = error instanceof SocialError ? 404 : upstreamStatus === 416 ? 416 : 502;
    if (status >= 500) req.log?.warn({
      event: "media_stream_failure", phase, failureStatus: status, upstreamStatus,
      responseStarted: res.headersSent,
    }, "Media stream failed");
    if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
    res.sendStatus(status);
  } finally {
    if (disconnected() && !sourceFailed) req.log?.debug({ event: "media_stream_cancelled", phase }, "Media stream cancelled");
    if (source && !source.destroyed) source.destroy();
    res.off("close", onClose);
  }
});
return router;
}
export default createMediaStreamRouter();
