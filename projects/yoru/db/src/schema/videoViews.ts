import { createInsertSchema } from "drizzle-zod";
import { doublePrecision, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { mediaItemsTable } from "./mediaItems";

/** One cumulative, visibility-scoped viewing record per account/video/UTC day. */
export const videoViewsTable = pgTable("video_views", {
  userId: text("user_id").notNull(),
  mediaId: uuid("media_id").notNull().references(() => mediaItemsTable.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  visibility: text("visibility").notNull(),
  watchedSeconds: doublePrecision("watched_seconds").notNull().default(0),
}, t => [
  primaryKey({ columns: [t.userId, t.mediaId, t.day, t.visibility] }),
  index("video_views_media_visibility_idx").on(t.mediaId, t.visibility),
]);
export const insertVideoViewSchema = createInsertSchema(videoViewsTable);
export type InsertVideoView = z.infer<typeof insertVideoViewSchema>;
export type VideoView = typeof videoViewsTable.$inferSelect;
