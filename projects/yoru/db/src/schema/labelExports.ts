import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { mediaItemsTable } from "./mediaItems";

// Frozen, private metadata only. Original media never leaves private storage.
export const labelExportsTable = pgTable("label_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  tag: text("tag"),
  recordCount: integer("record_count").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
}, (t) => [index("label_exports_author_created_idx").on(t.userId, t.snapshotAt)]);

export const labelExportRowsTable = pgTable("label_export_rows", {
  exportId: uuid("export_id").notNull().references(() => labelExportsTable.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  mediaId: uuid("media_id").notNull().references(() => mediaItemsTable.id, { onDelete: "cascade" }),
  record: jsonb("record").$type<Record<string, unknown>>().notNull(),
}, (t) => [
  primaryKey({ columns: [t.exportId, t.ordinal] }),
  index("label_export_rows_media_idx").on(t.mediaId),
]);
