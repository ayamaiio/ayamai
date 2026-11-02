import { createHash, randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { and, count, desc, eq, gt, lt, sql } from "drizzle-orm";
import {
  accessInvitationsTable as invitations,
  accessMembershipsTable as memberships,
  db,
  socialRateLimitsTable,
  type AccessMembership,
} from "@workspace/db";
import type { AccessSnapshot } from "@workspace/api-zod";
import { ACCESS_INVITE_LIMIT, countOccupiedInviteSlots, hasAvailableInviteSlot } from "./access-policy";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const INVITE_LOCK_KEY = 738421;
const USER_LIMIT_WINDOW_MS = 60_000;

export class AccessError extends Error {
  constructor(public status: number, message: string, public retryAfterSeconds?: number) {
    super(message);
  }
}

export function normalizeAccessEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function verifiedEmailsFor(userId: string): Promise<Set<string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const user = await Promise.race([
    clerkClient.users.getUser(userId),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Identity verification timed out")), 5000);
    }),
  ]).finally(() => clearTimeout(timer));
  return new Set(user.emailAddresses
    .filter((address) => address.verification?.status === "verified")
    .map((address) => normalizeAccessEmail(address.emailAddress)));
}

async function bootstrapConfiguredOwner(userId: string): Promise<AccessMembership | null> {
  const ownerEmail = process.env.APP_OWNER_EMAIL;
  if (!ownerEmail) return null;

  const normalizedOwnerEmail = normalizeAccessEmail(ownerEmail);
  if (!normalizedOwnerEmail) return null;
  const emails = await verifiedEmailsFor(userId);
  if (!emails.has(normalizedOwnerEmail)) return null;

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${INVITE_LOCK_KEY})`);
    const [activeOwner] = await tx.select().from(memberships)
      .where(and(eq(memberships.role, "owner"), eq(memberships.status, "active"))).limit(1);
    // This is an operator-controlled, expected-source constraint, not a second
    // role or a client-controlled recovery parameter. A stale value cannot
    // transfer ownership away from a subsequent, different owner.
    const transferFrom = process.env.APP_OWNER_TRANSFER_FROM_USER_ID?.trim();
    const separateIdentity = activeOwner && activeOwner.userId !== userId;
    if (separateIdentity && transferFrom !== activeOwner.userId) {
      throw new AccessError(409, "Owner configuration conflicts with an existing owner. Operator review required.");
    }

    const [sameEmail] = await tx.select({ userId: memberships.userId }).from(memberships)
      .where(and(eq(memberships.email, normalizedOwnerEmail), eq(memberships.status, "active"))).limit(1);
    if (sameEmail && sameEmail.userId !== userId) {
      throw new AccessError(409, "Owner configuration conflicts with an existing account. Operator review required.");
    }

    const [existing] = await tx.select().from(memberships)
      .where(eq(memberships.userId, userId)).limit(1);
    // Owner configuration must never silently restore a revoked account.
    if (existing && existing.status !== "active") return;
    // Both writes share the advisory lock and transaction. Preserve the legacy
    // account, admission, email, provenance and all account-owned content.
    if (separateIdentity) {
      await tx.update(memberships).set({ role: "member" })
        .where(eq(memberships.userId, activeOwner.userId));
    }
    if (existing?.status === "active") {
      // Includes an email change on the SAME Clerk identity. The provider check
      // above, not the old stored email or a request field, proves the target.
      await tx.update(memberships).set({ role: "owner", email: normalizedOwnerEmail, revokedAt: null })
        .where(eq(memberships.userId, userId));
      return;
    }

    await tx.insert(memberships).values({
      userId,
      email: normalizedOwnerEmail,
      role: "owner",
      status: "active",
      revokedAt: null,
    });
  });

  const [owner] = await db.select().from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner"), eq(memberships.status, "active")))
    .limit(1);
  return owner ?? null;
}

export async function activeMembership(userId: string): Promise<AccessMembership | null> {
  const [member] = await db.select().from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active"))).limit(1);
  return member ?? null;
}

export async function isActiveAccessMember(userId: string): Promise<boolean> {
  return (await activeMembership(userId)) !== null;
}

async function enforceUserLimit(userId: string, action: string, limit: number, windowMs = USER_LIMIT_WINDOW_MS) {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const key = `access:${action}:${userId}:${bucket}`;
  const [record] = await db.insert(socialRateLimitsTable)
    .values({ key, hits: 1, expiresAt: new Date(now + windowMs * 2) })
    .onConflictDoUpdate({ target: socialRateLimitsTable.key, set: { hits: sql`${socialRateLimitsTable.hits} + 1` } })
    .returning();
  if (record.hits > limit) {
    throw new AccessError(429, "Too many requests. Please wait before trying again.",
      Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000)));
  }
  if (record.hits === 1) {
    await db.delete(socialRateLimitsTable).where(sql`${socialRateLimitsTable.expiresAt} < now()`);
  }
}

export async function requireActiveOwner(userId: string): Promise<void> {
  const member = await activeMembership(userId);
  if (member?.role !== "owner") throw new AccessError(403, "Owner access required.");
}

type AccessQuery = Pick<typeof db, "select">;
type AccessTransaction = Pick<typeof db, "execute">;

async function acquireInviteLock(tx: AccessTransaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(${INVITE_LOCK_KEY})`);
}

