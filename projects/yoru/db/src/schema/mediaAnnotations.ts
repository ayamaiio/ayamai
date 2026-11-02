import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { mediaItemsTable } from "./mediaItems";

// Annotations are always private to their author, independently of post visibility.
export const mediaAnnotationsTable = pgTable("media_annotations", {
  userId: text("user_id").notNull(),
  mediaId: uuid("media_id").notNull().references(() => mediaItemsTable.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
  tags: text("tags").array().notNull().default([]),
  attributes: jsonb("attributes").$type<Record<string, string[]>>().notNull().default({}),
  notes: text("notes").notNull().default(""),
  reviewStatus: text("review_status").notNull().default("draft"),
  confidence: text("confidence").notNull().default("unsure"),
  sourceUrl: text("source_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.mediaId] }),
  index("media_annotations_author_updated_idx").on(t.userId, t.updatedAt),
]);

export const mediaAnnotationHistoryTable = pgTable("media_annotation_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  mediaId: uuid("media_id").notNull().references(() => mediaItemsTable.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  payload: jsonb("payload").$type<{
    tags: string[]; rawTags: string[]; attributes: Record<string, string[]>; rawAttributes: Record<string, string[]>;
    notes: string; reviewStatus: string; confidence: string; sourceUrl: string | null;
  }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("media_annotation_history_author_media_idx").on(t.userId, t.mediaId, t.revision)]);
