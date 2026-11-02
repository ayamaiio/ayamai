import { boolean, doublePrecision, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { mediaItemsTable } from "./mediaItems";

export const socialAccountsTable = pgTable("social_accounts", {
  userId: text("user_id").primaryKey(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  collaborativeConsent: boolean("collaborative_consent").notNull().default(false),
});
export const profilesTable = pgTable("social_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique(),
  handle: text("handle").notNull().unique(),
  displayName: text("display_name").notNull(),
  bio: text("bio").notNull().default(""),
});
export const commentsTable = pgTable("social_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  mediaId: uuid("media_id").notNull().references(() => mediaItemsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  text: text("text").notNull(),
  publicContext: boolean("public_context").notNull().default(false),
  requestId: uuid("request_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("social_comments_request_idx").on(t.userId, t.requestId), index("social_comments_media_idx").on(t.mediaId, t.createdAt)]);
export const blocksTable = pgTable("social_blocks", {
  userId: text("user_id").notNull(),
  blockedUserId: text("blocked_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("social_blocks_pair_idx").on(t.userId, t.blockedUserId)]);
export const reportsTable = pgTable("social_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  mediaId: uuid("media_id").notNull().references(() => mediaItemsTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  moderatorId: text("moderator_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("social_reports_user_media_idx").on(t.userId, t.mediaId)]);
export const socialEventsTable = pgTable("social_events", {
  eventId: uuid("event_id").primaryKey(),
  userId: text("user_id").notNull(),
  mediaId: uuid("media_id").notNull().references(() => mediaItemsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  seconds: doublePrecision("seconds").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("social_events_user_time_idx").on(t.userId, t.createdAt)]);
export const savedPostsTable = pgTable("social_saved_posts", {
  userId: text("user_id").notNull(),
  mediaId: uuid("media_id").notNull().references(() => mediaItemsTable.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("social_saved_pair_idx").on(t.userId, t.mediaId)]);
export const socialRateLimitsTable = pgTable("social_rate_limits", {
  key: text("key").primaryKey(),
  hits: doublePrecision("hits").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const insertSocialProfileSchema = createInsertSchema(profilesTable).omit({ id: true });
export type SocialProfile = z.infer<typeof insertSocialProfileSchema>;
