import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  mediaItemsTable,
  pool,
  socialEventsTable,
  watchFeedSessionsTable,
  watchSettingsTable,
  watchSignalsTable,
} from "@workspace/db";
import watchRouter from "../routes/watch";

test("Watch feed, settings, reactions, summaries, and history stay account-scoped", async (t) => {
  const prefix = `watch-isolation-${randomUUID()}`;
  const owner = `${prefix}-owner`;
  const other = `${prefix}-other`;

  const app = express();
  app.use(express.json());
  // The fixture supplies authenticated Clerk identities without weakening production middleware.
  app.use((req, _res, next) => {
    const identity = req.get("x-test-user") ?? null;
    Object.assign(req, {
      auth: Object.assign(
        () => ({ userId: identity, tokenType: "session_token" }),
        { [Symbol.for("@clerk/express.auth")]: true },
      ),
    });
    next();
  });
  app.use(watchRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (userId: string | null, path: string, method = "GET", body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { ...(userId ? { "x-test-user": userId } : {}), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async (response: Response) => await response.json() as Record<string, any>;
  const media = await db.insert(mediaItemsTable).values([
    {
      userId: owner, title: "Owner private video", originalName: "owner.mp4",
      objectKey: `test-fixtures/${prefix}/owner.mp4`, contentType: "video/mp4",
      mediaType: "video", size: 1,
    },
    {
      userId: other, title: "Other private video", originalName: "other.mp4",
      objectKey: `test-fixtures/${prefix}/other.mp4`, contentType: "video/mp4",
      mediaType: "video", size: 1,
    },
    {
      userId: other, title: "Other untouched video", originalName: "untouched.mp4",
      objectKey: `test-fixtures/${prefix}/untouched.mp4`, contentType: "video/mp4",
      mediaType: "video", size: 1,
    },
  ]).returning();
  const [ownerItem, otherItem, untouchedItem] = media;
  const ownerSocialEvent = randomUUID();
  const otherSocialEvent = randomUUID();
  await db.insert(socialEventsTable).values([
    { eventId: ownerSocialEvent, userId: owner, mediaId: ownerItem!.id, kind: "progress", seconds: 30 },
    { eventId: otherSocialEvent, userId: other, mediaId: otherItem!.id, kind: "progress", seconds: 20 },
  ]);
  const ownerSession = randomUUID();
  const otherSession = randomUUID();
  const eventsPath = (id: string) => `/watch/media/${id}/event`;
  const reactionPath = (id: string) => `/watch/media/${id}/reaction`;

  try {
    await t.test("settings are private and each account can change its own behavior", async () => {
      assert.equal((await request(owner, "/watch/settings")).status, 200);
      assert.deepEqual(await json(await request(owner, "/watch/settings")), { behaviorEnabled: true, autoplayEnabled: null, dataSaverEnabled: false, alwaysVisibleControls: false });
      assert.deepEqual(await json(await request(owner, "/watch/settings", "PATCH", { behaviorEnabled: false })), { behaviorEnabled: false, autoplayEnabled: null, dataSaverEnabled: false, alwaysVisibleControls: false });
      assert.deepEqual(await json(await request(owner, "/watch/settings", "PATCH", { autoplayEnabled: false })), { behaviorEnabled: false, autoplayEnabled: false, dataSaverEnabled: false, alwaysVisibleControls: false });
      assert.deepEqual(await json(await request(owner, "/watch/settings", "PATCH", { dataSaverEnabled: true })), { behaviorEnabled: false, autoplayEnabled: false, dataSaverEnabled: true, alwaysVisibleControls: false });
      assert.deepEqual(await json(await request(owner, "/watch/settings", "PATCH", { alwaysVisibleControls: true })), { behaviorEnabled: false, autoplayEnabled: false, dataSaverEnabled: true, alwaysVisibleControls: true });
      // A separate GET (as on reload) reads the persisted preference, not mutation state.
      assert.deepEqual(await json(await request(owner, "/watch/settings")), { behaviorEnabled: false, autoplayEnabled: false, dataSaverEnabled: true, alwaysVisibleControls: true });
      const [stored] = await db.select().from(watchSettingsTable).where(eq(watchSettingsTable.userId, owner));
      assert.equal(stored?.alwaysVisibleControls, true);
      assert.equal((await request(owner, "/watch/settings", "PATCH", { alwaysVisibleControls: "true" })).status, 400);
      assert.equal((await request(owner, "/watch/settings", "PATCH", {})).status, 400);
      assert.deepEqual(await json(await request(other, "/watch/settings")), { behaviorEnabled: true, autoplayEnabled: null, dataSaverEnabled: false, alwaysVisibleControls: false });
      assert.deepEqual(await json(await request(other, "/watch/settings", "PATCH", { behaviorEnabled: false })), { behaviorEnabled: false, autoplayEnabled: null, dataSaverEnabled: false, alwaysVisibleControls: false });
      assert.deepEqual(await json(await request(owner, "/watch/settings", "PATCH", { alwaysVisibleControls: false })), { behaviorEnabled: false, autoplayEnabled: false, dataSaverEnabled: true, alwaysVisibleControls: false });
      assert.deepEqual(await json(await request(owner, "/watch/settings")), { behaviorEnabled: false, autoplayEnabled: false, dataSaverEnabled: true, alwaysVisibleControls: false });
    });

    await t.test("feed sessions only return the signed-in account's media", async () => {
      const ownerFeed = await json(await request(owner, `/watch/feed?sessionId=${ownerSession}`));
      assert.deepEqual(ownerFeed.items.map((item: any) => item.id), [ownerItem!.id]);
      assert.equal(ownerFeed.items[0].title, "Owner private video");

      const otherFeed = await json(await request(other, `/watch/feed?sessionId=${otherSession}`));
      assert.deepEqual(new Set(otherFeed.items.map((item: any) => item.id)), new Set([otherItem!.id, untouchedItem!.id]));
      assert.ok(!JSON.stringify(otherFeed).includes("Owner private video"));

      const stolenSession = await request(other, `/watch/feed?sessionId=${ownerSession}`);
      assert.equal(stolenSession.status, 409);
      assert.ok(!JSON.stringify(await json(stolenSession)).includes(ownerItem!.id));
      assert.equal(
        (await db.select().from(watchFeedSessionsTable).where(eq(watchFeedSessionsTable.sessionId, ownerSession)))[0]?.userId,
        owner,
      );
    });

    await t.test("simultaneous claims cannot expose a feed session to a second account", async () => {
      const sharedSession = randomUUID();
      const [ownerResponse, otherResponse] = await Promise.all([
        request(owner, `/watch/feed?sessionId=${sharedSession}`),
        request(other, `/watch/feed?sessionId=${sharedSession}`),
      ]);
      assert.deepEqual([ownerResponse.status, otherResponse.status].sort(), [200, 409]);
      const winningResponse = ownerResponse.status === 200 ? ownerResponse : otherResponse;
      const winningUser = ownerResponse.status === 200 ? owner : other;
      const feed = await json(winningResponse);
      const allowedIds = winningUser === owner ? [ownerItem!.id] : [otherItem!.id, untouchedItem!.id];
      assert.ok(feed.items.every((item: any) => allowedIds.includes(item.id)));
      assert.ok(!JSON.stringify(feed).includes(winningUser === owner ? "Other private video" : "Owner private video"));
    });

    await t.test("reactions and viewing summaries require ownership and remain separate", async () => {
      await request(owner, "/watch/settings", "PATCH", { behaviorEnabled: true });
      await request(other, "/watch/settings", "PATCH", { behaviorEnabled: true });
      assert.equal((await request(owner, reactionPath(otherItem!.id), "PATCH", { reaction: "like" })).status, 404);
      assert.equal((await request(owner, reactionPath(otherItem!.id))).status, 404);

      assert.deepEqual(
        await json(await request(owner, reactionPath(ownerItem!.id), "PATCH", { reaction: "like" })),
        { mediaId: ownerItem!.id, reaction: "like", likeCount: 1 },
      );
      assert.deepEqual(
        await json(await request(other, reactionPath(otherItem!.id), "PATCH", { reaction: "dislike" })),
        { mediaId: otherItem!.id, reaction: "dislike", likeCount: 0 },
      );
      assert.deepEqual(
        await json(await request(owner, eventsPath(ownerItem!.id), "POST", { event: "progress", watchedSeconds: 30 })),
        { mediaId: ownerItem!.id, reaction: "like", watchedSeconds: 30, completions: 0, replays: 0, quickSkips: 0 },
      );
      assert.equal((await request(owner, eventsPath(otherItem!.id), "POST", { event: "progress", watchedSeconds: 20 })).status, 404);
      assert.deepEqual(
        await json(await request(other, eventsPath(otherItem!.id), "POST", { event: "progress", watchedSeconds: 20 })),
        { mediaId: otherItem!.id, reaction: "dislike", watchedSeconds: 20, completions: 0, replays: 0, quickSkips: 0 },
      );
      assert.deepEqual(
        (await db.select({ userId: watchSignalsTable.userId, mediaId: watchSignalsTable.mediaId })
          .from(watchSignalsTable)
          .where(inArray(watchSignalsTable.mediaId, [ownerItem!.id, otherItem!.id]))).sort((a, b) => a.userId.localeCompare(b.userId)),
        [
          { userId: other, mediaId: otherItem!.id },
          { userId: owner, mediaId: ownerItem!.id },
        ],
      );
    });

    await t.test("clearing inferred history preserves explicit reactions and leaves the other account intact", async () => {
      const response = await request(owner, "/watch/history", "DELETE");
      assert.equal(response.status, 204);
      const [ownerSignal] = await db.select().from(watchSignalsTable).where(
        and(eq(watchSignalsTable.userId, owner), eq(watchSignalsTable.mediaId, ownerItem!.id)),
      );
      assert.equal(ownerSignal?.reaction, "like");
      assert.equal(ownerSignal?.watchedSeconds, 0);
      assert.equal(ownerSignal?.completions, 0);
      assert.equal(ownerSignal?.replays, 0);
      assert.equal(ownerSignal?.quickSkips, 0);
      assert.equal(
        (await db.select().from(socialEventsTable).where(eq(socialEventsTable.eventId, ownerSocialEvent))).length,
        0,
      );

      const [otherSignal] = await db.select().from(watchSignalsTable).where(
        and(eq(watchSignalsTable.userId, other), eq(watchSignalsTable.mediaId, otherItem!.id)),
      );
      assert.equal(otherSignal?.reaction, "dislike");
      assert.equal(otherSignal?.watchedSeconds, 20);
      assert.equal(
        (await db.select().from(socialEventsTable).where(eq(socialEventsTable.eventId, otherSocialEvent))).length,
        1,
      );
      assert.deepEqual(
        await json(await request(owner, eventsPath(ownerItem!.id), "POST", { event: "progress", watchedSeconds: 1 })),
        { mediaId: ownerItem!.id, reaction: "like", watchedSeconds: 1, completions: 0, replays: 0, quickSkips: 0 },
      );
      assert.deepEqual(
        await json(await request(other, eventsPath(otherItem!.id), "POST", { event: "progress", watchedSeconds: 1 })),
        { mediaId: otherItem!.id, reaction: "dislike", watchedSeconds: 21, completions: 0, replays: 0, quickSkips: 0 },
      );
    });

    await t.test("disabled behavior does not create or increment inferred history", async () => {
      await request(other, "/watch/settings", "PATCH", { behaviorEnabled: false });
      for (const [id, event, watchedSeconds] of [
        [untouchedItem!.id, "progress", 45],
        [otherItem!.id, "complete", 0],
        [otherItem!.id, "replay", 0],
        [otherItem!.id, "quick-skip", 0],
      ] as const) {
        const response = await request(other, eventsPath(id), "POST", { event, watchedSeconds });
        assert.equal(response.status, 200);
      }
      const [untouchedSignal] = await db.select().from(watchSignalsTable).where(
        and(eq(watchSignalsTable.userId, other), eq(watchSignalsTable.mediaId, untouchedItem!.id)),
      );
      assert.equal(untouchedSignal, undefined);
      const [otherSignal] = await db.select().from(watchSignalsTable).where(
        and(eq(watchSignalsTable.userId, other), eq(watchSignalsTable.mediaId, otherItem!.id)),
      );
      assert.equal(otherSignal?.reaction, "dislike");
      assert.equal(otherSignal?.watchedSeconds, 21);
      assert.equal(otherSignal?.completions, 0);
      assert.equal(otherSignal?.replays, 0);
      assert.equal(otherSignal?.quickSkips, 0);
    });

    await t.test("Watch routes require authentication", async () => {
      assert.equal((await request(null, "/watch/settings")).status, 401);
      assert.equal((await request(null, `/watch/feed?sessionId=${randomUUID()}`)).status, 401);
      assert.equal((await request(null, reactionPath(ownerItem!.id), "PATCH", { reaction: "like" })).status, 401);
      assert.equal((await request(null, eventsPath(ownerItem!.id), "POST", { event: "progress", watchedSeconds: 1 })).status, 401);
    });
  } finally {
    await db.delete(watchSignalsTable).where(inArray(watchSignalsTable.userId, [owner, other]));
    await db.delete(watchSettingsTable).where(inArray(watchSettingsTable.userId, [owner, other]));
    await db.delete(watchFeedSessionsTable).where(inArray(watchFeedSessionsTable.userId, [owner, other]));
    await db.delete(mediaItemsTable).where(inArray(mediaItemsTable.userId, [owner, other]));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await pool.end();
  }
});
