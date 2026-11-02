import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, mediaItemsTable as media, socialAccountsTable as accounts,
  savedPostsTable, blocksTable, socialRateLimitsTable } from "@workspace/db";
import router from "../routes/playback-bookmarks";

test("private playback bookmarks survive fresh requests and recheck access", async () => {
  const prefix = `bookmark-test-${randomUUID()}`;
  const owner = `${prefix}-owner`, viewer = `${prefix}-viewer`, other = `${prefix}-other`;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId, tokenType: "session_token" }),
      { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  app.use(router);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (uid: string | null, id: string, seconds?: unknown, expected = uid) =>
    fetch(`${base}/media/${id}/playback-bookmark/${expected ?? "anonymous"}`, {
      method: seconds === undefined ? "GET" : "PUT",
      headers: { "Content-Type": "application/json", ...(uid ? { "x-test-user": uid } : {}) },
      ...(seconds === undefined ? {} : { body: JSON.stringify({ seconds }) }),
    });
  const read = async (uid: string, id: string) => {
    const res = await request(uid, id);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    return res.json();
  };
  try {
    await db.insert(accounts).values([owner, viewer, other].map(userId => ({ userId, acceptedAt: new Date() })));
    const [own, shared] = await db.insert(media).values([
      { userId: owner, title: "Private fixture", originalName: "fixture.mp4", objectKey: `${prefix}/own`,
        size: 1, mediaType: "video", contentType: "video/mp4", progressSeconds: 42, durationSeconds: 120 },
      { userId: owner, title: "Shared fixture", originalName: "fixture.mp4", objectKey: `${prefix}/shared`,
        size: 1, mediaType: "video", contentType: "video/mp4", progressSeconds: 65, durationSeconds: 120,
        visibility: "public", rightsConfirmedAt: new Date() },
    ]).returning();
    await db.insert(savedPostsTable).values({ userId: viewer, mediaId: shared.id });
    assert.equal((await request(null, shared.id)).status, 401);
    assert.deepEqual(await read(owner, own.id), { seconds: 42 }, "fresh owner read imports legacy progress");
    assert.deepEqual(await read(viewer, shared.id), { seconds: null }, "owner history is never a viewer fallback");
    assert.equal((await request(viewer, own.id)).status, 404);
    assert.equal((await request(owner, own.id, 73)).status, 200);
    assert.equal((await request(viewer, shared.id, 31)).status, 200);
    assert.deepEqual(await read(owner, own.id), { seconds: 73 });
    assert.deepEqual(await read(viewer, shared.id), { seconds: 31 }, "fresh device does not need Library cache");
    assert.deepEqual(await read(other, shared.id), { seconds: null });
    assert.deepEqual(await read(owner, shared.id), { seconds: 65 });
    assert.equal((await request(other, shared.id, 90, viewer)).status, 403, "stale account request cannot write as new viewer");
    assert.equal((await request(other, shared.id, undefined, viewer)).status, 403);
    assert.deepEqual(await read(viewer, shared.id), { seconds: 31 });
    for (const seconds of [-1, "10", null, 31536001]) assert.equal((await request(viewer, shared.id, seconds)).status, 400);
    assert.equal((await request(viewer, shared.id, 500)).status, 200);
    assert.deepEqual(await read(viewer, shared.id), { seconds: 120 }, "server clamps known duration");
    await request(viewer, shared.id, 0);
    assert.deepEqual(await read(viewer, shared.id), { seconds: 0 }, "completed videos reopen at the start");
    await request(viewer, shared.id, 12);
    assert.deepEqual(await read(viewer, shared.id), { seconds: 12 }, "replay records new progress");
    const [unchanged] = await db.select().from(media).where(eq(media.id, shared.id));
    assert.equal(unchanged.progressSeconds, 65, "viewer bookmarks do not overwrite legacy owner metadata");
    await db.update(media).set({ visibility: "private" }).where(eq(media.id, shared.id));
    assert.equal((await request(viewer, shared.id)).status, 404);
    assert.equal((await request(viewer, shared.id, 33)).status, 404);
    await db.update(media).set({ visibility: "public" }).where(eq(media.id, shared.id));
    await db.insert(blocksTable).values({ userId: owner, blockedUserId: viewer });
    assert.equal((await request(viewer, shared.id)).status, 404);
    assert.equal((await request(viewer, shared.id, 33)).status, 404);
    await db.delete(blocksTable).where(eq(blocksTable.userId, owner));
    await db.update(media).set({ moderationState: "removed" }).where(eq(media.id, shared.id));
    assert.equal((await request(viewer, shared.id)).status, 404);
    assert.equal((await request(viewer, shared.id, 33)).status, 404);
    await db.delete(media).where(eq(media.id, shared.id));
    assert.equal((await request(owner, shared.id)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await db.delete(media).where(like(media.objectKey, `${prefix}/%`));
    await db.delete(accounts).where(inArray(accounts.userId, [owner, viewer, other]));
    await db.delete(socialRateLimitsTable).where(like(socialRateLimitsTable.key, `${prefix}%`));
    await pool.end();
  }
});
