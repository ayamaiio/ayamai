import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, pool, mediaItemsTable as media } from "@workspace/db";
import router from "../routes/media-previews";
import mediaRouter from "../routes/media";
import { generateMediaPreview } from "./media-previews";
import { previewKey } from "./preview-render";
import { createMediaTicket } from "./media-tickets";
import { putMediaPreview, deleteMediaObject, deleteMediaPreviews, mediaObjectExists, readMediaRange } from "./r2Storage";

test("private previews retain account access, regenerate atomically and delete with originals", async (t) => {
  const owner = `preview-test-${randomUUID()}`;
  const key = `media/${owner}/${randomUUID()}`;
  const bytes = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#448866" } }).jpeg().toBuffer();
  let id: string | undefined;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId, tokenType: "session_token" }), { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  app.use(router);
  app.use(mediaRouter);
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, user = owner, method = "GET") => fetch(base + path, {
    method, headers: user ? { "x-test-user": user } : {},
  });
  try {
    await putMediaPreview(key, bytes);
    const upload = await fetch(base + "/media", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": owner },
      body: JSON.stringify({
      title: "Synthetic preview fixture", originalName: "fixture.jpg",
      objectKey: key, contentType: "image/jpeg", mediaType: "image", size: bytes.length,
      }),
    });
    assert.equal(upload.status, 201);
    id = (await upload.json() as { id: string }).id;
    const path = `/media/${id}/preview`;
    await t.test("unauthenticated and other accounts cannot fetch or regenerate", async () => {
      assert.equal((await request(path, "")).status, 401);
      assert.equal((await request(path, `${owner}-other`)).status, 404);
      assert.equal((await request(path, `${owner}-other`, "POST")).status, 404);
      assert.equal((await request(`${path}/image?ticket=invalid`, "")).status, 404);
    });
    // Upload completion queues work without making upload success wait for decoding.
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await mediaObjectExists(previewKey(key))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(await mediaObjectExists(previewKey(key)), "upload should proactively generate a preview");
    const ready = await request(path);
    const result = await ready.json() as { status: string; url: string };
    assert.equal(result.status, "ready");
    assert.ok(!result.url.includes(owner));
    assert.equal(ready.headers.get("cache-control"), "private, no-store");
    const image = await request(result.url, "");
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.equal(image.headers.get("cache-control"), "private, no-store");
    const preview = Buffer.from(await image.arrayBuffer());
    assert.ok(preview.length < bytes.length);
    assert.equal((await sharp(preview).metadata()).width, 640);
    await t.test("preview tickets cannot be substituted with original-stream tickets", async () => {
      assert.equal((await request(`${path}/image?ticket=${createMediaTicket(id!, owner)}`, "")).status, 404);
    });
    await t.test("moderation and deletion are rechecked even with a previously issued ticket", async () => {
      await db.update(media).set({ moderationState: "removed" }).where(eq(media.id, id!));
      assert.equal((await request(result.url, "")).status, 404);
      await db.update(media).set({ moderationState: "active" }).where(eq(media.id, id!));
    });
    await t.test("a missing preview regenerates and repeat generation is idempotent", async () => {
      await deleteMediaObject(previewKey(key));
      await Promise.all([generateMediaPreview(id!), generateMediaPreview(id!)]);
      assert.ok(await mediaObjectExists(previewKey(key)));
    });
    await t.test("failed regeneration preserves the previous valid preview", async () => {
      const before = await readMediaRange(previewKey(key));
      const previous = await before.Body!.transformToByteArray();
      await putMediaPreview(key, Buffer.alloc(bytes.length)); // corrupt source, matching recorded size
      await assert.rejects(generateMediaPreview(id!, true));
      const after = await readMediaRange(previewKey(key));
      assert.deepEqual(await after.Body!.transformToByteArray(), previous);
      await putMediaPreview(key, bytes);
    });
    await t.test("all preview versions disappear with the original", async () => {
      await putMediaPreview(`${key}.previews/old/tile.jpg`, preview);
      const [deletion] = await Promise.all([
        request(`/media/${id}`, owner, "DELETE"),
        generateMediaPreview(id!, true),
      ]);
      assert.equal(deletion.status, 204);
      assert.equal(await mediaObjectExists(key), false);
      assert.equal(await mediaObjectExists(previewKey(key)), false);
      assert.equal(await mediaObjectExists(`${key}.previews/old/tile.jpg`), false);
      assert.equal((await request(result.url, "")).status, 404);
      await generateMediaPreview(id!);
      assert.equal(await mediaObjectExists(previewKey(key)), false);
    });
  } finally {
    if (id) await db.delete(media).where(eq(media.id, id));
    await deleteMediaPreviews(key);
    await deleteMediaObject(key);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});
