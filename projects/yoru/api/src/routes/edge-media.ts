import { Router, type IRouter } from "express";
import { AuthorizeEdgeMediaBody, AuthorizeEdgeMediaResponse } from "@workspace/api-zod";
import { openMediaTicket } from "../lib/media-tickets";
import { edgeServiceAuthenticated, sharedStreamMedia } from "../lib/shared-delivery";
import { SocialError } from "../lib/social-access";
import { MediaAuthorizationBusy, mediaAuthorizationIngress } from "../lib/media-authorization-budget";
import { mediaAuthorizationTelemetry } from "../lib/media-authorization-telemetry";

const router: IRouter = Router();
// Internal only: never return storage metadata until service AND viewer authenticate.
router.post("/edge/media-authorize", async (req, res): Promise<void> => {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (!mediaAuthorizationIngress.take()) {
    mediaAuthorizationTelemetry.record("ingress_limited");
    res.set("Retry-After", "1").sendStatus(503); return;
  }
  const deny = () => { mediaAuthorizationTelemetry.record("denied"); res.sendStatus(404); };
  if (!edgeServiceAuthenticated(req.get("x-edge-authorization"))) { deny(); return; }
  const parsed = AuthorizeEdgeMediaBody.safeParse(req.body);
  if (!parsed.success) { deny(); return; }
  const { id, ticket } = parsed.data;
  const viewer = openMediaTicket(id, ticket);
  if (!viewer) { deny(); return; }
  try {
    const item = await sharedStreamMedia(id, viewer);
    res.json(AuthorizeEdgeMediaResponse.parse({ objectKey: item.objectKey, contentType: item.contentType }));
  } catch (error) {
    // Fail closed on DB outages; never return an expired/cached grant.
    if (error instanceof MediaAuthorizationBusy) { res.set("Retry-After", "1").sendStatus(error.status); return; }
    if (!(error instanceof SocialError)) res.set("Retry-After", "1");
    res.sendStatus(error instanceof SocialError ? 404 : 503);
  }
});
export default router;
