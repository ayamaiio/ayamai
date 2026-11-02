import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db, commentsTable, mediaItemsTable as media, profilesTable, savedPostsTable, watchSignalsTable } from "@workspace/db";
import { unblocked } from "./social-access";
import { videoViewCounts } from "./video-views";
import { postAttachments } from "./gallery-posts";

export function profileDTO(p: typeof profilesTable.$inferSelect) {
  return { id: p.id, handle: p.handle, displayName: p.displayName, bio: p.bio };
}
export async function postDTOs(items: (typeof media.$inferSelect)[], viewer: string) {
  if (!items.length) return [];
  const ids = items.map((item) => item.id);
  const owners = [...new Set(items.filter((item) => item.attribution === "profile").map((item) => item.userId))];
  const [likes, comments, reactions, saved, profiles, views] = await Promise.all([
    db.select({ id: watchSignalsTable.mediaId, total: count() }).from(watchSignalsTable)
      .where(and(inArray(watchSignalsTable.mediaId, ids), eq(watchSignalsTable.reaction, "like"), eq(watchSignalsTable.publicReaction, true))).groupBy(watchSignalsTable.mediaId),
    db.select({ id: commentsTable.mediaId, total: count() }).from(commentsTable)
      .where(and(inArray(commentsTable.mediaId, ids), unblocked(viewer, sql`${commentsTable.userId}`),
        sql`(${commentsTable.publicContext} = true or exists (
          select 1 from media_items m where m.id = ${commentsTable.mediaId}
            and m.visibility = 'private' and m.user_id = ${viewer}
        ))`)).groupBy(commentsTable.mediaId),
    db.select().from(watchSignalsTable).where(and(eq(watchSignalsTable.userId, viewer), inArray(watchSignalsTable.mediaId, ids))),
    db.select().from(savedPostsTable).where(and(eq(savedPostsTable.userId, viewer), inArray(savedPostsTable.mediaId, ids))),
    owners.length ? db.select().from(profilesTable).where(inArray(profilesTable.userId, owners)) : Promise.resolve([] as (typeof profilesTable.$inferSelect)[]),
    videoViewCounts(items, viewer),
  ]);
  return items.map((item) => ({
    id: item.id, mediaType: item.mediaType as "image" | "video",
    attachments: postAttachments(item),
    description: item.description, tags: item.tags,
    visibility: item.visibility as "public" | "private", attribution: item.attribution as "anonymous" | "profile",
    // Explicit allowlist. Never spread a DB row into a public response.
    profile: item.attribution === "profile" ? (() => {
      const p = profiles.find((p) => p.userId === item.userId);
      return p ? profileDTO(p) : null;
    })() : null,
    likeCount: item.visibility === "private"
      ? (reactions.find((r) => r.mediaId === item.id)?.reaction === "like" ? 1 : 0)
      : Number(likes.find((r) => r.id === item.id)?.total ?? 0),
    commentCount: Number(comments.find((r) => r.id === item.id)?.total ?? 0),
    viewCount: views.get(item.id) ?? 0,
    progressSeconds: item.userId === viewer ? item.progressSeconds : null,
    reaction: (reactions.find((r) => r.mediaId === item.id)?.reaction ?? null) as "like" | "dislike" | null,
    isSaved: saved.some((r) => r.mediaId === item.id) || (item.userId === viewer && item.isFavorite),
    isOwner: item.userId === viewer,
    createdAt: (item.publishedAt ?? item.createdAt).toISOString(), durationSeconds: item.durationSeconds,
  }));
}
