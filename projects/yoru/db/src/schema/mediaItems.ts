import { createInsertSchema } from "drizzle-zod";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// Additional images belong to the parent post, never independent feed items.
export type GalleryImage = {
  id: string;
  objectKey: string;
  originalName: string;
  contentType: string;
  size: number;
};

export const mediaItemsTable = pgTable(
  "media_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    collection: text("collection"),
    description: text("description").notNull().default(""),
    tags: text("tags").array().notNull().default([]),
    visibility: text("visibility").notNull().default("private"),
    attribution: text("attribution").notNull().default("anonymous"),
    moderationState: text("moderation_state").notNull().default("active"),
    rightsConfirmedAt: timestamp("rights_confirmed_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    durationSeconds: doublePrecision("duration_seconds"),
    originalName: text("original_name").notNull(),
    objectKey: text("object_key").notNull(),
    galleryImages: jsonb("gallery_images").$type<GalleryImage[]>().notNull().default([]),
    submissionId: uuid("submission_id"),
    submissionHash: text("submission_hash"),
    contentType: text("content_type").notNull(),
    mediaType: text("media_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    isFavorite: boolean("is_favorite").notNull().default(false),
    progressSeconds: doublePrecision("progress_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("media_items_user_created_idx").on(table.userId, table.createdAt),
    index("media_items_user_collection_idx").on(table.userId, table.collection),
    uniqueIndex("media_items_object_key_idx").on(table.objectKey),
    uniqueIndex("media_items_user_submission_idx").on(table.userId, table.submissionId),
    index("media_items_gallery_images_idx").using("gin", table.galleryImages),
    index("media_items_discovery_idx").on(table.visibility, table.moderationState, table.publishedAt),
  ],
);

export const insertMediaItemSchema = createInsertSchema(mediaItemsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMediaItem = z.infer<typeof insertMediaItemSchema>;
export type MediaItem = typeof mediaItemsTable.$inferSelect;
