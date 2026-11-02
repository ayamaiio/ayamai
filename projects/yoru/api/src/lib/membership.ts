import { createHash, randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, membersTable as members, invitationsTable as invitations, accessMembershipsTable } from "@workspace/db";
import { SocialError, socialLimit } from "./social-access";

export const REFERRAL_LIMIT = 5;
// Fixed at implementation cutover, never reset on process restart or first visit.
export const LEGACY_MEMBER_CUTOFF = Date.parse("2026-10-30T04:19:03Z");
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export type IdentityLookup = (userId: string) => Promise<number>;
const lookupCreatedAt: IdentityLookup = async (userId) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const user = await Promise.race([
      clerkClient.users.getUser(userId),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Identity lookup timed out")), 5000); }),
    ]);
    return user.createdAt;
  } finally { clearTimeout(timer); }
};

export async function ensureMembership(userId: string, lookup: IdentityLookup = lookupCreatedAt) {
  // Explicit app admission/revocation takes precedence over the older referral
  // registry. Never require a second invitation from an already admitted user.
  const [access] = await db.select({ status: accessMembershipsTable.status })
    .from(accessMembershipsTable).where(eq(accessMembershipsTable.userId, userId)).limit(1);
  if (access) {
    if (access.status !== "active") return false;
    // Referral bookkeeping only: private-resource and signed-media checks still
    // require fresh active access_memberships, including after revocation.
    await db.insert(members).values({ userId, source: "access" }).onConflictDoNothing();
    return true;
  }
  const [member] = await db.select().from(members).where(eq(members.userId, userId)).limit(1);
  if (member) return true;
  await socialLimit(userId, "membership-lookup", 6);
  const createdAt = await lookup(userId);
  if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > LEGACY_MEMBER_CUTOFF) return false;
  await db.insert(members).values({ userId, source: "legacy" }).onConflictDoNothing();
  return true;
}

export async function invitationSummary(userId: string) {
  const rows = await db.select({
    id: invitations.id, createdAt: invitations.createdAt,
    revokedAt: invitations.revokedAt, redeemedAt: invitations.redeemedAt,
  }).from(invitations).where(eq(invitations.inviterId, userId))
    .orderBy(sql`case when ${invitations.revokedAt} is null and ${invitations.redeemedAt} is null then 0 else 1 end`, desc(invitations.createdAt)).limit(100);
  const [totals] = await db.select({
    used: sql<number>`count(*) filter (where ${invitations.redeemedAt} is not null)::int`,
    pending: sql<number>`count(*) filter (where ${invitations.revokedAt} is null and ${invitations.redeemedAt} is null)::int`,
  }).from(invitations).where(eq(invitations.inviterId, userId));
  return {
    limit: REFERRAL_LIMIT, successful: totals.used, available: Math.max(0, REFERRAL_LIMIT - totals.used - totals.pending),
    invitations: rows.map((row) => ({
      id: row.id, createdAt: row.createdAt.toISOString(),
      status: row.redeemedAt ? "used" as const : row.revokedAt ? "revoked" as const : "unused" as const,
    })),
  };
}

export async function issueInvitation(userId: string) {
  return db.transaction(async (tx) => {
    const [member] = await tx.select().from(members).where(eq(members.userId, userId)).for("update");
    if (!member) throw new SocialError(403, "An invitation is required.");
    const [total] = await tx.select({ count: sql<number>`count(*)::int` }).from(invitations)
      .where(and(eq(invitations.inviterId, userId), isNull(invitations.revokedAt)));
    if (total.count >= REFERRAL_LIMIT) throw new SocialError(409, "All five referral places are used or reserved. Revoke an unused invitation to free a place.");
    const token = randomBytes(32).toString("base64url");
    const [row] = await tx.insert(invitations).values({ inviterId: userId, tokenHash: hash(token) }).returning({ id: invitations.id });
    // Plaintext is returned ONCE, never persisted or included in lists.
    return { id: row.id, token };
  });
}

export async function redeemInvitation(userId: string, token: string) {
  return db.transaction(async (tx) => {
    // Same-account retries and two different tokens cannot create two edges.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`membership:${userId}`}, 0))`);
    const [existing] = await tx.select().from(members).where(eq(members.userId, userId));
    if (existing) return;
    const [invite] = await tx.select().from(invitations).where(eq(invitations.tokenHash, hash(token))).for("update");
    if (!invite || invite.revokedAt || invite.redeemedAt || invite.inviterId === userId) {
      throw new SocialError(400, "That invitation is invalid, revoked, or already used.");
    }
    const [inviter] = await tx.select().from(members).where(eq(members.userId, invite.inviterId)).for("update");
    if (!inviter) throw new SocialError(400, "That invitation is unavailable.");
    const [count] = await tx.select({ used: sql<number>`count(*)::int` }).from(members).where(eq(members.referredBy, invite.inviterId));
    if (count.used >= REFERRAL_LIMIT) throw new SocialError(409, "That member has already made five referrals.");
    const now = new Date();
    await tx.insert(members).values({ userId, source: "referral", referredBy: invite.inviterId, relationshipAcceptedAt: now });
    await tx.update(invitations).set({ redeemedBy: userId, redeemedAt: now }).where(eq(invitations.id, invite.id));
  });
}

export async function revokeInvitation(userId: string, id: string) {
  // Lock invite before member: same ordering as redemption, avoids deadlocks.
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(invitations).where(and(eq(invitations.id, id), eq(invitations.inviterId, userId))).for("update");
    if (!invite) throw new SocialError(404, "Invitation not found.");
    if (invite.redeemedAt) throw new SocialError(409, "A used invitation cannot be revoked.");
    await tx.select().from(members).where(eq(members.userId, userId)).for("update");
    await tx.update(invitations).set({ revokedAt: invite.revokedAt ?? new Date() }).where(eq(invitations.id, id));
  });
}

export async function referralRelationships(cursor?: string) {
  const rows = await db.select({ inviterId: members.referredBy, memberId: members.userId, joinedAt: members.joinedAt })
    .from(members).where(and(sql`${members.referredBy} is not null`, cursor ? gt(members.userId, cursor) : undefined))
    .orderBy(asc(members.userId)).limit(101);
  return { relationships: rows.slice(0, 100).map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() })),
    nextCursor: rows.length > 100 ? rows[99].memberId : null };
}
