import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { db, mediaItemsTable as media, profilesTable, socialAccountsTable, socialRateLimitsTable } from "@workspace/db";
import type { Request } from "express";
import { UpdateSocialPostBody } from "@workspace/api-zod";
import { globalLibraryReader } from "./library-access";
import { requestUserId } from "./local-dev-auth";

export class SocialError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const publicEligible = sql`${media.visibility} = 'public' and ${media.moderationState} = 'active' and ${media.rightsConfirmedAt} is not null
  and exists (select 1 from social_accounts a where a.user_id = ${media.userId} and a.accepted_at is not null)`;
export function unblocked(viewer: string, owner: SQL = sql`${media.userId}`): SQL {
  return sql`not exists (select 1 from social_blocks b where
    (b.user_id = ${viewer} and b.blocked_user_id = ${owner}) or
    (b.blocked_user_id = ${viewer} and b.user_id = ${owner}))`;
}
export async function adultAccepted(userId: string) {
  const [account] = await db.select().from(socialAccountsTable).where(eq(socialAccountsTable.userId, userId)).limit(1);
  return !!account?.acceptedAt;
}
export async function requireAdult(userId: string) {
  if (!(await adultAccepted(userId))) throw new SocialError(403, "Confirm you are at least 18 and accept the content policy before using shared posts.");
}
export async function accessibleMedia(id: string, userId: string) {
  const [item] = await db.select().from(media).where(and(eq(media.id, id), eq(media.moderationState, "active"),
    or(globalLibraryReader(userId), and(unblocked(userId), or(eq(media.userId, userId), publicEligible))))).limit(1);
  if (!item) throw new SocialError(404, "Post not found.");
  if (item.userId !== userId) await requireAdult(userId);
  return item;
}
export function isModerator(req: Request) {
  const userId = requestUserId(req);
  // Never trust a request body, browser flag, handle, or the first registered account.
  const configured = (process.env.SOCIAL_MODERATOR_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return !!userId && configured.includes(userId);
}
export function normalizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.normalize("NFKC").trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-")).filter(Boolean))].slice(0, 15);
}
export async function postValues(userId: string, input: unknown) {
  // Missing options from old clients and pre-existing import jobs stay PRIVATE.
  if (input == null) return {};
  const parsed = UpdateSocialPostBody.safeParse(input);
  if (!parsed.success) throw new SocialError(400, "Invalid post details.");
  const data = parsed.data;
  if (data.visibility === "public") {
    await requireAdult(userId);
    if (!data.rightsConfirmed) throw new SocialError(400, "Confirm you have permission to share this content and that every depicted person is an adult and has consented.");
    if (data.attribution === "profile") {
      const [profile] = await db.select({ id: profilesTable.id }).from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1);
      if (!profile) throw new SocialError(400, "Create a chosen public profile first, or post anonymously.");
    }
  }
  return {
    visibility: data.visibility,
    attribution: data.attribution,
    description: data.description.trim(),
    tags: normalizeTags(data.tags),
    rightsConfirmedAt: data.visibility === "public" ? new Date() : null,
    publishedAt: data.visibility === "public" ? new Date() : null,
  };
}
export async function socialLimit(userId: string, action: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const key = `${userId}:${action}:${bucket}`;
  const [record] = await db.insert(socialRateLimitsTable).values({ key, hits: 1, expiresAt: new Date(now + windowMs * 2) })
    .onConflictDoUpdate({ target: socialRateLimitsTable.key, set: { hits: sql`${socialRateLimitsTable.hits} + 1` } }).returning();
  if (record.hits > limit) throw new SocialError(429, "Too many requests. Please wait a moment.");
  // Bounded probabilistic maintenance is unnecessary: at most one deletion per bucket's first request.
  if (record.hits === 1) await db.delete(socialRateLimitsTable).where(sql`${socialRateLimitsTable.expiresAt} < now()`);
}
