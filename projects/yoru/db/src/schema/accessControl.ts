import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const accessMembershipsTable = pgTable("access_memberships", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("access_members_active_email_idx").on(table.email).where(sql`${table.status} = 'active'`),
  uniqueIndex("access_members_one_owner_idx").on(table.role).where(sql`${table.role} = 'owner' and ${table.status} = 'active'`),
  index("access_members_role_status_idx").on(table.role, table.status),
]);

export const accessInvitationsTable = pgTable("access_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdBy: text("created_by").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedUserId: text("accepted_user_id"),
}, (table) => [
  uniqueIndex("access_invites_pending_email_idx").on(table.email).where(sql`${table.status} = 'pending'`),
  index("access_invites_status_expiry_idx").on(table.status, table.expiresAt),
]);

export const insertAccessMembershipSchema = createInsertSchema(accessMembershipsTable).omit({ createdAt: true });
export const insertAccessInvitationSchema = createInsertSchema(accessInvitationsTable).omit({
  id: true,
  createdAt: true,
  acceptedAt: true,
  acceptedUserId: true,
});

export type AccessMembership = typeof accessMembershipsTable.$inferSelect;
export type InsertAccessMembership = z.infer<typeof insertAccessMembershipSchema>;
export type AccessInvitation = typeof accessInvitationsTable.$inferSelect;
export type InsertAccessInvitation = z.infer<typeof insertAccessInvitationSchema>;
