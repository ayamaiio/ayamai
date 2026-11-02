import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool, mediaItemsTable as media, mediaAnnotationsTable as annotations, socialRateLimitsTable as limits } from "@workspace/db";
import mediaRouter from "../routes/media";
import storageRouter from "../routes/storage";
import annotationsRouter from "../routes/annotations";
import { CAPTURE_LIMIT, captureKey, captureDigest, validateCaptureBytes } from "./browser-capture";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sVEAAAAASUVORK5CYII=", "base64");
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(12)]);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
test("capture validates actual benign image/video bytes, MIME, checksum and bounds", async () => {
  for (const [bytes, mime] of [[png, "image/png"], [mp4, "video/mp4"]] as const) {
    await validateCaptureBytes(bytes, hash(bytes), mime, bytes.length);
  }
  await assert.rejects(validateCaptureBytes(Buffer.from("<html>login</html>"), hash(Buffer.from("<html>login</html>")), "image/png", 18));
  await assert.rejects(validateCaptureBytes(png, hash(png), "video/mp4", png.length));
  await assert.rejects(validateCaptureBytes(png, "0".repeat(64), "image/png", png.length));
  await assert.rejects(validateCaptureBytes(png, hash(png), "image/png", CAPTURE_LIMIT + 1));
  const first = captureKey("owner", hash(png)), next = captureKey("owner", hash(png));
  assert.notEqual(first, next, "never issue a second capture's PUT to the first post's object");
  assert.equal(captureDigest(first, "owner"), hash(png));
  assert.equal(captureDigest(first, "other"), null);
});

test("capture account binding, private labels and idempotent duplicate responses", async () => {
  const owner = `capture-test-${randomUUID()}`, other = `${owner}-other`;
  const key = captureKey(owner, hash(png));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId: uid, tokenType: "session_token" }), { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  app.use("/api", storageRouter, mediaRouter, annotationsRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const request = (uid: string | null, path: string, method = "GET", body?: unknown, paired = uid) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(uid ? { "x-test-user": uid } : {}), ...(paired ? { "X-Capture-Account": paired } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const [item] = await db.insert(media).values({
    userId: owner, objectKey: key, title: "Original private capture", originalName: "benign.png",
    contentType: "image/png", mediaType: "image", size: png.length, visibility: "private",
  }).returning();
  const body = { title: "Do not overwrite", originalName: "capture.png", contentType: "image/png", mediaType: "image", size: png.length, objectKey: key, posting: { visibility: "private", attribution: "anonymous", description: "", tags: [], rightsConfirmed: false } };
  try {
    assert.equal((await request(null, "/capture/uploads", "POST", {})).status, 401);
    assert.equal((await request(other, "/capture/uploads", "POST", {}, owner)).status, 409);
    assert.equal((await request(owner, "/capture/uploads", "POST", { sha256: hash(png), size: CAPTURE_LIMIT + 1, contentType: "image/png" })).status, 400);
    assert.equal((await request(owner, "/capture/uploads", "POST", { sha256: hash(png), size: png.length, contentType: "image/svg+xml" })).status, 400);
    const responses = await Promise.all(Array.from({ length: 3 }, () => request(owner, "/media", "POST", body)));
    for (const response of responses) {
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json() as { id: string; title: string; captureDuplicate: boolean };
      assert.equal(result.id, item!.id); assert.equal(result.title, "Original private capture"); assert.equal(result.captureDuplicate, true);
    }
    assert.equal((await request(other, "/media", "POST", body)).status, 400);
    assert.equal((await request(other, "/media", "POST", body, owner)).status, 409);
    const path = `/social/posts/${item!.id}/annotation`;
    const draft = { expectedRevision: 0, tags: ["private-capture"], attributes: { mood: ["benign"] }, notes: "PRIVATE CAPTURE NOTE", reviewStatus: "draft", confidence: "unsure", sourceUrl: "https://example.com/posts/123" };
    const saved = await request(owner, path, "PUT", draft);
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.equal((await request(owner, path, "PUT", draft)).status, 200);
    assert.equal((await request(other, path)).status, 404);
    assert.equal((await request(other, path, "PUT", draft, owner)).status, 409);
    const [record] = await db.select().from(media).where(eq(media.id, item!.id));
    assert.equal(record!.visibility, "private"); assert.equal(record!.title, "Original private capture");
    assert.equal((await db.select().from(annotations).where(eq(annotations.userId, owner))).length, 1);
  } finally {
    await db.delete(media).where(eq(media.userId, owner));
    await db.delete(limits).where(like(limits.key, `${owner}%`));
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await pool.end();
  }
});
