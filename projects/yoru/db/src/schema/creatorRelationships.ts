import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { profilesTable } from "./social";
import { mediaItemsTable } from "./mediaItems";

export const creatorFollowsTable = pgTable("creator_follows", {
  userId: text("user_id").notNull(),
  profileId: uuid("profile_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.profileId] }),
  index("creator_follows_profile_idx").on(t.profileId),
]);

export const videoReviewsTable = pgTable("video_reviews", {
  id: uuid("id").notNull().defaultRandom(),
  userId: text("user_id").notNull(),
  mediaId: uuid("media_id").notNull().references(() => mediaItemsTable.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(),
  text: text("text").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  // Creation-context privacy survives later publication.
  publicContext: boolean("public_context").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.mediaId] }),
  index("video_reviews_media_updated_idx").on(t.mediaId, t.updatedAt),
]);
