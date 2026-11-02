import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pool, mediaItemsTable as media, socialAccountsTable as accounts,
  socialRateLimitsTable, watchFeedSessionsTable, watchSignalsTable } from "@workspace/db";
import { CreateGalleryPostBody, GetSocialPostResponse } from "@workspace/api-zod";
import { recordGalleryPost, validateGalleryUploads, lockUploadKeys, findUploadClaim, deletePostObjects } from "./gallery-posts";
import { createMediaTicket } from "./media-tickets";
import galleryRouter from "../routes/gallery-posts";
import socialRouter from "../routes/social";
import annotationsRouter from "../routes/annotations";
import mediaRouter from "../routes/media";

test("ordered image/GIF posts are atomic, idempotent, private and one social/label/recommendation entity", async t => {
  const prefix = `gallery-test-${randomUUID()}`;
  const owner = `${prefix}-owner`, viewer = `${prefix}-viewer`;
  const users = [owner, viewer];
  const app = express();
  app.use(express.json());
  // Test-only authentication fixture in this isolated in-process Express server.
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId, tokenType: "session_token" }),
      { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  app.use("/api", galleryRouter, annotationsRouter, socialRouter, mediaRouter);
  const server = app.listen(0);
  await new Promise<void>(resolve => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const request = (uid: string | null, path: string, method = "GET", body?: unknown) => fetch(base + path, {
    method, headers: { "Content-Type": "application/json", ...(uid ? { "x-test-user": uid } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const input = (suffix: string) => ({
    submissionId: randomUUID(),
    title: "Synthetic gallery",
    images: [
      { originalName: "synthetic.png", objectKey: `media/${owner}/${suffix}-cover`, contentType: "image/png", size: 10 },
      { originalName: "synthetic.gif", objectKey: `media/${owner}/${suffix}-animated`, contentType: "image/gif", size: 15 },
      { originalName: "synthetic.webp", objectKey: `media/${owner}/${suffix}-last`, contentType: "image/webp", size: 20 },
    ],
  });
  const verify = async () => true;
  try {
    // Fictional consent fixtures for server authorization tests; no real adult media or UI attestations.
    await db.insert(accounts).values(users.map(userId => ({ userId, acceptedAt: new Date() })));
    await t.test("limits, images only, duplicate and cross-account upload protection", () => {
      const body = input("invalid");
      assert.equal(CreateGalleryPostBody.safeParse({ ...body, images: [] }).success, false);
      assert.equal(CreateGalleryPostBody.safeParse({ ...body, images: Array(21).fill(body.images[0]) }).success, false);
      assert.throws(() => validateGalleryUploads(viewer, body.images), { status: 400 });
      assert.throws(() => validateGalleryUploads(owner, [body.images[0], body.images[0]]), { status: 400 });
      assert.throws(() => validateGalleryUploads(owner, [{ ...body.images[0], contentType: "video/mp4" }]), { status: 415 });
      assert.throws(() => validateGalleryUploads(owner, [{ ...body.images[0], objectKey: `media/${owner}/../other/file` }]), { status: 400 });
    });
    await t.test("one failed object verification cannot publish a partial post", async () => {
      const body = input("failure");
      let call = 0;
      await assert.rejects(recordGalleryPost(owner, body, { verify: async () => ++call < 2 }), { status: 400 });
      assert.equal((await db.select().from(media).where(eq(media.submissionId, body.submissionId))).length, 0);
    });
    const body = input("good");
    const [post, retried] = await Promise.all([
      recordGalleryPost(owner, body, { verify }), recordGalleryPost(owner, body, { verify }),
    ]);
    await t.test("concurrent retries create one canonical post and preserve image order", async () => {
      assert.equal(post.id, retried.id);
      assert.equal((await db.select().from(media).where(eq(media.userId, owner))).length, 1);
      assert.equal(post.objectKey, body.images[0].objectKey);
      assert.deepEqual(post.galleryImages.map(image => image.objectKey), body.images.slice(1).map(image => image.objectKey));
      assert.equal(post.galleryImages[0].contentType, "image/gif");
      assert.equal(post.visibility, "private", "missing explicit publication must remain private");
      const again = await recordGalleryPost(owner, body, { verify: async () => { throw new Error("Must not reverify a committed retry"); } });
      assert.equal(again.id, post.id);
      await assert.rejects(recordGalleryPost(owner, { ...body, title: "Changed after committing" }, { verify }), { status: 409 });
    });
    await t.test("neither another gallery nor legacy single upload may reuse a gallery attachment", async () => {
      await assert.rejects(recordGalleryPost(owner, { ...body, submissionId: randomUUID() }, { verify }), { status: 409 });
      await db.transaction(async tx => {
        await lockUploadKeys(tx, [body.images[1].objectKey]);
        assert.equal((await findUploadClaim(tx, [body.images[1].objectKey]))?.id, post.id);
      });
    });
    await t.test("parent-only social DTOs, private labels, saves, and recommendation sessions", async () => {
      const response = await request(owner, `/social/posts/${post.id}`);
      assert.equal(response.status, 200);
      const dto = GetSocialPostResponse.parse(await response.json());
      assert.deepEqual(dto.attachments?.map(image => image.id), [post.id, ...post.galleryImages.map(image => image.id)]);
      assert.deepEqual(dto.attachments?.map(image => image.position), [0, 1, 2]);
      const serialized = JSON.stringify(dto);
      for (const secret of [owner, "objectKey", "originalName", "submissionHash", "media/"]) assert.ok(!serialized.includes(secret));
      assert.equal((await request(owner, `/social/posts/${post.id}/action`, "POST", { action: "like" })).status, 200);
      assert.equal((await request(owner, `/social/posts/${post.id}/action`, "POST", { action: "save" })).status, 200);
      const label = await request(owner, `/social/posts/${post.id}/annotation`, "PUT", {
        expectedRevision: 0, tags: ["#SYNTHETIC-SET"], attributes: { format: ["gallery"] },
        notes: "Applies to the whole synthetic post.", reviewStatus: "reviewed", confidence: "confident",
      });
      assert.equal(label.status, 200);
      assert.deepEqual((await label.json() as { tags: string[] }).tags, ["synthetic-set"]);
      for (const image of post.galleryImages) {
        assert.equal((await request(owner, `/social/posts/${image.id}`)).status, 404);
        assert.equal((await request(owner, `/social/posts/${image.id}/annotation`)).status, 404);
        assert.equal((await request(owner, `/social/posts/${image.id}/action`, "POST", { action: "like" })).status, 404);
      }
      const signals = await db.select().from(watchSignalsTable).where(eq(watchSignalsTable.userId, owner));
      assert.equal(signals.length, 1);
      assert.equal(signals[0].mediaId, post.id);
      const feed = await request(owner, `/social/feed?sessionId=${randomUUID()}&lane=collection&type=image&hashtag=synthetic-set`);
      assert.equal(feed.status, 200);
      const page = await feed.json() as { items: { id: string; attachments: unknown[] }[] };
      assert.deepEqual(page.items.map(item => item.id), [post.id]);
      assert.equal(page.items[0].attachments.length, 3);
      const summary = await (await request(owner, "/media/summary")).json() as { totalItems: number; totalBytes: number };
      assert.equal(summary.totalItems, 1);
      assert.equal(summary.totalBytes, 45, "storage summary includes all gallery images");
    });
    await t.test("attachment URL and stream authorization always follows the parent", async () => {
      const image = post.galleryImages[0];
      const path = `/media/${post.id}/attachments/${image.id}/view-url`;
      assert.equal((await request(null, path)).status, 401);
      assert.equal((await request(viewer, path)).status, 404);
      assert.equal((await request(owner, `/media/${post.id}/attachments/${randomUUID()}/view-url`)).status, 404);
      const response = await request(owner, path);
      assert.equal(response.status, 200);
      const url = (await response.json() as { url: string }).url;
      assert.ok(url.startsWith(`/api/gallery-streams/${post.id}/${image.id}?ticket=`));
      assert.ok(!url.includes(owner));
      const ticket = createMediaTicket(post.id, viewer);
      assert.equal((await fetch(`${base}/gallery-streams/${post.id}/${image.id}?ticket=${ticket}`)).status, 404);
      const ownerTicket = createMediaTicket(post.id, owner);
      await db.update(media).set({ moderationState: "removed" }).where(eq(media.id, post.id));
      assert.equal((await fetch(`${base}/gallery-streams/${post.id}/${image.id}?ticket=${ownerTicket}`)).status, 404);
      await db.update(media).set({ moderationState: "active" }).where(eq(media.id, post.id));
      await db.update(media).set({ visibility: "public", rightsConfirmedAt: new Date() }).where(eq(media.id, post.id));
      assert.equal((await request(viewer, path)).status, 200);
      await db.update(media).set({ visibility: "private" }).where(eq(media.id, post.id));
      assert.equal((await fetch(`${base}/gallery-streams/${post.id}/${image.id}?ticket=${ticket}`)).status, 404, "an old URL cannot bypass new privacy");
    });
    await t.test("deletion cleans every image and preview without affecting independent posts", async () => {
      const deleted: string[] = [], previews: string[] = [];
      await deletePostObjects(post, { remove: async key => { deleted.push(key); }, removePreviews: async key => { previews.push(key); } });
      assert.deepEqual(new Set(deleted), new Set(body.images.map(image => image.objectKey)));
      assert.deepEqual(new Set(previews), new Set(deleted));
      assert.equal(deleted.length, 3);
    });
  } finally {
    await db.delete(media).where(inArray(media.userId, users));
    await db.delete(watchFeedSessionsTable).where(inArray(watchFeedSessionsTable.userId, users));
    await db.delete(accounts).where(inArray(accounts.userId, users));
    await db.delete(socialRateLimitsTable).where(like(socialRateLimitsTable.key, `${prefix}%`));
    server.close(); server.closeAllConnections(); await pool.end();
  }
});
