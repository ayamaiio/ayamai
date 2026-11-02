import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const cloudAccountsTable = pgTable("cloud_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  encryptedCredentials: text("encrypted_credentials").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("cloud_accounts_user_provider_idx").on(t.userId, t.provider)]);

export const cloudAuthorizationsTable = pgTable("cloud_authorizations", {
  stateHash: text("state_hash").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  encryptedVerifier: text("encrypted_verifier").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("cloud_authorizations_expiry_idx").on(t.expiresAt)]);

export const insertCloudAccountSchema = createInsertSchema(cloudAccountsTable).omit({ id: true, createdAt: true });
export type InsertCloudAccount = z.infer<typeof insertCloudAccountSchema>;
export type CloudAccountRow = typeof cloudAccountsTable.$inferSelect;
