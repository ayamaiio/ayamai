import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, mediaItemsTable as media, pool, socialEventsTable as events, videoViewsTable as views, watchSettingsTable } from "@workspace/db";
import { recordSocialTelemetry } from "./social-telemetry";
import { videoViewCounts } from "./video-views";

test("video views qualify, deduplicate and preserve the visibility at viewing time", async t => {
  const owner = `view-test-${randomUUID()}`, viewer = `view-test-${randomUUID()}`;
  const [item] = await db.insert(media).values({
    userId: owner, title: "Synthetic view test", originalName: "fixture.mp4",
    objectKey: `test-fixtures/${owner}/${randomUUID()}`, contentType: "video/mp4",
    mediaType: "video", size: 1, durationSeconds: 30,
  }).returning();
  const progress = async (uid: string, seconds: number, eventId = randomUUID()) => {
    await db.update(events).set({ createdAt: new Date(Date.now() - 10_000) }).where(eq(events.userId, uid));
    return recordSocialTelemetry(uid, item!, { eventId, event: "progress", watchSeconds: seconds, durationSeconds: 30 });
  };
  const count = async (uid = owner) => (await videoViewCounts([item!], uid)).get(item!.id);
  try {
    await t.test("less than three seconds is not a view; retries and more playback count once", async () => {
      await progress(owner, 1); assert.equal(await count(), 0);
      const id = randomUUID();
      await progress(owner, 2, id); assert.equal(await count(), 1);
      assert.equal(await progress(owner, 2, id), false);
      await progress(owner, 10); assert.equal(await count(), 1);
      assert.equal(await count(viewer), 0);
    });
    await t.test("publishing does not reveal earlier private viewing", async () => {
      await db.update(media).set({ visibility: "public" }).where(eq(media.id, item!.id));
      item!.visibility = "public";
      assert.equal(await count(), 0);
      await progress(owner, 3); assert.equal(await count(), 1);
      await progress(viewer, 3); assert.equal(await count(), 2);
      await db.update(media).set({ visibility: "private" }).where(eq(media.id, item!.id));
      item!.visibility = "private";
      assert.equal(await count(), 1);
    });
    await t.test("a different UTC day can qualify again, but disabled tracking cannot", async () => {
      await db.insert(views).values({ userId: owner, mediaId: item!.id, day: "2000-01-01", visibility: "private", watchedSeconds: 3 });
      assert.equal(await count(), 2);
      await db.insert(watchSettingsTable).values({ userId: owner, behaviorEnabled: false });
      assert.equal(await progress(owner, 3), false);
      assert.equal(await count(), 2);
    });
    await t.test("images have no video views", async () => {
      assert.equal((await videoViewCounts([{ ...item!, mediaType: "image" }], owner)).size, 0);
    });
  } finally {
    await db.delete(media).where(eq(media.id, item!.id));
    await db.delete(watchSettingsTable).where(eq(watchSettingsTable.userId, owner));
    await pool.end();
  }
});