async function occupiedInviteSlots(tx: AccessQuery, now: Date) {
  const [memberCount] = await tx.select({ value: count() }).from(memberships)
    .where(and(eq(memberships.role, "member"), eq(memberships.status, "active")));
  const [inviteCount] = await tx.select({ value: count() }).from(invitations)
    .where(and(eq(invitations.status, "pending"), gt(invitations.expiresAt, now)));
  return countOccupiedInviteSlots(Number(memberCount?.value ?? 0), Number(inviteCount?.value ?? 0));
}

export async function getAccessSnapshot(userId: string): Promise<AccessSnapshot> {
  let member = await activeMembership(userId);
  const configuredOwner = process.env.APP_OWNER_EMAIL;
  if (configuredOwner && (!member ||
      member.role !== "owner" || normalizeAccessEmail(member.email) !== normalizeAccessEmail(configuredOwner))) {
    // Routine navigation/focus from a few tabs must not exhaust recovery.
    // Still bound provider lookups per authenticated account across servers.
    await enforceUserLimit(userId, "owner-bootstrap", 30);
    member = (await bootstrapConfiguredOwner(userId)) ?? member;
  }
  if (!member) {
    return { membership: null, inviteSlotsUsed: 0, inviteSlotsRemaining: ACCESS_INVITE_LIMIT, invites: [], members: [] };
  }
  if (member.role !== "owner") {
    return { membership: { role: "member" }, inviteSlotsUsed: 0, inviteSlotsRemaining: ACCESS_INVITE_LIMIT, invites: [], members: [] };
  }

  const now = new Date();
  const [activeMembers, allInvites, used] = await Promise.all([
    db.select({ userId: memberships.userId, email: memberships.email, createdAt: memberships.createdAt })
      .from(memberships).where(and(eq(memberships.role, "member"), eq(memberships.status, "active")))
    .orderBy(desc(memberships.createdAt)).limit(ACCESS_INVITE_LIMIT),
    db.select().from(invitations).orderBy(desc(invitations.createdAt)).limit(50),
    occupiedInviteSlots(db, now),
  ]);

  const inviteRows = allInvites.map((invite) => ({
    id: invite.id,
    email: invite.email,
    status: invite.status === "pending" && invite.expiresAt <= now ? "expired" as const : invite.status as "pending" | "accepted" | "revoked",
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
  }));

  return {
    membership: { role: "owner" },
    inviteSlotsUsed: Math.min(used, ACCESS_INVITE_LIMIT),
    inviteSlotsRemaining: Math.max(0, ACCESS_INVITE_LIMIT - used),
    invites: inviteRows,
    members: activeMembers.map((active) => ({
      userId: active.userId,
      email: active.email,
      createdAt: active.createdAt,
    })),
  };
}

export async function validateAccessInvite(token: string) {
  const [invite] = await db.select({ email: invitations.email }).from(invitations)
    .where(and(eq(invitations.tokenHash, hashAccessToken(token)), eq(invitations.status, "pending"), gt(invitations.expiresAt, new Date())))
    .limit(1);
  return invite ? { valid: true, email: invite.email } : { valid: false, email: null };
}

