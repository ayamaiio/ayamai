import { createInsertSchema } from "drizzle-zod";
import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const importJobsTable = pgTable("import_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  encryptedSource: text("encrypted_source").notNull(),
  status: text("status").notNull().default("preview"),
  collection: text("collection"),
  posting: jsonb("posting").$type<{ visibility: "private" | "public"; attribution: "anonymous" | "profile"; description: string; tags: string[]; rightsConfirmed: boolean }>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("import_jobs_user_created_idx").on(t.userId, t.createdAt)]);

export const importFilesTable = pgTable("import_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => importJobsTable.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull(),
  name: text("name").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  status: text("status").notNull().default("preview"),
  bytesTransferred: bigint("bytes_transferred", { mode: "number" }).notNull().default(0),
  objectKey: text("object_key").notNull(),
  uploadId: text("upload_id"),
  error: text("error"),
  mediaId: uuid("media_id"),
}, (t) => [index("import_files_job_idx").on(t.jobId)]);

export const insertImportJobSchema = createInsertSchema(importJobsTable).omit({ id: true, createdAt: true });
export type InsertImportJob = z.infer<typeof insertImportJobSchema>;
export type ImportJobRow = typeof importJobsTable.$inferSelect;
export type ImportFileRow = typeof importFilesTable.$inferSelect;
