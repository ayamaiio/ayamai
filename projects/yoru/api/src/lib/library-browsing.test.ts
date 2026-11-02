import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, mediaItemsTable, pool } from "@workspace/db";
import mediaRouter from "../routes/media";

test("Library anchor windows stay bounded, deterministic, filtered and account-scoped", async () => {
  const prefix = `library-resume-${randomUUID()}`;
  const owner = `${prefix}-owner`;
  const other = `${prefix}-other`;
  const app = express();
  app.use((req, _res, next) => {
    const identity = req.get("x-test-user") ?? null;
    Object.assign(req, {
      auth: Object.assign(() => ({ userId: identity, tokenType: "session_token" }), {
        [Symbol.for("@clerk/express.auth")]: true,
      }),
    });
    next();
  });
  app.use(mediaRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  async function list(query: Record<string, string>, user = owner) {
    const response = await fetch(`${base}/media?${new URLSearchParams(query)}`, {
      headers: { "x-test-user": user },
    });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ items: { id: string }[]; offset: number; total: number }>;
  }
  try {
    // Equal timestamps deliberately exercise the stable UUID tie-breaker.
    const rows = await db.insert(mediaItemsTable).values(
      Array.from({ length: 1400 }, (_, i) => ({
        userId: owner, title: `Resume fixture ${i}`, originalName: `${i}.jpg`,
        objectKey: `test-fixtures/${prefix}/${i}`, contentType: "image/jpeg",
        mediaType: "image", size: 1, collection: "Resume", isFavorite: true,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      })),
    ).returning({ id: mediaItemsTable.id });
    const sorted = rows.map((row) => row.id).sort().reverse();
    const anchor = sorted[1200];
    const first = await list({ anchorId: anchor, limit: "60" });
    assert.equal(first.offset, 1188);
    assert.equal(first.total, 1400);
    assert.deepEqual(first.items.map((item) => item.id), sorted.slice(1188, 1248));
    const next = await list({ offset: "1248", limit: "60" });
    assert.deepEqual(next.items.map((item) => item.id), sorted.slice(1248, 1308));
    const earlier = await list({ offset: "1128", limit: "60" });
    assert.deepEqual(earlier.items.map((item) => item.id), sorted.slice(1128, 1188));
    const filtered = await list({
      anchorId: anchor, limit: "60", type: "image", favorites: "true",
      collection: "Resume", q: "fixture",
    });
    assert.equal(filtered.offset, 1188);
    const excludedFilters: Record<string, string>[] = [{ type: "video" }, { collection: "Missing" }, { uncategorized: "true" }, { q: "nomatch" }];
    for (const filter of excludedFilters) {
      const page = await list({ anchorId: anchor, limit: "60", ...filter });
      assert.equal(page.offset, 0);
      assert.equal(page.total, 0);
    }
    const foreign = await list({ anchorId: anchor, limit: "60" }, other);
    assert.equal(foreign.offset, 0);
    assert.equal(foreign.total, 0);
    await db.update(mediaItemsTable).set({ moderationState: "removed" }).where(eq(mediaItemsTable.id, anchor));
    const moderated = await list({ anchorId: anchor, limit: "60" });
    assert.equal(moderated.offset, 0);
    assert.equal(moderated.total, 1399);
    await db.delete(mediaItemsTable).where(eq(mediaItemsTable.id, anchor));
    const deleted = await list({ anchorId: anchor, limit: "60" });
    assert.equal(deleted.offset, 0);
    assert.equal(deleted.items.length, 60);
    const invalid = await fetch(`${base}/media?anchorId=not-a-uuid`, { headers: { "x-test-user": owner } });
    assert.equal(invalid.status, 400);
    const anonymous = await fetch(`${base}/media?anchorId=${anchor}`);
    assert.equal(anonymous.status, 401);
  } finally {
    await db.delete(mediaItemsTable).where(inArray(mediaItemsTable.userId, [owner, other]));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
});
