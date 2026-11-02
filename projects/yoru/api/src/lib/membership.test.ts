import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { clerkClient } from "@clerk/express";
import { db, pool, membersTable as members, invitationsTable as invitations, socialAccountsTable as accounts, socialRateLimitsTable as rates } from "@workspace/db";
import { eq, like } from "drizzle-orm";
import { ensureMembership, LEGACY_MEMBER_CUTOFF, invitationSummary, issueInvitation, redeemInvitation, revokeInvitation } from "./membership";
import membershipRouter from "../routes/membership";
import { requireMember } from "../middlewares/requireAuth";
import { membershipBoundary } from "../middlewares/membershipBoundary";
import { GetMembershipInvitationsResponse, GetMembershipReferralsResponse } from "@workspace/api-zod";

test("invitation membership, quotas, isolation and registration bypass", async (t) => {
  const prefix = `invite-test-${randomUUID()}-`;
  const owner = prefix + "owner", other = prefix + "other", legacy = prefix + "legacy", newcomer = prefix + "new";
  const oldModerators = process.env.SOCIAL_MODERATOR_USER_IDS;
  process.env.SOCIAL_MODERATOR_USER_IDS = owner;
  mock.method(clerkClient.users, "getUser", async () => ({ createdAt: LEGACY_MEMBER_CUTOFF + 1000 }));
  await db.insert(members).values([{ userId: owner, source: "legacy" }, { userId: other, source: "legacy" }]);
  await db.insert(accounts).values([{ userId: owner, acceptedAt: new Date() }, { userId: other, acceptedAt: new Date() }]);
  const app = express();
  app.use(express.json());
  // Test-only fixture auth; this app is never exported or used by the service.
  app.use((req, _res, next) => {
    const auth = Object.assign(() => ({ userId: req.get("x-test-user") ?? null, tokenType: "session_token", isAuthenticated: !!req.get("x-test-user") }),
      { [Symbol.for("@clerk/express.auth")]: true });
    (req as unknown as { auth: unknown }).auth = auth; next();
  });
  app.use("/api", membershipBoundary, membershipRouter);
  app.get("/api/new-resource", (_req, res) => { res.sendStatus(204); });
  app.get("/protected", requireMember, (_req, res) => { res.sendStatus(204); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as { port: number };
  const call = (path: string, user?: string, method = "GET", body?: unknown) => fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method, headers: { ...(user ? { "x-test-user": user } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  try {
    await t.test("grandfathers existing identities without granting operator roles; denies new ones", async () => {
      assert.equal(await ensureMembership(legacy, async () => LEGACY_MEMBER_CUTOFF - 1), true);
      assert.equal(await ensureMembership(newcomer, async () => LEGACY_MEMBER_CUTOFF + 1), false);
      assert.equal((await db.select().from(members).where(eq(members.userId, newcomer))).length, 0);
      assert.equal((await call("/protected")).status, 401);
      assert.equal((await call("/protected", owner)).status, 204);
      assert.equal((await call("/protected", newcomer)).status, 403);
      assert.equal((await call("/api/new-resource", newcomer)).status, 403, "even newly added routes are closed by default");
      assert.equal((await call("/api/new-resource", owner)).status, 204);
      const status = await (await call("/api/membership", newcomer)).json();
      assert.deepEqual(status, { member: false, isOperator: false });
      assert.equal((await call("/api/membership/invitations", newcomer)).status, 403);
    });
    const issued = await Promise.allSettled(Array.from({ length: 12 }, () => issueInvitation(owner)));
    const codes = issued.flatMap((r) => r.status === "fulfilled" ? [r.value] : []);
    await t.test("concurrent issuance reserves at most five slots and stores only hashes", async () => {
      assert.equal(codes.length, 5);
      assert.match(codes[0].token, /^[A-Za-z0-9_-]{43}$/);
      const [stored] = await db.select().from(invitations).where(eq(invitations.id, codes[0].id));
      assert.notEqual(stored.tokenHash, codes[0].token);
      assert.equal((await invitationSummary(owner)).available, 0);
      assert.equal(JSON.stringify(await invitationSummary(owner)).includes(codes[0].token), false);
    });
    await t.test("acknowledgement and valid codes required; invalid and cross-account revocation denied", async () => {
      assert.equal((await call("/api/membership/redeem", newcomer, "POST", { token: codes[0].token, relationshipAcknowledged: false })).status, 400);
      assert.equal((await call("/api/membership/redeem", newcomer, "POST", { token: "x".repeat(43), relationshipAcknowledged: true })).status, 400);
      await assert.rejects(revokeInvitation(other, codes[0].id), { status: 404 });
      await revokeInvitation(owner, codes[1].id);
      await assert.rejects(redeemInvitation(prefix + "revoked", codes[1].token), { status: 400 });
      assert.equal((await invitationSummary(owner)).available, 1);
    });
    await t.test("a single-use invitation cannot be raced by two identities", async () => {
      const result = await Promise.allSettled([redeemInvitation(newcomer, codes[0].token), redeemInvitation(prefix + "racer", codes[0].token)]);
      assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
      const [edge] = await db.select().from(members).where(eq(members.referredBy, owner));
      assert.equal(edge.referredBy, owner);
      assert.ok(edge.relationshipAcceptedAt);
      await assert.rejects(redeemInvitation(prefix + "reuse", codes[0].token), { status: 400 });
      await assert.rejects(revokeInvitation(owner, codes[0].id), { status: 409 });
      // Same-account retry is idempotent.
      await redeemInvitation(edge.userId, codes[0].token);
    });
    await t.test("ordinary members see neither relationship IDs nor invitee identity", async () => {
      const mine = GetMembershipInvitationsResponse.parse(await (await call("/api/membership/invitations", owner)).json());
      assert.ok(mine.invitations.every((i: Record<string, unknown>) => !("redeemedBy" in i) && !("token" in i) && !("tokenHash" in i)));
      assert.equal((await call("/api/membership/referrals", other)).status, 403);
      assert.equal((await call("/api/membership/referrals")).status, 401);
      const graph = await call("/api/membership/referrals", owner);
      assert.equal(graph.status, 200);
      assert.ok(GetMembershipReferralsResponse.parse(await graph.json()).relationships.some((r) => r.inviterId === owner));
    });
    await t.test("invitations never expire; five successful referrals remain a lifetime cap", async () => {
      const replacement = await issueInvitation(owner);
      await db.update(invitations).set({ createdAt: new Date("2000-01-01T00:00:00Z") }).where(eq(invitations.id, replacement.id));
      await redeemInvitation(prefix + "old-invite", replacement.token);
      await Promise.all(codes.slice(2).map((code, index) => redeemInvitation(prefix + `member-${index}`, code.token)));
      assert.equal((await invitationSummary(owner)).successful, 5);
      await assert.rejects(issueInvitation(owner), { status: 409 });
      assert.equal((await call("/api/membership/invitations", legacy, "POST")).status, 403, "age acceptance is still required");
    });
    await t.test("two different invitations for one account create one referral edge", async () => {
      const a = await issueInvitation(other), b = await issueInvitation(other);
      await Promise.all([redeemInvitation(prefix + "same-account", a.token), redeemInvitation(prefix + "same-account", b.token)]);
      assert.equal((await invitationSummary(other)).successful, 1);
    });
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    mock.restoreAll();
    if (oldModerators === undefined) delete process.env.SOCIAL_MODERATOR_USER_IDS; else process.env.SOCIAL_MODERATOR_USER_IDS = oldModerators;
    await db.delete(invitations).where(like(invitations.inviterId, `${prefix}%`));
    await db.delete(members).where(like(members.userId, `${prefix}%`));
    await db.delete(accounts).where(like(accounts.userId, `${prefix}%`));
    await db.delete(rates).where(like(rates.key, `${prefix}%`));
    await pool.end();
  }
});
