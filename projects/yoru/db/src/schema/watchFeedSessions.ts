import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const watchFeedSessionsTable = pgTable(
  "watch_feed_sessions",
  {
    sessionId: uuid("session_id").primaryKey(),
    userId: text("user_id").notNull(),
    lane: text("lane").notNull().default("legacy"),
    mediaType: text("media_type").notNull().default("all"),
    hashtag: text("hashtag").notNull().default(""),
    lengthPreference: text("length_preference").notNull().default("balanced"),
    mediaIds: uuid("media_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("watch_feed_sessions_user_created_idx").on(table.userId, table.createdAt),
  ],
);
