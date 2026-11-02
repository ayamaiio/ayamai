import { and, count, eq, gte, inArray, or } from "drizzle-orm";
import { db, mediaItemsTable, videoViewsTable as views } from "@workspace/db";

export async function videoViewCounts(items: (typeof mediaItemsTable.$inferSelect)[], viewer: string) {
  const videos = items.filter(item => item.mediaType === "video");
  const result = new Map<string, number>();
  if (!videos.length) return result;
  const rows = await db.select({ id: views.mediaId, visibility: views.visibility, total: count() })
    .from(views).where(and(inArray(views.mediaId, videos.map(item => item.id)), gte(views.watchedSeconds, 3),
      or(eq(views.visibility, "public"), eq(views.userId, viewer))))
    .groupBy(views.mediaId, views.visibility);
  for (const item of videos) {
    result.set(item.id, Number(rows.find(row => row.id === item.id && row.visibility === item.visibility)?.total ?? 0));
  }
  return result;
}
