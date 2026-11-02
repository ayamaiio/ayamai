import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { mediaItemsTable } from "./mediaItems";

export const watchSignalsTable = pgTable(
  "watch_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaItemsTable.id, { onDelete: "cascade" }),
    reaction: text("reaction"),
    publicReaction: boolean("public_reaction").notNull().default(false),
    watchedSeconds: integer("watched_seconds").notNull().default(0),
    completions: integer("completions").notNull().default(0),
    replays: integer("replays").notNull().default(0),
    quickSkips: integer("quick_skips").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("watch_signals_user_media_idx").on(table.userId, table.mediaId),
    index("watch_signals_user_idx").on(table.userId),
  ],
);

export const watchSettingsTable = pgTable("watch_settings", {
  userId: text("user_id").primaryKey(),
  behaviorEnabled: boolean("behavior_enabled").notNull().default(true),
  autoplayEnabled: boolean("autoplay_enabled"),
  dataSaverEnabled: boolean("data_saver_enabled").notNull().default(false),
  alwaysVisibleControls: boolean("always_visible_controls").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertWatchSignalSchema = createInsertSchema(watchSignalsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertWatchSignal = z.infer<typeof insertWatchSignalSchema>;
export type WatchSignal = typeof watchSignalsTable.$inferSelect;
