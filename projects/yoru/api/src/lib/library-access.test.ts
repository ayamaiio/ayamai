import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { mock, test } from "node:test";
import express from "express";
import { S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { db, pool, mediaAuthorizationPool, mediaItemsTable as media,
  accessMembershipsTable as access, socialAccountsTable as accounts, membersTable } from "@workspace/db";
import { ListMediaResponse, ListMediaCollectionsResponse, GetMediaSummaryResponse, GetMediaPreviewResponse, GetGalleryAttachmentViewUrlResponse, GetMediaViewUrlResponse } from "@workspace/api-zod";
import app from "../app";
import { membershipBoundary } from "../middlewares/membershipBoundary";
import { logger } from "./logger";
import { sharedStreamMedia } from "./shared-delivery";

test("GOD Library reads span uploaders; membership revocation and ordinary isolation remain enforced", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.equal(pool.totalCount, 0);
  const schema = `library_test_${randomUUID().replaceAll("-", "")}`;
  pool.options.options = `-c search_path=${schema},pg_catalog`;
  mediaAuthorizationPool.options.options = `-c search_path=${schema},pg_catalog -c default_transaction_read_only=on`;
  const god = "synthetic-owner-subject", uploader = "synthetic-uploader", member = "itachi";
  // A member literally named itachi must never acquire GOD privileges.
  const savedEnv = { ...process.env };
  Object.assign(process.env, { SESSION_SECRET: "synthetic-ticket-secret", CLOUDFLARE_ACCOUNT_ID: "synthetic",
    CLOUDFLARE_R2_BUCKET_NAME: "synthetic", CLOUDFLARE_R2_ACCESS_KEY_ID: "synthetic",
    CLOUDFLARE_R2_SECRET_ACCESS_KEY: "synthetic" });
  const storage = mock.method(S3Client.prototype, "send", async () => ({
    Body: Readable.from(Buffer.from("synthetic")), ContentLength: 9,
  }));
  const fixture = express();
  fixture.use((req, _res, next) => {
    const userId = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId, tokenType: "session_token" }),
      { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  const stack = app.router.stack;
  const boundaryIndex = stack.findIndex((layer: { handle: unknown }) => layer.handle === membershipBoundary);
  assert.ok(boundaryIndex > 0);
  const fixtureLayer = fixture.router.stack[0];
  stack.splice(boundaryIndex, 0, fixtureLayer);
  const oldLevel = logger.level;
  logger.level = "silent";
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (path: string, user: string | null = god, method = "GET", body?: unknown) => fetch(base + path, {
    method, headers: { ...(user ? { "x-test-user": user } : {}), "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const tables = await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of tables.rows) {
      assert.match(tablename, /^[a-z][a-z0-9_]*$/);
      await pool.query(`CREATE TABLE "${schema}"."${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`);
    }
    await db.insert(access).values([
      { userId: god, email: "owner@example.invalid", role: "owner", status: "active" },
      { userId: member, email: "member@example.invalid", role: "member", status: "active" },
      { userId: uploader, email: "uploader@example.invalid", role: "member", status: "active" },
    ]);
    await db.insert(accounts).values([god, uploader, member].map(userId => ({ userId, acceptedAt: new Date() })));
    await db.insert(membersTable).values([god, member, uploader].map(userId => ({ userId, source: "access" })));
    const attachmentId = randomUUID();
    const rows = await db.insert(media).values(Array.from({ length: 75 }, (_, i) => ({
      userId: i === 0 ? god : uploader, title: `fixture ${i}`, originalName: `${i}.jpg`,
      objectKey: `synthetic/${i}`, contentType: i === 2 ? "video/mp4" : "image/jpeg",
      mediaType: i === 2 ? "video" : "image", size: 10,
      collection: i === 0 ? "Owner" : "Imported", createdAt: new Date("2026-01-01"),
      galleryImages: i === 1 ? [{ id: attachmentId, originalName: "extra.gif", objectKey: "synthetic/attachment",
        contentType: "image/gif", size: 5, width: null, height: null }] : [],
    }))).returning();
    const sorted = rows.map(r => r.id).sort().reverse();
    const seen: string[] = [];
    for (const offset of [0, 30, 60]) {
      const response = await call(`/api/media?limit=30&offset=${offset}`);
      assert.equal(response.status, 200);
      const data = ListMediaResponse.parse(await response.json());
      assert.equal(data.total, 75);
      seen.push(...data.items.map((x: { id: string }) => x.id));
    }
    assert.deepEqual(seen, sorted);
    const anchored = ListMediaResponse.parse(await (await call(`/api/media?limit=30&anchorId=${sorted[60]}`)).json());
    assert.equal(anchored.offset, 48);
    assert.deepEqual(anchored.items.map((x: { id: string }) => x.id), sorted.slice(48));
    assert.deepEqual(ListMediaCollectionsResponse.parse(await (await call("/api/media/collections")).json()).collections, ["Imported", "Owner"]);
    const summary = GetMediaSummaryResponse.parse(await (await call("/api/media/summary")).json());
    assert.equal(summary.totalItems, 75); assert.equal(summary.totalBytes, 755);
    assert.equal(summary.videoCount, 1); assert.equal(summary.imageCount, 74);
    const filtered = ListMediaResponse.parse(await (await call("/api/media?type=video&collection=Imported&q=fixture")).json());
    assert.equal(filtered.total, 1);
    for (const user of [member, uploader]) {
      const data = ListMediaResponse.parse(await (await call("/api/media", user)).json());
      assert.equal(data.total, user === member ? 0 : 74);
    }
    assert.equal((await call("/api/media", null)).status, 401);
    assert.equal((await call("/api/unknown-private-resource", null)).status, 401);
    assert.equal((await call(`/api/streams/${rows[1].id}`, null, "POST")).status, 401);
    const foreign = rows[1];
    assert.equal((await call(`/api/media/${foreign.id}/preview/image?ticket=invalid`, null)).status, 404);
    assert.equal((await call(`/api/media/${foreign.id}/view-url`, member)).status, 404);
    assert.equal((await call(`/api/media/${foreign.id}/view-url`)).status, 200);
    const previewResponse = await call(`/api/media/${foreign.id}/preview`);
    assert.equal(previewResponse.status, 200);
    const preview = GetMediaPreviewResponse.parse(await previewResponse.json());
    assert.ok(preview.url);
    assert.equal((await call(preview.url, null)).status, 200);
    const attachmentResponse = await call(`/api/media/${foreign.id}/attachments/${attachmentId}/view-url`);
    assert.equal(attachmentResponse.status, 200);
    const attachment = GetGalleryAttachmentViewUrlResponse.parse(await attachmentResponse.json());
    assert.equal((await call(attachment.url, null)).status, 200);
    // Public playback takes a separate bounded authorization query. GOD can
    // read restored media even if its legacy uploader lacks current admission.
    await db.update(media).set({ visibility: "public" }).where(eq(media.id, foreign.id));
    assert.ok(await sharedStreamMedia(foreign.id, god));
    const stream = GetMediaViewUrlResponse.parse(await (await call(`/api/media/${foreign.id}/view-url`)).json());
    assert.equal((await call(stream.url, null)).status, 200);
    assert.equal((await call(attachment.url, null)).status, 200);
    await assert.rejects(sharedStreamMedia(foreign.id, member), { status: 404 });
    // Read privilege does not allow metadata changes, deletion or preview writes.
    assert.equal((await call(`/api/media/${foreign.id}`, god, "PATCH", { title: "changed" })).status, 404);
    assert.equal((await call(`/api/media/${foreign.id}`, god, "DELETE")).status, 404);
    assert.equal((await call(`/api/media/${foreign.id}/preview`, god, "POST")).status, 404);
    await db.update(media).set({ moderationState: "removed" }).where(eq(media.id, foreign.id));
    assert.equal(GetMediaSummaryResponse.parse(await (await call("/api/media/summary")).json()).totalItems, 74);
    assert.equal((await call(preview.url, null)).status, 404);
    await assert.rejects(sharedStreamMedia(foreign.id, god), { status: 404 });
    await db.update(media).set({ moderationState: "active" }).where(eq(media.id, foreign.id));
    await db.update(access).set({ status: "revoked" }).where(eq(access.userId, god));
    assert.equal((await call("/api/media")).status, 403);
    assert.equal((await call(preview.url, null)).status, 404);
    assert.equal((await call(attachment.url, null)).status, 404);
    assert.equal((await call(stream.url, null)).status, 404);
    await assert.rejects(sharedStreamMedia(foreign.id, god), { status: 404 });
    assert.equal((await db.select().from(media).where(eq(media.id, foreign.id)))[0].userId, uploader);
  } finally {
    stack.splice(stack.indexOf(fixtureLayer), 1);
    logger.level = oldLevel;
    storage.mock.restore();
    process.env = savedEnv;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await mediaAuthorizationPool.end();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});
