import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool, mediaItemsTable as media, profilesTable as profiles,
  socialAccountsTable as accounts, blocksTable as blocks, creatorFollowsTable as follows,
  videoReviewsTable as reviews, watchFeedSessionsTable as sessions, watchSettingsTable as settings } from "@workspace/db";
import { collaborativeData, socialFeed } from "./social-feed";

test("ratings and follows personalize the next stable Watch cycle, never other viewers or access", async (t) => {
  const prefix = `discovery-${randomUUID()}`;
  const [viewer, other, creator, second, blocked] = ["viewer", "other", "creator", "second", "blocked"].map((v) => `${prefix}-${v}`);
  const users = [viewer, other, creator, second, blocked];
  const hashtag = `discovery-${randomUUID()}`;
  const cycle = randomUUID(), stamp = new Date();
  const ids: string[] = [];
  // Rebuilding with the SAME seed isolates feedback effects from randomization.
  const read = async () => {
    const page = await socialFeed(viewer, cycle, "for-you", "all", 0, hashtag);
    const [stored] = await db.select().from(sessions).where(eq(sessions.sessionId, cycle));
    return { page, order: stored.mediaIds };
  };
  const rebuild = async () => {
    await db.delete(sessions).where(eq(sessions.sessionId, cycle));
    return read();
  };
  try {
    await db.insert(accounts).values(users.map((userId) => ({ userId, acceptedAt: stamp, collaborativeConsent: false })));
    const [profile] = await db.insert(profiles).values({ userId: creator,
      handle: `d${randomUUID().replaceAll("-", "")}`, displayName: "Synthetic creator" }).returning();
    await db.insert(settings).values({ userId: viewer, behaviorEnabled: false });
    const fixtures = await db.insert(media).values(Array.from({ length: 42 }, (_, i) => ({
      userId: i === 40 ? viewer : i === 41 ? blocked : i % 2 ? creator : second,
      title: "Synthetic discovery fixture", originalName: "fixture.mp4", objectKey: `${prefix}/${i}`,
      contentType: "video/mp4", mediaType: "video", size: 1, durationSeconds: i % 3 ? 30 : 600,
      tags: [hashtag, i % 2 ? "synthetic-drawing" : "synthetic-coast"],
      attribution: i < 8 ? "anonymous" : "profile", visibility: i >= 38 && i <= 40 ? "private" : "public",
      rightsConfirmedAt: stamp, createdAt: stamp, publishedAt: stamp,
    }))).returning();
    ids.push(...fixtures.map((f) => f.id));
    await db.insert(blocks).values({ userId: blocked, blockedUserId: viewer });
    const baseline = await read();
    const collabBefore = await collaborativeData(other);
    await t.test("other people's and inaccessible ratings do not affect ranking; follows unlock nothing", async () => {
      await db.insert(reviews).values([
        { userId: other, mediaId: fixtures[9].id, rating: 5, text: "PRIVATE OTHER REVIEW", publicContext: true },
        { userId: viewer, mediaId: fixtures[38].id, rating: 1, text: "now-private", publicContext: true },
        { userId: viewer, mediaId: fixtures[41].id, rating: 5, text: "now-blocked", publicContext: true },
      ]);
      assert.deepEqual((await rebuild()).order, baseline.order);
      for (const f of fixtures.slice(38)) assert.ok(!baseline.order.includes(f.id));
    });
    await t.test("follow and private-context own rating change fixed-seed next-cycle ranking, not the active cycle", async () => {
      // Own private history is permitted; no watch signal is required.
      await db.insert(reviews).values({ userId: viewer, mediaId: fixtures[40].id, rating: 5,
        text: "PRIVATE OWN REVIEW MUST NOT LEAK", publicContext: false });
      await db.insert(follows).values({ userId: viewer, profileId: profile.id });
      assert.deepEqual((await read()).order, baseline.order);
      const nextPage = await socialFeed(viewer, cycle, "for-you", "all", 24, hashtag);
      assert.deepEqual(nextPage.items.map((p) => p.id), baseline.order.slice(24, 48));
      const next = await rebuild();
      assert.notDeepEqual(next.order, baseline.order);
      assert.deepEqual((await rebuild()).order, next.order);
      assert.deepEqual(new Set(next.order), new Set(baseline.order));
      const payload = JSON.stringify(next.page);
      for (const value of ["PRIVATE OWN REVIEW", "PRIVATE OTHER REVIEW", viewer, creator, "rating", "followedCreators"])
        assert.ok(!payload.includes(value), value);
      assert.deepEqual(await collaborativeData(other), collabBefore, "reviews/follows are not shared training signals");
      await db.update(reviews).set({ rating: 1 }).where(eq(reviews.mediaId, fixtures[40].id));
      await db.delete(follows).where(eq(follows.userId, viewer));
      assert.deepEqual((await read()).order, next.order);
      const low = await rebuild();
      assert.notDeepEqual(low.order, next.order);
      await db.delete(reviews).where(eq(reviews.mediaId, fixtures[40].id));
      assert.deepEqual((await read()).order, low.order);
      assert.deepEqual((await rebuild()).order, baseline.order);
    });
    await t.test("anonymous uploads never match follows; privacy and blocks still revoke mid-cycle", async () => {
      await db.update(media).set({ attribution: "anonymous" }).where(inArray(media.id, ids));
      const anonymous = await rebuild();
      await db.insert(follows).values({ userId: viewer, profileId: profile.id });
      assert.deepEqual((await rebuild()).order, anonymous.order);
      const revoked = anonymous.order[0];
      await db.update(media).set({ visibility: "private" }).where(eq(media.id, revoked));
      const current = await read();
      assert.deepEqual(current.order, anonymous.order);
      assert.ok(!current.page.items.some((p) => p.id === revoked));
      await db.insert(blocks).values({ userId: viewer, blockedUserId: creator });
      const blockedPage = await read();
      const creatorIds = new Set(fixtures.filter((f) => f.userId === creator).map((f) => f.id));
      assert.ok(blockedPage.page.items.every((p) => !creatorIds.has(p.id)));
    });
  } finally {
    await db.delete(media).where(inArray(media.id, ids));
    await db.delete(follows).where(inArray(follows.userId, users));
    await db.delete(profiles).where(inArray(profiles.userId, users));
    await db.delete(blocks).where(inArray(blocks.userId, users));
    await db.delete(sessions).where(inArray(sessions.userId, users));
    await db.delete(settings).where(inArray(settings.userId, users));
    await db.delete(accounts).where(inArray(accounts.userId, users));
    await pool.end();
  }
});
