import { createHash, timingSafeEqual } from "node:crypto";
import { createMediaTicket } from "./media-tickets";
import { and, eq, or, sql } from "drizzle-orm";
import { globalLibraryReader } from "./library-access";
import { accessMembershipsTable, mediaAuthorizationDb, mediaAuthorizationPool, mediaItemsTable as media, socialAccountsTable } from "@workspace/db";
import { publicEligible, unblocked, SocialError } from "./social-access";
import { isSupportedMediaContentType } from "./r2Storage";
import { mediaAuthorizationBudget, MediaAuthorizationBusy } from "./media-authorization-budget";
import { mediaAuthorizationTelemetry } from "./media-authorization-telemetry";

mediaAuthorizationPool.on("error", () => {
  // pg discards failed idle clients. No raw error/SQL/connection string logging.
  mediaAuthorizationTelemetry.record("unavailable");
});

// Used by BOTH transports, including owners viewing their own public posts.
export async function sharedStreamMedia(id: string, viewer: string) {
  const started = performance.now();
  let release: (() => void) | undefined;
  try {
    release = mediaAuthorizationBudget.acquire(viewer);
    // A single fresh statement checks BOTH accounts, rights, moderation, blocks
    // in either direction and visibility, even when viewer === owner.
    const [item] = await mediaAuthorizationDb.select({
      objectKey: media.objectKey, contentType: media.contentType, mediaType: media.mediaType,
      galleryImages: media.galleryImages,
    }).from(media).where(and(eq(media.id, id), eq(media.moderationState, "active"),
      or(globalLibraryReader(viewer), and(publicEligible, unblocked(viewer))),
      sql`exists (select 1 from ${socialAccountsTable} v where v.user_id = ${viewer} and v.accepted_at is not null)`,
      sql`exists (select 1 from ${accessMembershipsTable} m where m.user_id = ${viewer} and m.status = 'active')`)).limit(1);
    if (!item || !isSupportedMediaContentType(item.mediaType, item.contentType)) throw new SocialError(404, "Post not found.");
    mediaAuthorizationTelemetry.record("allowed", performance.now() - started);
    return item;
  } catch (error) {
    mediaAuthorizationTelemetry.record(error instanceof MediaAuthorizationBusy
      ? error.status === 429 ? "viewer_limited" : "service_limited"
      : error instanceof SocialError ? "denied" : "unavailable", release ? performance.now() - started : undefined);
    throw error;
  } finally {
    release?.();
  }
}

export function edgeServiceAuthenticated(credential: string | undefined) {
  const secret = process.env.SHARED_MEDIA_EDGE_SECRET;
  if (!secret || secret.length < 32 || !credential) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(credential), hash(`Bearer ${secret}`));
}

export function sharedMediaUrl(base: string, id: string, viewer: string) {
  const configured = process.env.SHARED_MEDIA_EDGE_ORIGIN;
  let origin = base;
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
        !process.env.SHARED_MEDIA_EDGE_SECRET || process.env.SHARED_MEDIA_EDGE_SECRET.length < 32) {
      throw new Error("Shared edge delivery requires an HTTPS origin and a service secret of at least 32 characters.");
    }
    origin = url.origin;
  }
  return `${origin}/streams/${encodeURIComponent(id)}?ticket=${createMediaTicket(id, viewer)}`;
}
