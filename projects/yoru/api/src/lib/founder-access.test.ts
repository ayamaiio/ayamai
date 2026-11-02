import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock, test } from "node:test";
import express from "express";
import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import {
  GetAccessMeResponse, GetMembershipResponse, ListMediaResponse,
  CreateAccessInviteResponse, ValidateAccessInviteResponse,
} from "@workspace/api-zod";
import {
  db, pool, mediaAuthorizationPool, accessMembershipsTable as access,
  membersTable as members, mediaItemsTable as media, socialAccountsTable as accounts,
} from "@workspace/db";
import app from "../app";
import { membershipBoundary } from "../middlewares/membershipBoundary";
import { LEGACY_MEMBER_CUTOFF, issueInvitation, redeemInvitation } from "./membership";
import { sharedStreamMedia } from "./shared-delivery";
import { logger } from "./logger";

// No real provider users, credentials, media bytes or application rows are
// changed. Only the Clerk identity boundary is substituted inside this test
// process; the service app, middleware ordering and resource routers are real.
test("founder admission through the actual application middleware stack", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
  assert.equal(pool.totalCount, 0, "isolation must be installed before any DB connection");
  const schema = `founder_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^founder_test_[a-f0-9]{32}$/);
  pool.options.options = `-c search_path=${schema},pg_catalog`;
  mediaAuthorizationPool.options.options = `-c search_path=${schema},pg_catalog -c default_transaction_read_only=on`;
  const oldOwner = process.env.APP_OWNER_EMAIL;
  const oldTransferFrom = process.env.APP_OWNER_TRANSFER_FROM_USER_ID;
  const oldModerators = process.env.SOCIAL_MODERATOR_USER_IDS;
  const oldLevel = logger.level;
  logger.level = "silent";
  process.env.APP_OWNER_EMAIL = " FOUNDER@example.invalid ";
  delete process.env.APP_OWNER_TRANSFER_FROM_USER_ID;
  delete process.env.SOCIAL_MODERATOR_USER_IDS;

  const identities = new Map<string, { email: string; verified: boolean }>();
  const identityMock = mock.method(clerkClient.users, "getUser", async (userId: string) => {
    const identity = identities.get(userId);
    return {
      id: userId, createdAt: LEGACY_MEMBER_CUTOFF + 1000,
      emailAddresses: identity ? [{
        emailAddress: identity.email,
        verification: { status: identity.verified ? "verified" : "unverified" },
      }] : [],
    };
  });
  const fixture = express();
  fixture.use((req, _res, next) => {
    const userId = req.get("x-test-user") ?? null;
    Object.assign(req, {
      auth: Object.assign(() => ({ userId, tokenType: "session_token", isAuthenticated: !!userId }),
        { [Symbol.for("@clerk/express.auth")]: true }),
    });
    next();
  });
  // Insert immediately after the real Clerk middleware, not in service code.
  // Importing app ensures a future change to production ordering is tested.
  const stack = app.router.stack;
  const boundaryIndex = stack.findIndex((layer: { handle: unknown }) => layer.handle === membershipBoundary);
  assert.ok(boundaryIndex > 0);
  const fixtureLayer = fixture.router.stack[0];
  stack.splice(boundaryIndex, 0, fixtureLayer);
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    // Clone definitions only. No production/development content is copied.
    const tables = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    for (const { tablename } of tables.rows) {
      assert.match(tablename, /^[a-z][a-z0-9_]*$/);
      await pool.query(`CREATE TABLE "${schema}"."${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`);
    }
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    const call = (path: string, userId?: string, method = "GET", body?: unknown) => fetch(base + path, {
      method, headers: { ...(userId ? { "x-test-user": userId } : {}), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const snapshot = async (response: globalThis.Response) => GetAccessMeResponse.parse(await response.json());
    const membership = async (response: globalThis.Response) => GetMembershipResponse.parse(await response.json());
    const stored = async (userId: string) => (await db.select().from(access).where(eq(access.userId, userId)))[0];
    const member = async (userId: string, email: string, status = "active") => {
      await db.insert(access).values({ userId, email, status, role: "member" });
    };

    await t.test("health stays public; access status and unknown resources require authentication", async () => {
      assert.equal((await call("/healthz")).status, 200);
      assert.equal((await call("/access/me")).status, 401);
      assert.equal((await call("/media")).status, 401);
      assert.equal((await call("/future-private-resource")).status, 401);
      const response = await call("/access/invites/validate", undefined, "POST", { token: "x".repeat(43) });
      assert.equal(response.status, 200, "invite validation is public but separately rate-limited");
      assert.equal(ValidateAccessInviteResponse.parse(await response.json()).valid, false);
    });

    await t.test("mismatched and unverified emails cannot bootstrap, including spoofed query fields", async () => {
      identities.set("mismatch", { email: "other@example.invalid", verified: true });
      identities.set("unverified", { email: "founder@example.invalid", verified: false });
      for (const user of ["mismatch", "unverified"]) {
        const response = await call("/access/me?email=founder@example.invalid&role=owner", user);
        assert.equal(response.status, 200);
        assert.equal((await snapshot(response)).membership, null);
        assert.equal(await stored(user), undefined);
        assert.equal((await call("/media", user)).status, 403);
      }
      assert.equal((await call("/future-private-resource", "mismatch")).status, 403);
    });

    await t.test("a newly created verified configured founder bootstraps without legacy membership", async () => {
      identities.set("founder", { email: "Founder@Example.Invalid", verified: true });
      assert.equal((await db.select().from(members).where(eq(members.userId, "founder"))).length, 0);
      const response = await call("/access/me", "founder");
      assert.equal(response.status, 200);
      assert.deepEqual((await snapshot(response)).membership, { role: "owner" });
      assert.equal((await stored("founder"))?.role, "owner");
      assert.equal((await call("/media", "founder")).status, 200);
      assert.equal((await call("/access/me", "founder")).status, 200, "owner access is idempotent");
    });

    await t.test("owner Library reads span uploaders while writes and adult acceptance remain restricted", async () => {
      await member("other", "other@example.invalid");
      const [own, other] = await db.insert(media).values(["founder", "other"].map((userId) => ({
        userId, title: `${userId} synthetic fixture`, originalName: "test.png",
        objectKey: `test/${userId}`, contentType: "image/png", mediaType: "image", size: 1,
      }))).returning();
      const response = await call("/media", "founder");
      const result = ListMediaResponse.parse(await response.json());
      assert.deepEqual(result.items.map((item: { id: string }) => item.id).sort(), [own.id, other.id].sort());
      const ordinary = ListMediaResponse.parse(await (await call("/media", "other")).json());
      assert.deepEqual(ordinary.items.map(item => item.id), [other.id]);
      assert.equal((await call(`/media/${other.id}/view-url`, "founder")).status, 403, "cross-uploader playback still requires adult acceptance");
      assert.equal((await call(`/media/${other.id}`, "founder", "PATCH", { title: "unauthorized" })).status, 404);
      const [unchanged] = await db.select().from(media).where(eq(media.id, other.id));
      assert.equal(unchanged.title, "other synthetic fixture");
      assert.equal((await call("/access/invites", "other", "POST", { email: "friend@example.invalid" })).status, 403);
    });

    await t.test("owner invitations accept only their verified addressee and work without legacy rows", async () => {
      const created = await call("/access/invites", "founder", "POST", { email: "invited@example.invalid" });
      assert.equal(created.status, 201);
      const invite = CreateAccessInviteResponse.parse(await created.json());
      const token = invite.invitePath.split("#")[1];
      assert.equal((await call("/access/invites/accept", "mismatch", "POST", { token })).status, 403);
      identities.set("invited", { email: "invited@example.invalid", verified: true });
      const accepted = await call("/access/invites/accept", "invited", "POST", { token });
      assert.equal(accepted.status, 200);
      assert.deepEqual((await snapshot(accepted)).membership, { role: "member" });
      assert.equal((await call("/media", "invited")).status, 200);
      // The older referral interface remains usable for admitted accounts.
      const referral = await issueInvitation("founder");
      await redeemInvitation("referral-only", referral.token);
      assert.equal((await call("/membership", "referral-only")).status, 200);
      assert.equal((await call("/media", "referral-only")).status, 403,
        "referral bookkeeping alone must not bypass the existing private-library admission policy");
    });

    await t.test("revocation overrides referral rows and signed-media authorization immediately", async () => {
      await db.insert(accounts).values(["founder", "invited"].map((userId) => ({ userId, acceptedAt: new Date() })));
      const [publicItem] = await db.insert(media).values({
        userId: "founder", title: "synthetic shared fixture", originalName: "public.png",
        objectKey: "test/public", contentType: "image/png", mediaType: "image", size: 1,
        visibility: "public", rightsConfirmedAt: new Date(),
      }).returning();
      assert.ok(await sharedStreamMedia(publicItem.id, "invited"));
      assert.equal((await call("/access/members/invited", "founder", "DELETE")).status, 204);
      assert.equal((await call("/media", "invited")).status, 403);
      assert.equal((await call("/membership/invitations", "invited")).status, 403);
      assert.equal((await membership(await call("/membership", "invited"))).member, false);
      await assert.rejects(sharedStreamMedia(publicItem.id, "invited"), { status: 404 });
      assert.equal((await stored("invited"))?.status, "revoked");
    });

    await t.test("moderator privileges require the separate explicit account configuration", async () => {
      assert.equal((await membership(await call("/membership", "founder"))).isOperator, false);
      process.env.SOCIAL_MODERATOR_USER_IDS = "founder";
      assert.equal((await membership(await call("/membership", "founder"))).isOperator, true);
      assert.equal((await call("/membership/referrals", "founder")).status, 200);
      assert.equal((await call("/membership/referrals", "other")).status, 403);
      delete process.env.SOCIAL_MODERATOR_USER_IDS;
    });

    await t.test("legacy registration survives but never grants private-library or owner access alone", async () => {
      await db.insert(members).values({ userId: "legacy-only", source: "legacy" });
      const response = await call("/membership", "legacy-only");
      assert.deepEqual(await response.json(), { member: true, isOperator: false });
      assert.equal((await call("/media", "legacy-only")).status, 403);
    });

    await t.test("existing different owner is a conflict, never an ownership transfer", async () => {
      process.env.APP_OWNER_EMAIL = "replacement@example.invalid";
      identities.set("replacement", { email: "replacement@example.invalid", verified: true });
      await member("replacement", "replacement@example.invalid");
      assert.equal((await call("/access/me", "replacement")).status, 409);
      assert.equal((await stored("founder"))?.role, "owner");
      assert.equal((await stored("replacement"))?.role, "member");
      process.env.APP_OWNER_EMAIL = "founder@example.invalid";
    });

    await t.test("an existing matching active member can be promoted after provider verification", async () => {
      await db.update(access).set({ role: "member" }).where(eq(access.userId, "founder"));
      const response = await call("/access/me", "founder");
      assert.equal(response.status, 200);
      assert.deepEqual((await snapshot(response)).membership, { role: "owner" });
    });

    await t.test("an unverified active member is not promoted; revoked configured owners stay revoked", async () => {
      await db.update(access).set({ role: "member" }).where(eq(access.userId, "founder"));
      identities.set("founder", { email: "founder@example.invalid", verified: false });
      assert.deepEqual((await snapshot(await call("/access/me", "founder"))).membership, { role: "member" });
      identities.set("founder", { email: "founder@example.invalid", verified: true });
      await db.update(access).set({ role: "owner", status: "revoked", revokedAt: new Date() }).where(eq(access.userId, "founder"));
      // Start a distinct scenario, without inheriting earlier promotion attempts.
      await pool.query("DELETE FROM social_rate_limits WHERE key LIKE 'access:owner-bootstrap:founder:%'");
      const response = await call("/access/me", "founder");
      assert.equal(response.status, 200);
      assert.equal((await snapshot(response)).membership, null);
      assert.equal((await call("/media", "founder")).status, 403);
      assert.equal((await stored("founder"))?.status, "revoked");
    });

    await t.test("same-email identity conflict fails closed without creating a second owner", async () => {
      await db.delete(access).where(eq(access.userId, "founder"));
      await member("email-holder", "founder@example.invalid");
      identities.set("second-identity", { email: "founder@example.invalid", verified: true });
      assert.equal((await call("/access/me", "second-identity")).status, 409);
      assert.equal(await stored("second-identity"), undefined);
      assert.equal((await stored("email-holder"))?.role, "member");
    });

    await t.test("same Clerk identity with a changed verified email retains ownership and data", async () => {
      await db.delete(access);
      await db.insert(access).values({ userId: "same-identity", email: "old@example.invalid", role: "owner" });
      identities.set("same-identity", { email: "founder@example.invalid", verified: true });
      const before = await db.select().from(media);
      const response = await call("/access/me", "same-identity");
      assert.equal(response.status, 200);
      assert.deepEqual((await snapshot(response)).membership, { role: "owner" });
      assert.equal((await stored("same-identity")).email, "founder@example.invalid");
      assert.equal((await db.select().from(access)).length, 1);
      assert.deepEqual(await db.select().from(media), before);
    });

    await t.test("owner transfer requires the exact server-configured source and provider verification", async () => {
      await db.delete(access);
      await db.insert(access).values({ userId: "legacy-owner", email: "legacy@example.invalid", role: "owner" });
      identities.set("recovery-target", { email: "founder@example.invalid", verified: false });
      process.env.APP_OWNER_TRANSFER_FROM_USER_ID = "legacy-owner";
      const unverified = await call("/access/me", "recovery-target");
      assert.equal((await snapshot(unverified)).membership, null);
      assert.equal((await stored("legacy-owner")).role, "owner");
      identities.set("recovery-target", { email: "founder@example.invalid", verified: true });
      process.env.APP_OWNER_TRANSFER_FROM_USER_ID = "wrong-owner";
      assert.equal((await call("/access/me?transferFrom=legacy-owner&email=founder@example.invalid", "recovery-target")).status, 409);
      assert.equal((await stored("legacy-owner")).role, "owner");
      assert.equal(await stored("recovery-target"), undefined);
      // A matching active email owned by a third identity cannot be stolen.
      process.env.APP_OWNER_TRANSFER_FROM_USER_ID = "legacy-owner";
      await member("third-email-holder", "founder@example.invalid");
      assert.equal((await call("/access/me", "recovery-target")).status, 409);
      assert.equal((await stored("legacy-owner")).role, "owner");
      delete process.env.APP_OWNER_TRANSFER_FROM_USER_ID;
    });

    await t.test("approved separate-identity transfer is atomic, idempotent and preserves media and legacy access", async () => {
      for (const existingMember of [false, true]) {
        await db.delete(access);
        await db.insert(access).values({ userId: "legacy-owner", email: "legacy@example.invalid", role: "owner" });
        if (existingMember) await member("recovery-target", "previous-target@example.invalid");
        process.env.APP_OWNER_TRANSFER_FROM_USER_ID = "legacy-owner";
        identities.set("recovery-target", { email: "founder@example.invalid", verified: true });
        const [item] = await db.insert(media).values({
          userId: "legacy-owner", title: "Legacy private fixture", originalName: "legacy.png",
          objectKey: `test/legacy-${existingMember}`, contentType: "image/png", mediaType: "image", size: 1,
        }).returning();
        const before = await db.select().from(media);
        const legacyBefore = await stored("legacy-owner");
        const responses = await Promise.all([call("/access/me", "recovery-target"), call("/access/me", "recovery-target")]);
        for (const response of responses) {
          assert.equal(response.status, 200);
          assert.deepEqual((await snapshot(response)).membership, { role: "owner" });
        }
        assert.deepEqual(await stored("legacy-owner"), { ...legacyBefore, role: "member" });
        assert.deepEqual((await db.select().from(access)).filter(row => row.role === "owner").map(row => row.userId), ["recovery-target"]);
        assert.deepEqual(await db.select().from(media), before, "no media, provenance or ownership changes");
        assert.equal((await call(`/media/${item.id}/view-url`, "recovery-target")).status, 403, "owner playback still requires adult acceptance");
        const globalList = ListMediaResponse.parse(await (await call("/media", "recovery-target")).json());
        assert.ok(globalList.items.some(row => row.id === item.id));
        const legacyList = ListMediaResponse.parse(await (await call("/media", "legacy-owner")).json());
        assert.ok(legacyList.items.some(row => row.id === item.id));
        assert.equal((await call("/access/invites", "legacy-owner", "POST", { email: "blocked@example.invalid" })).status, 403);
        assert.equal((await call("/access/me", "recovery-target")).status, 200, "repeat calls do not replay the transfer");
      }
      // A stale transfer authorization cannot replace the newly established owner.
      identities.set("unexpected-target", { email: "founder@example.invalid", verified: true });
      assert.equal((await call("/access/me", "unexpected-target")).status, 409);
      assert.equal((await stored("recovery-target")).role, "owner");
      delete process.env.APP_OWNER_TRANSFER_FROM_USER_ID;
    });

    await t.test("approved recovery never restores a revoked target or demotes the legacy owner", async () => {
      await db.delete(access);
      await db.insert(access).values({ userId: "legacy-owner", email: "legacy@example.invalid", role: "owner" });
      await member("revoked-target", "founder@example.invalid", "revoked");
      identities.set("revoked-target", { email: "founder@example.invalid", verified: true });
      process.env.APP_OWNER_TRANSFER_FROM_USER_ID = "legacy-owner";
      const response = await call("/access/me", "revoked-target");
      assert.equal(response.status, 200);
      assert.equal((await snapshot(response)).membership, null);
      assert.equal((await stored("legacy-owner")).role, "owner");
      assert.equal((await stored("revoked-target")).status, "revoked");
      delete process.env.APP_OWNER_TRANSFER_FROM_USER_ID;
    });

    await t.test("routine access checks fit the bootstrap budget; excess returns an explicit cooldown", async () => {
      const clock = mock.method(Date, "now", () => 1_800_000_000_000);
      try {
        for (let attempt = 0; attempt < 30; attempt++) {
          assert.equal((await call("/access/me", "rate-limited")).status, 200);
        }
        const response = await call("/access/me", "rate-limited");
        assert.equal(response.status, 429);
        assert.equal(response.headers.get("Retry-After"), "60");
        assert.deepEqual(await response.json(), {
          error: "Too many requests. Please wait before trying again.",
          code: "ACCESS_RATE_LIMITED", retryAfterSeconds: 60,
        });
      } finally {
        clock.mock.restore();
      }
      assert.equal(await stored("rate-limited"), undefined);
    });
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    stack.splice(stack.indexOf(fixtureLayer), 1);
    identityMock.mock.restore();
    if (oldOwner === undefined) delete process.env.APP_OWNER_EMAIL;
    else process.env.APP_OWNER_EMAIL = oldOwner;
    if (oldTransferFrom === undefined) delete process.env.APP_OWNER_TRANSFER_FROM_USER_ID;
    else process.env.APP_OWNER_TRANSFER_FROM_USER_ID = oldTransferFrom;
    if (oldModerators === undefined) delete process.env.SOCIAL_MODERATOR_USER_IDS;
    else process.env.SOCIAL_MODERATOR_USER_IDS = oldModerators;
    logger.level = oldLevel;
    await mediaAuthorizationPool.end();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});
