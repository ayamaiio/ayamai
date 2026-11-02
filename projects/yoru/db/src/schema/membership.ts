import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const membersTable = pgTable("members", {
  userId: text("user_id").primaryKey(),
  source: text("source").notNull(),
  referredBy: text("referred_by"),
  relationshipAcceptedAt: timestamp("relationship_accepted_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("members_referrer_idx").on(t.referredBy)]);

export const invitationsTable = pgTable("membership_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  inviterId: text("inviter_id").notNull().references(() => membersTable.userId),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  redeemedBy: text("redeemed_by").unique(),
}, (t) => [index("membership_invitations_inviter_idx").on(t.inviterId)]);
export const insertMemberSchema = createInsertSchema(membersTable);
export type Member = z.infer<typeof insertMemberSchema>;
