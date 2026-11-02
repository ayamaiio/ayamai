import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, mediaItemsTable as media, profilesTable as profiles,
  socialAccountsTable as accounts, accessMembershipsTable as access, blocksTable as blocks, creatorFollowsTable as follows,
  videoReviewsTable as reviews, socialRateLimitsTable as limits,
  savedPostsTable as saves, watchFeedSessionsTable as sessions } from "@workspace/db";
import videosRouter from "../routes/videos";
import followsRouter from "../routes/creator-follows";
import { socialFeed } from "./social-feed";
import { GetVideoCollectionResponse, GetVideoReviewsResponse, GetCreatorFollowResponse,
  GetFollowedCreatorsResponse, SetVideoReviewResponse } from "@workspace/api-zod";

test("creator follows, video collection and follower-gated reviews preserve access and saved edits", async (t) => {
  const prefix = `creator-video-test-${randomUUID()}`;
  const [owner, writer, follower, outsider, ungated] = ["owner", "writer", "follower", "outsider", "ungated"].map((v) => `${prefix}-${v}`);
  const users = [owner, writer, follower, outsider, ungated];
  const ids: string[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId, tokenType: "session_token" }),
      { [Symbol.for("@clerk/express.auth")]: true }) }); next();
  });
  app.use("/api", videosRouter, followsRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const request = (uid: string | null, path: string, method = "GET", body?: unknown) => fetch(base + path, {
    method, headers: { ...(uid ? { "x-test-user": uid } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    await db.insert(accounts).values(users.map((userId) => ({ userId, acceptedAt: userId === ungated ? null : new Date() })));
    const [profile, writerProfile] = await db.insert(profiles).values([owner, writer].map((userId, i) => ({
      userId, handle: `test_${randomUUID().replaceAll("-", "").slice(0, 16)}`, displayName: `Synthetic ${i}`,
    }))).returning();
    const fixtures = Array.from({ length: 27 }, (_, i) => ({
      id: randomUUID(), userId: owner, title: `Synthetic video ${i}`, originalName: "synthetic.mp4",
      objectKey: `${prefix}/${i}`, contentType: "video/mp4", mediaType: "video", size: 1,
      durationSeconds: i === 26 ? null : (i + 1) * 60, visibility: "public", attribution: "profile",
      rightsConfirmedAt: new Date(),
    }));
    ids.push(...fixtures.map((f) => f.id));
    await db.insert(media).values(fixtures);
    const id = fixtures[0].id, privateId = fixtures[1].id, anonymousId = fixtures[2].id;
    const reviewPath = `/social/posts/${id}/reviews`, followPath = `/social/profiles/${profile.id}/follow`;
    const initial = { rating: 4, text: "Synthetic review", expectedRevision: 0, expectedReviewId: null };
    let saved: { id: string; revision: number; rating: number; text: string };
    await t.test("auth, age gate, self-follow prevention and idempotent follow", async () => {
      assert.equal((await request(null, followPath)).status, 401);
      assert.equal((await request(ungated, followPath)).status, 403);
      assert.equal((await request(owner, followPath, "PUT", { following: true })).status, 400);
      for (let i = 0; i < 2; i++) {
        const r = await request(follower, followPath, "PUT", { following: true });
        assert.equal(r.status, 200);
        const body = GetCreatorFollowResponse.parse(await r.json());
        assert.equal(body.following, true); assert.equal(body.followerCount, 1);
      }
      const list = GetFollowedCreatorsResponse.parse(await (await request(follower, "/social/following")).json());
      assert.equal(list.items[0].id, profile.id);
      assert.equal(JSON.stringify(list).includes(owner), false);
    });
    await t.test("only poster's followers (not reviewer's followers) can read other reviews", async () => {
      const created = await request(writer, reviewPath, "PUT", initial);
      assert.equal(created.status, 200); saved = SetVideoReviewResponse.parse(await created.json());
      assert.equal((await request(writer, reviewPath, "PUT", initial)).status, 200, "exact retry");
      assert.equal((await db.select().from(reviews).where(eq(reviews.mediaId, id))).length, 1);
      await request(outsider, `/social/profiles/${writerProfile.id}/follow`, "PUT", { following: true });
      for (const uid of [writer, outsider]) {
        const r = GetVideoReviewsResponse.parse(await (await request(uid, reviewPath)).json());
        assert.equal(r.canReadOthers, false); assert.equal(r.items.length, 0);
        assert.equal(r.count, 0); assert.equal(r.averageRating, null);
        assert.equal(r.ownReview?.text ?? null, uid === writer ? initial.text : null);
      }
      for (const uid of [follower, owner]) {
        const r = GetVideoReviewsResponse.parse(await (await request(uid, reviewPath)).json());
        assert.equal(r.canReadOthers, true); assert.equal(r.items[0].text, initial.text);
        assert.equal(r.count, 1); assert.equal(r.averageRating, 4);
        assert.equal(JSON.stringify(r).includes(writer), false);
      }
      await request(follower, followPath, "PUT", { following: false });
      const revoked = GetVideoReviewsResponse.parse(await (await request(follower, reviewPath)).json());
      assert.equal(revoked.canReadOthers, false); assert.deepEqual(revoked.items, []);
      await request(follower, followPath, "PUT", { following: true });
    });
    await t.test("conflicting updates/deletes cannot overwrite another session; recreate is protected", async () => {
      const results = await Promise.all([2, 5].map((rating) => request(writer, reviewPath, "PUT",
        { ...initial, rating, expectedRevision: saved.revision, expectedReviewId: saved.id })));
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      saved = SetVideoReviewResponse.parse(await results.find((r) => r.status === 200)!.json());
      assert.equal((await request(writer, reviewPath + `?expectedRevision=1&reviewId=${saved.id}`, "DELETE")).status, 409);
      assert.equal((await request(writer, reviewPath, "PUT", { ...initial, rating: 6 })).status, 400);
      assert.equal((await request(writer, reviewPath + `?expectedRevision=${saved.revision}&reviewId=${saved.id}`, "DELETE")).status, 204);
      const recreated = await request(writer, reviewPath, "PUT", initial);
      assert.equal(recreated.status, 200);
      const fresh = SetVideoReviewResponse.parse(await recreated.json());
      assert.notEqual(fresh.id, saved.id);
      assert.equal((await request(writer, reviewPath, "PUT", {
        ...initial, expectedRevision: 1, expectedReviewId: saved.id,
      })).status, 409);
    });
    await t.test("private and anonymous context never becomes follower-shared through publication", async () => {
      await db.update(media).set({ visibility: "private" }).where(eq(media.id, privateId));
      assert.equal((await request(follower, `/social/posts/${privateId}/reviews`)).status, 404);
      assert.equal((await request(follower, `/social/posts/${privateId}/reviews`, "PUT", initial)).status, 404);
      await request(owner, `/social/posts/${privateId}/reviews`, "PUT", initial);
      await db.update(media).set({ visibility: "public" }).where(eq(media.id, privateId));
      const r = GetVideoReviewsResponse.parse(await (await request(follower, `/social/posts/${privateId}/reviews`)).json());
      assert.deepEqual(r.items, []); assert.equal(r.count, 0);
      await db.update(media).set({ attribution: "anonymous" }).where(eq(media.id, anonymousId));
      await request(writer, `/social/posts/${anonymousId}/reviews`, "PUT", initial);
      const anonymous = GetVideoReviewsResponse.parse(await (await request(follower, `/social/posts/${anonymousId}/reviews`)).json());
      assert.equal(anonymous.canReadOthers, false); assert.deepEqual(anonymous.items, []);
      await db.update(media).set({ attribution: "profile" }).where(eq(media.id, anonymousId));
      const namedLater = GetVideoReviewsResponse.parse(await (await request(follower, `/social/posts/${anonymousId}/reviews`)).json());
      assert.deepEqual(namedLater.items, []);
    });
    await t.test("longest-first keyset pages include unknown duration without duplicates; saves stay private", async () => {
      const first = GetVideoCollectionResponse.parse(await (await request(owner, "/social/videos?source=mine")).json());
      assert.equal(first.items.length, 24); assert.equal(first.hasMore, true);
      const second = GetVideoCollectionResponse.parse(await (await request(owner, `/social/videos?source=mine&cursor=${first.nextCursor}`)).json());
      assert.equal(second.hasMore, false);
      const all = [...first.items, ...second.items];
      assert.equal(all.length, 27); assert.equal(new Set(all.map((p) => p.id)).size, 27);
      assert.equal(all.at(-1)!.durationSeconds, null);
      assert.equal((await request(owner, `/social/videos?source=saved&cursor=${first.nextCursor}`)).status, 400);
      await db.insert(saves).values({ userId: follower, mediaId: id });
      const ownSaved = GetVideoCollectionResponse.parse(await (await request(follower, "/social/videos?source=saved")).json());
      assert.equal(ownSaved.items.length, 1);
      assert.deepEqual(GetVideoCollectionResponse.parse(await (await request(outsider, "/social/videos?source=saved")).json()).items, []);
      await db.update(media).set({ visibility: "private" }).where(eq(media.id, id));
      assert.deepEqual(GetVideoCollectionResponse.parse(await (await request(follower, "/social/videos?source=saved")).json()).items, []);
      assert.equal((await request(follower, reviewPath)).status, 404);
      await db.update(media).set({ visibility: "public" }).where(eq(media.id, id));
    });
    await t.test("all videos discovers other uploaders, GOD sees private, and revocation applies", async () => {
      const readAll = async (uid: string) => {
        const items: Array<{ id: string }> = [];
        let cursor: string | null = null;
        do {
          const response = await request(uid, `/social/videos${cursor ? `?cursor=${cursor}` : ""}`);
          assert.equal(response.status, 200);
          const page = GetVideoCollectionResponse.parse(await response.json());
          items.push(...page.items); cursor = page.nextCursor;
        } while (cursor);
        return items.map((item) => item.id);
      };
      assert.equal((await request(null, "/social/videos")).status, 401);
      assert.equal((await request(ungated, "/social/videos")).status, 403);
      await db.update(media).set({ visibility: "private" }).where(eq(media.id, privateId));
      const ordinary = await readAll(outsider);
      assert.ok(ordinary.includes(id)); assert.ok(!ordinary.includes(privateId));
      assert.equal(new Set(ordinary).size, ordinary.length);
      const mine = GetVideoCollectionResponse.parse(await (await request(outsider, "/social/videos?source=mine")).json());
      assert.deepEqual(mine.items, []);
      await db.insert(access).values({ userId: outsider, email: "video-test@example.invalid", role: "owner", status: "active" });
      assert.ok((await readAll(outsider)).includes(privateId));
      await db.update(media).set({ moderationState: "removed" }).where(eq(media.id, privateId));
      assert.ok(!(await readAll(outsider)).includes(privateId));
      await db.update(media).set({ moderationState: "active" }).where(eq(media.id, privateId));
      await db.update(access).set({ status: "revoked" }).where(eq(access.userId, outsider));
      assert.ok(!(await readAll(outsider)).includes(privateId));
      await db.delete(access).where(eq(access.userId, outsider));
      await db.update(media).set({ visibility: "public" }).where(eq(media.id, privateId));
      await db.insert(blocks).values({ userId: owner, blockedUserId: outsider });
      assert.ok(!(await readAll(outsider)).includes(id));
      await db.delete(blocks).where(eq(blocks.userId, owner));
    });
    await t.test("length preference is bound to a stable cycle and blocked creators revoke access", async () => {
      const cycle = randomUUID();
      const first = await socialFeed(follower, cycle, "for-you", "video", 0, "", "long");
      assert.deepEqual(first.items.map((p) => p.id),
        (await socialFeed(follower, cycle, "for-you", "video", 0, "", "long")).items.map((p) => p.id));
      await assert.rejects(socialFeed(follower, cycle, "for-you", "video", 0, "", "short"), /new feed session/);
      await db.insert(blocks).values({ userId: owner, blockedUserId: follower });
      assert.equal((await request(follower, followPath)).status, 404);
      assert.equal((await request(follower, reviewPath)).status, 404);
      assert.deepEqual(GetFollowedCreatorsResponse.parse(await (await request(follower, "/social/following")).json()).items, []);
    });
  } finally {
    await db.delete(media).where(inArray(media.id, ids));
    await db.delete(follows).where(inArray(follows.userId, users));
    await db.delete(profiles).where(inArray(profiles.userId, users));
    await db.delete(blocks).where(inArray(blocks.userId, users));
    await db.delete(sessions).where(inArray(sessions.userId, users));
    await db.delete(limits).where(like(limits.key, `${prefix}%`));
    await db.delete(access).where(inArray(access.userId, users));
    await db.delete(accounts).where(inArray(accounts.userId, users));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
});
