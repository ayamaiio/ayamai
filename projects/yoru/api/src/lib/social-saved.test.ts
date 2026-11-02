import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pool, mediaItemsTable as media, socialAccountsTable as accounts,
  blocksTable, socialRateLimitsTable, savedPostsTable, watchSignalsTable } from "@workspace/db";
import socialRouter from "../routes/social";
import mediaRouter from "../routes/media";
import { GetSavedSocialPostsResponse, GetSocialPostResponse } from "@workspace/api-zod";

test("Saved is private, cursor-paginated and rechecks current access using synthetic metadata only", async () => {
  const prefix = `saved-test-${randomUUID()}`;
  const owner = `${prefix}-owner`, viewer = `${prefix}-viewer`, ungated = `${prefix}-ungated`;
  const users = [owner, viewer, ungated];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId, tokenType: "session_token" }),
      { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  app.use("/api", socialRouter, mediaRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const request = (uid: string | null, path = "/social/saved", action?: string) => fetch(base + path, {
    method: action ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(uid ? { "x-test-user": uid } : {}) },
    ...(action ? { body: JSON.stringify({ action }) } : {}),
  });
  const page = async (uid: string, query = "") => {
    const response = await request(uid, `/social/saved${query}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    return GetSavedSocialPostsResponse.parse(await response.json());
  };
  try {
    await db.insert(accounts).values([owner, viewer].map((userId) => ({ userId, acceptedAt: new Date() })));
    // No storage objects, real user IDs or media requests are used.
    const shared = await db.insert(media).values(Array.from({ length: 28 }, (_, i) => ({
      userId: owner, title: `Synthetic ${i}`, originalName: "fixture.png", objectKey: `${prefix}/${i}`,
      size: 1, mediaType: "image", contentType: "image/png", visibility: "public",
      rightsConfirmedAt: new Date(), attribution: "anonymous",
    }))).returning();
    const [own] = await db.insert(media).values({
      userId: viewer, title: "Synthetic owned favorite", originalName: "fixture.mp4", objectKey: `${prefix}/own`,
      size: 1, mediaType: "video", contentType: "video/mp4", isFavorite: true,
    }).returning();
    await db.insert(savedPostsTable).values(shared.map((m) => ({ userId: viewer, mediaId: m.id })));
    assert.equal((await request(null)).status, 401);
    assert.equal((await request(ungated)).status, 403);
    assert.equal((await request(viewer, "/social/saved?cursor=bad")).status, 400);
    assert.equal((await request(viewer, "/social/saved?type=bad")).status, 400);
    assert.equal((await page(owner)).items.length, 0, "owners cannot see another account's saves");
    const first = await page(viewer);
    assert.equal(first.items.length, 24);
    assert.equal(first.hasMore, true);
    assert.ok(first.items.every((p) => p.isSaved));
    for (const secret of [owner, viewer, prefix, "objectKey", "originalName", "userId"]) {
      assert.ok(!JSON.stringify(first).includes(secret), `DTO must not leak ${secret}`);
    }
    const target = first.items[0];
    await request(viewer, `/social/posts/${target.id}/action`, "like");
    const before = GetSocialPostResponse.parse(await (await request(viewer, `/social/posts/${target.id}`)).json());
    assert.equal((await request(viewer, `/social/posts/${target.id}/action`, "unsave")).status, 200);
    const after = GetSocialPostResponse.parse(await (await request(viewer, `/social/posts/${target.id}`)).json());
    assert.equal(after.isSaved, false);
    assert.equal(after.reaction, "like");
    assert.equal(after.likeCount, before.likeCount);
    const second = await page(viewer, `?cursor=${first.nextCursor}`);
    assert.equal(second.items.length, 5, "deleting a save between pages must not skip results");
    assert.equal(second.hasMore, false);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.items, ...second.items].map((p) => p.id)).size, 29);
    assert.ok(!(await page(viewer)).items.some((p) => p.id === target.id), "unsave persists on a fresh request");
    // The cursor's first item could have been the owned favorite.
    await request(viewer, `/social/posts/${own.id}/action`, "save");
    const ownedSaved = await page(viewer, "?type=video");
    assert.deepEqual(ownedSaved.items.map((p) => p.id), [own.id]);
    assert.equal(ownedSaved.items[0].visibility, "private");
    const libraryUnsave = await fetch(`${base}/media/${own.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-test-user": viewer },
      body: JSON.stringify({ isFavorite: false }),
    });
    assert.equal(libraryUnsave.status, 200);
    assert.equal((await page(viewer, "?type=video")).items.length, 0, "Library and social saves stay in sync");
    await request(viewer, `/social/posts/${own.id}/action`, "save");
    await request(viewer, `/social/posts/${own.id}/action`, "unsave");
    assert.equal((await page(viewer, "?type=video")).items.length, 0, "owned favorite can be unsaved");
    const [privatePost, removedPost, deletedPost, consentPost] = shared.filter((p) => p.id !== target.id);
    await db.update(media).set({ visibility: "private" }).where(eq(media.id, privatePost.id));
    await db.update(media).set({ moderationState: "removed" }).where(eq(media.id, removedPost.id));
    await db.delete(media).where(eq(media.id, deletedPost.id));
    const visible = await page(viewer);
    for (const p of [privatePost, removedPost, deletedPost]) {
      assert.ok(!visible.items.some((item) => item.id === p.id));
      assert.equal((await request(viewer, `/social/posts/${p.id}`)).status, 404);
    }
    await db.update(accounts).set({ acceptedAt: null }).where(eq(accounts.userId, owner));
    assert.equal((await page(viewer)).items.length, 0, "owner must remain eligible");
    await db.update(accounts).set({ acceptedAt: new Date() }).where(eq(accounts.userId, owner));
    for (const [from, to] of [[owner, viewer], [viewer, owner]]) {
      await db.insert(blocksTable).values({ userId: from, blockedUserId: to });
      assert.equal((await page(viewer)).items.length, 0, "blocks hide saves in both directions");
      await db.delete(blocksTable).where(and(eq(blocksTable.userId, from), eq(blocksTable.blockedUserId, to)));
    }
    const restored = await page(viewer);
    const restoredItems = [...restored.items, ...(restored.nextCursor
      ? (await page(viewer, `?cursor=${restored.nextCursor}`)).items : [])];
    assert.ok(restoredItems.some((p) => p.id === consentPost.id), "restored access includes saves across every cursor page");
    await db.update(accounts).set({ acceptedAt: null }).where(eq(accounts.userId, viewer));
    assert.equal((await request(viewer)).status, 403, "viewer consent is rechecked");
  } finally {
    await db.delete(media).where(inArray(media.userId, users));
    await db.delete(watchSignalsTable).where(inArray(watchSignalsTable.userId, users));
    await db.delete(savedPostsTable).where(inArray(savedPostsTable.userId, users));
    await db.delete(blocksTable).where(inArray(blocksTable.userId, users));
    await db.delete(accounts).where(inArray(accounts.userId, users));
    await db.delete(socialRateLimitsTable).where(like(socialRateLimitsTable.key, `${prefix}%`));
    server.close(); server.closeAllConnections(); await pool.end();
  }
});
