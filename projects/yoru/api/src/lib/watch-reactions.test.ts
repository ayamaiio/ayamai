import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { db, mediaItemsTable, pool, watchSignalsTable } from "@workspace/db";
import watchRouter from "../routes/watch";

test("Library reactions persist, count truthfully, and never cross accounts", async (t) => {
  const owner = `library-test-${randomUUID()}`;
  let identity: string | null = owner;
  const app = express();
  app.use(express.json());
  // Test-only fixture. Production routes still require verified Clerk sessions.
  app.use((req, _res, next) => {
    Object.assign(req, { auth: Object.assign(
      () => ({ userId: identity, tokenType: "session_token" }),
      { [Symbol.for("@clerk/express.auth")]: true },
    ) });
    next();
  });
  app.use(watchRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const [item] = await db.insert(mediaItemsTable).values({
    userId: owner, title: "Synthetic reaction test", originalName: "fixture.png",
    objectKey: `test-fixtures/${owner}/${randomUUID()}`, contentType: "image/png",
    mediaType: "image", size: 1,
  }).returning();
  const path = `/watch/media/${item!.id}/reaction`;
  const request = (reaction?: string | null, endpoint = path) => fetch(base + endpoint, reaction === undefined ? undefined : {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reaction }),
  });
  try {
    await t.test("new media has zero likes, not an invented public total", async () => {
      const response = await request();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await response.json(), { mediaId: item!.id, reaction: null, likeCount: 0 });
    });
    await t.test("like persists, retries do not inflate it, and GET reloads the saved state", async () => {
      for (let retry = 0; retry < 3; retry++) {
        const response = await request("like");
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { mediaId: item!.id, reaction: "like", likeCount: 1 });
      }
      assert.deepEqual(await (await request()).json(), { mediaId: item!.id, reaction: "like", likeCount: 1 });
      assert.equal((await db.select().from(watchSignalsTable).where(eq(watchSignalsTable.mediaId, item!.id))).length, 1);
    });
    await t.test("dislike or remove-like produces zero and does not delete the media", async () => {
      for (const reaction of ["dislike", null]) {
        assert.deepEqual(await (await request(reaction)).json(), { mediaId: item!.id, reaction, likeCount: 0 });
        assert.deepEqual(await (await request()).json(), { mediaId: item!.id, reaction, likeCount: 0 });
      }
      assert.equal((await db.select().from(mediaItemsTable).where(eq(mediaItemsTable.id, item!.id))).length, 1);
    });
    await t.test("another account cannot read or write this item's reactions", async () => {
      identity = `library-other-${randomUUID()}`;
      assert.equal((await request()).status, 404);
      assert.equal((await request("like")).status, 404);
      identity = owner;
      assert.deepEqual(await (await request()).json(), { mediaId: item!.id, reaction: null, likeCount: 0 });
    });
    await t.test("invalid IDs/reactions are rejected and sign-in is mandatory", async () => {
      assert.equal((await request(undefined, "/watch/media/not-a-uuid/reaction")).status, 400);
      assert.equal((await request("invalid-reaction")).status, 400);
      identity = null;
      assert.equal((await request()).status, 401);
      assert.equal((await request("like")).status, 401);
    });
  } finally {
    await db.delete(mediaItemsTable).where(eq(mediaItemsTable.userId, owner));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
});
