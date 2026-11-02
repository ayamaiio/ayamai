import { pgTable, text, uuid, doublePrecision, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mediaItemsTable } from "./mediaItems";

export const playbackBookmarksTable = pgTable("playback_bookmarks", {
  userId: text("user_id").notNull(),
  mediaId: uuid("media_id").notNull().references(() => mediaItemsTable.id, { onDelete: "cascade" }),
  seconds: doublePrecision("seconds").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.mediaId] })]);

export const insertPlaybackBookmarkSchema = createInsertSchema(playbackBookmarksTable).omit({ updatedAt: true });
export type InsertPlaybackBookmark = z.infer<typeof insertPlaybackBookmarkSchema>;
export type PlaybackBookmark = typeof playbackBookmarksTable.$inferSelect;
