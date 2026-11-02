import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db, mediaItemsTable as media } from "@workspace/db";
import { publicEligible, requireAdult, unblocked } from "./social-access";
import { postDTOs } from "./social-posts";
import type { GetSavedSocialPostsParams } from "@workspace/api-zod";

/** No caller-supplied account ID: saves are always private to the authenticated viewer. */
export async function savedSocialPosts(viewer: string, options: GetSavedSocialPostsParams) {
  await requireAdult(viewer);
  const rows = await db.select().from(media).where(and(
    eq(media.moderationState, "active"),
    unblocked(viewer),
    or(eq(media.userId, viewer), publicEligible),
    or(
      and(eq(media.userId, viewer), eq(media.isFavorite, true)),
      sql`exists (select 1 from social_saved_posts s where s.user_id = ${viewer} and s.media_id = ${media.id})`,
    ),
    options.type && options.type !== "all" ? eq(media.mediaType, options.type) : undefined,
    options.cursor ? lt(media.id, options.cursor) : undefined,
  )).orderBy(desc(media.id)).limit(25);
  const page = rows.slice(0, 24);
  const hasMore = rows.length > 24;
  return { items: await postDTOs(page, viewer), hasMore, nextCursor: hasMore ? page.at(-1)!.id : null };
}