export async function createAccessInvite(ownerUserId: string, inputEmail: string) {
  const email = normalizeAccessEmail(inputEmail);
  await enforceUserLimit(ownerUserId, "invite-create", 20, 24 * 60 * 60 * 1000);
  if (process.env.APP_OWNER_EMAIL && email === normalizeAccessEmail(process.env.APP_OWNER_EMAIL)) {
    throw new AccessError(409, "The configured owner address cannot be invited as a member.");
  }
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  const created = await db.transaction(async (tx) => {
    await acquireInviteLock(tx);
    await tx.update(invitations).set({ status: "expired" })
      .where(and(eq(invitations.status, "pending"), lt(invitations.expiresAt, now)));

    const [existingMember] = await tx.select({ userId: memberships.userId }).from(memberships)
      .where(and(eq(memberships.email, email), eq(memberships.status, "active"))).limit(1);
    const [existingInvite] = await tx.select({ id: invitations.id }).from(invitations)
      .where(and(eq(invitations.email, email), eq(invitations.status, "pending"), gt(invitations.expiresAt, now))).limit(1);
    if (existingMember || existingInvite) throw new AccessError(409, "That email already has access or an active invitation.");
    const [memberCount] = await tx.select({ value: count() }).from(memberships)
      .where(and(eq(memberships.role, "member"), eq(memberships.status, "active")));
    const [inviteCount] = await tx.select({ value: count() }).from(invitations)
      .where(and(eq(invitations.status, "pending"), gt(invitations.expiresAt, now)));
    if (!hasAvailableInviteSlot(Number(memberCount?.value ?? 0), Number(inviteCount?.value ?? 0))) {
      throw new AccessError(409, "All five invitation slots are in use.");
    }

    const [invite] = await tx.insert(invitations).values({
      email,
      tokenHash: hashAccessToken(token),
      createdBy: ownerUserId,
      status: "pending",
      expiresAt,
    }).returning();
    return invite;
  });

  return {
    id: created.id,
    email: created.email,
    invitePath: `/join#${token}`,
    expiresAt: created.expiresAt,
  };
}

export async function acceptAccessInvite(userId: string, token: string): Promise<void> {
  await enforceUserLimit(userId, "invite-accept", 10);
  const verifiedEmails = await verifiedEmailsFor(userId);
  const tokenHash = hashAccessToken(token);
  const now = new Date();

  await db.transaction(async (tx) => {
    await acquireInviteLock(tx);
    const [invite] = await tx.select().from(invitations)
      .where(eq(invitations.tokenHash, tokenHash)).for("update").limit(1);
    if (!invite) throw new AccessError(404, "Invitation is invalid or expired.");

    const [existing] = await tx.select().from(memberships).where(eq(memberships.userId, userId)).limit(1);
    if (invite.status === "accepted" && invite.acceptedUserId === userId && existing?.status === "active") return;
    if (invite.status !== "pending" || invite.expiresAt <= now) throw new AccessError(409, "Invitation is no longer active.");
    if (!verifiedEmails.has(normalizeAccessEmail(invite.email))) {
      throw new AccessError(403, "Sign in with the verified email address this invitation was sent to.");
    }

    if (existing?.role === "owner" && existing.status === "active") {
      throw new AccessError(409, "This account already has owner access.");
    }
    const [sameEmail] = await tx.select({ userId: memberships.userId }).from(memberships)
      .where(and(eq(memberships.email, invite.email), eq(memberships.status, "active"))).limit(1);
    if (sameEmail && sameEmail.userId !== userId) throw new AccessError(409, "That email already has access.");
    if ((await occupiedInviteSlots(tx, now)) > ACCESS_INVITE_LIMIT) throw new AccessError(409, "Invite capacity is full.");

    if (existing) {
      await tx.update(memberships).set({ email: invite.email, role: "member", status: "active", revokedAt: null })
        .where(eq(memberships.userId, userId));
    } else {
      await tx.insert(memberships).values({
        userId,
        email: invite.email,
        role: "member",
        status: "active",
        revokedAt: null,
      });
    }
    await tx.update(invitations).set({ status: "accepted", acceptedAt: now, acceptedUserId: userId })
      .where(eq(invitations.id, invite.id));
  });
}

export async function revokeAccessInvite(inviteId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await acquireInviteLock(tx);
    const [invite] = await tx.update(invitations).set({ status: "revoked" })
      .where(and(eq(invitations.id, inviteId), eq(invitations.status, "pending"))).returning({ id: invitations.id });
    if (!invite) throw new AccessError(404, "Invitation not found.");
  });
}

export async function revokeAccessMember(userId: string, memberId: string): Promise<void> {
  if (userId === memberId) throw new AccessError(400, "The owner cannot revoke their own access.");
  await db.transaction(async (tx) => {
    await acquireInviteLock(tx);
    const [member] = await tx.update(memberships).set({ status: "revoked", revokedAt: new Date() })
      .where(and(eq(memberships.userId, memberId), eq(memberships.role, "member"), eq(memberships.status, "active")))
      .returning({ userId: memberships.userId });
    if (!member) throw new AccessError(404, "Active member not found.");
  });
}
