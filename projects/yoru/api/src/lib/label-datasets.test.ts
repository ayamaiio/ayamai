import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray, like } from "drizzle-orm";
import {
  db, pool, mediaItemsTable as media, socialAccountsTable as accounts,
  labelExportsTable as exports, labelExportRowsTable as rows, socialRateLimitsTable, blocksTable as socialBlocksTable,
} from "@workspace/db";
import datasetsRouter from "../routes/label-datasets";
import annotationsRouter from "../routes/annotations";

test("private dataset queue, snapshot corrections, bounded pagination, revocation and resumption", async (t) => {
  const prefix = `dataset-test-${randomUUID()}`;
  const owner = `${prefix}-owner`, viewer = `${prefix}-viewer`, other = `${prefix}-other`;
  const users = [owner, viewer, other];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId, tokenType: "session_token" }), { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  app.use("/api", datasetsRouter, annotationsRouter);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const request = (uid: string | null, path: string, method = "GET", body?: unknown) =>
    fetch(base + path, { method, headers: { ...(uid ? { "x-test-user": uid } : {}), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (response: Response, status = 200) => {
    assert.equal(response.status, status, await response.clone().text());
    return response.json() as Promise<Record<string, any>>;
  };
  const fixtures = await db.insert(media).values(Array.from({ length: 108 }, (_, i) => ({
    userId: i < 105 ? viewer : owner, title: `Benign dataset fixture ${i}`, originalName: "fixture.png",
    objectKey: `private-storage-SECRET/${prefix}/${randomUUID()}`, mediaType: "image", contentType: "image/png", size: 1,
    visibility: i < 107 ? "public" : "private", rightsConfirmedAt: i < 107 ? new Date() : null,
  }))).returning();
  const first = fixtures[0], draft = fixtures[1], shared = fixtures[105], revoked = fixtures[106], secret = fixtures[107];
  const label = (uid: string, id: string, expectedRevision = 0, changes = {}) => request(uid, `/social/posts/${id}/annotation`, "PUT", {
    expectedRevision, tags: ["#ＡＱＵＡ"], attributes: { Style: ["Painted"] }, notes: "Personal notes",
    reviewStatus: "reviewed", confidence: "confident", sourceUrl: "https://example.com/art?token=SECRET#SECRET", ...changes,
  });
  const create = async (uid: string, body = {}) => json(await request(uid, "/social/label-exports", "POST", body), 201);
  const readPage = async (uid: string, id: string, cursor = 0, limit = 100) =>
    json(await request(uid, `/social/label-exports/${id}/rows?cursor=${cursor}&limit=${limit}`));
  const records = (page: Record<string, any>) => page.jsonl.trim() ? page.jsonl.trim().split("\n").map((s: string) => JSON.parse(s)) : [];
  try {
    await db.insert(accounts).values(users.map((userId) => ({ userId, acceptedAt: new Date() })));
    await t.test("queue authentication, bounds, canonical tag/status filtering and stable keyset resume", async () => {
      assert.equal((await request(null, "/social/label-queue")).status, 401);
      for (const query of ["limit=101", "cursor=bogus", "status=nope", "tag=bad,tag", "limit=0"]) {
        assert.equal((await request(viewer, `/social/label-queue?${query}`)).status, 400);
      }
      await json(await label(viewer, first.id));
      await json(await label(viewer, draft.id, 0, { reviewStatus: "draft" }));
      await json(await label(viewer, shared.id));
      await json(await label(viewer, revoked.id));
      await json(await label(owner, first.id, 0, { tags: ["other-user-secret"], notes: "OTHER USER SECRET" }));
      // Owner-only paging is independent of pre-existing public development data.
      await db.update(accounts).set({ acceptedAt: null }).where(eq(accounts.userId, viewer));
      const all = await json(await request(viewer, "/social/label-queue?limit=100"));
      assert.equal(all.items.length, 100);
      assert.ok(all.nextCursor);
      const [newUpload] = await db.insert(media).values({
        userId: viewer, title: "New arrival after queue cutoff", originalName: "fixture.png",
        objectKey: `private-storage-SECRET/${prefix}/later`, mediaType: "image", contentType: "image/png", size: 1,
        createdAt: new Date(Date.now() + 10_000),
      }).returning();
      const next = await json(await request(viewer, `/social/label-queue?limit=100&cursor=${all.nextCursor}`));
      assert.equal(next.nextCursor, null);
      const ids = [...all.items, ...next.items].map((r) => r.mediaId);
      assert.equal(ids.length, 105);
      assert.equal(new Set(ids).size, 105);
      assert.equal(ids.includes(secret.id), false);
      assert.equal(ids.includes(newUpload.id), false);
      assert.equal((await request(viewer, `/social/label-queue?status=draft&cursor=${all.nextCursor}`)).status, 400);
      await db.update(accounts).set({ acceptedAt: new Date() }).where(eq(accounts.userId, viewer));
      const reviewed = await json(await request(viewer, "/social/label-queue?status=reviewed&tag=%23AQUA"));
      assert.equal(reviewed.items.length, 3);
      assert.ok(reviewed.items.every((item: any) => item.reviewStatus === "reviewed"));
      const drafts = await json(await request(viewer, "/social/label-queue?status=draft"));
      assert.deepEqual(drafts.items.map((r: any) => r.mediaId), [draft.id]);
      const unlabeled = await json(await request(viewer, "/social/label-queue?status=unlabeled&limit=100"));
      assert.equal(unlabeled.items.length, 100);
      assert.ok(unlabeled.items.every((r: any) => r.revision === 0));
      assert.equal((await json(await request(other, "/social/label-queue?status=reviewed"))).items.length, 0);
    });
    await t.test("exports choose only current reviewed revisions; audit is distinct, private, deterministic and bounded", async () => {
      await json(await label(viewer, first.id, 1, { tags: ["corrected"], notes: "Correction", confidence: "unsure" }));
      const dataset = await create(viewer);
      assert.equal(dataset.manifestVersion, 1);
      assert.equal(dataset.schemaVersion, 1);
      assert.equal(dataset.taxonomyVersion, 1);
      assert.ok(dataset.metadata.taxonomy);
      assert.equal(dataset.status, "reviewed");
      assert.equal(dataset.recordCount, 7); // three current labels plus four audit records
      const page = await readPage(viewer, dataset.id, 0, 1);
      assert.equal(records(page).length, 1);
      assert.equal(page.done, false);
      assert.deepEqual(await readPage(viewer, dataset.id, 0, 1), page);
      let cursor = 0;
      const combined: any[] = [];
      for (let guard = 0; guard < 10; guard++) {
        const part = await readPage(viewer, dataset.id, cursor, 2);
        combined.push(...records(part));
        if (part.done) break;
        assert.ok(part.nextCursor > cursor);
        cursor = part.nextCursor;
      }
      assert.equal(combined.length, 7);
      const current = combined.filter((r) => r.recordType === "current_label");
      assert.equal(current.length, 3);
      assert.equal(current.some((r) => r.mediaId === draft.id), false);
      const corrected = current.find((r) => r.mediaId === first.id);
      assert.equal(corrected.revision, 2);
      assert.deepEqual(corrected.tags, ["corrected"]);
      assert.equal(corrected.confidence, "unsure");
      assert.equal(corrected.provenance.sourceUrl, "https://example.com/art");
      const audit = combined.filter((r) => r.recordType === "audit" && r.mediaId === first.id);
      assert.deepEqual(audit.map((r) => r.revision), [1, 2]);
      assert.ok(audit.every((r) => !("notes" in r) && !("tags" in r)));
      const raw = JSON.stringify(combined);
      for (const forbidden of ["objectKey", "object_key", "private-storage", "OTHER USER", "SECRET", owner, viewer, "rawTags", "progressSeconds"]) {
        assert.equal(raw.includes(forbidden), false, forbidden);
      }
      assert.equal((await request(other, `/social/label-exports/${dataset.id}/rows`)).status, 404);
      assert.equal((await json(await request(other, "/social/label-exports"))).items.length, 0);
      assert.equal((await request(null, `/social/label-exports/${dataset.id}/rows`)).status, 401);
      assert.equal((await request(viewer, `/social/label-exports/${dataset.id}/rows?limit=101`)).status, 400);
      // Later edits, including review status and tag changes, cannot rewrite the snapshot.
      await json(await label(viewer, first.id, 2, { tags: ["new-label"], reviewStatus: "draft" }));
      const frozen = records(await readPage(viewer, dataset.id)).find((r: any) => r.mediaId === first.id && r.recordType === "current_label");
      assert.deepEqual(frozen, corrected);
      // An interrupted client finds the same immutable manifest after reload.
      const listed = await json(await request(viewer, "/social/label-exports"));
      assert.deepEqual(listed.items.find((r: any) => r.id === dataset.id), dataset);
      const resumed = await readPage(viewer, dataset.id, page.nextCursor, 100);
      assert.equal(records(resumed).length, 6);
      assert.equal(resumed.done, true);
    });
    await t.test("new snapshots honor filters and drafts, then privacy/deletion/block/moderation revoke frozen rows", async () => {
      const dataset = await create(viewer, { status: "all", tag: "#AQUA" });
      assert.equal(dataset.recordCount, 6); // draft plus shared and revoked
      const frozen = records(await readPage(viewer, dataset.id));
      assert.equal(frozen.filter((r: any) => r.recordType === "current_label").length, 3);
      await db.update(media).set({ visibility: "private" }).where(eq(media.id, revoked.id));
      let visible = records(await readPage(viewer, dataset.id));
      assert.equal(visible.some((r: any) => r.mediaId === revoked.id), false);
      await db.insert(socialBlocksTable).values({ userId: owner, blockedUserId: viewer });
      visible = records(await readPage(viewer, dataset.id));
      assert.equal(visible.some((r: any) => r.mediaId === shared.id), false);
      await db.delete(socialBlocksTable).where(eq(socialBlocksTable.userId, owner));
      await db.update(media).set({ moderationState: "removed" }).where(eq(media.id, shared.id));
      visible = records(await readPage(viewer, dataset.id));
      assert.equal(visible.some((r: any) => r.mediaId === shared.id), false);
      await db.update(media).set({ moderationState: "active" }).where(eq(media.id, shared.id));
      await db.update(accounts).set({ acceptedAt: null }).where(eq(accounts.userId, viewer));
      visible = records(await readPage(viewer, dataset.id));
      assert.equal(visible.some((r: any) => r.mediaId === shared.id), false);
      await db.delete(media).where(eq(media.id, draft.id));
      assert.equal((await db.select().from(rows).where(eq(rows.mediaId, draft.id))).length, 0);
      // Every candidate is now revoked/deleted: bounded empty pages still advance.
      const firstPage = await readPage(viewer, dataset.id, 0, 1);
      assert.equal(firstPage.jsonl, "");
      assert.ok(firstPage.nextCursor > 0);
      let cursor = firstPage.nextCursor, done = firstPage.done;
      for (let guard = 0; !done && guard < 10; guard++) {
        const next = await readPage(viewer, dataset.id, cursor, 1);
        assert.equal(next.jsonl, "");
        assert.ok(next.nextCursor > cursor);
        cursor = next.nextCursor; done = next.done;
      }
      assert.equal(done, true);
      await db.update(exports).set({ expiresAt: new Date(0) }).where(eq(exports.id, dataset.id));
      assert.equal((await request(viewer, `/social/label-exports/${dataset.id}/rows`)).status, 404);
      assert.equal((await json(await request(viewer, "/social/label-exports"))).items.some((r: any) => r.id === dataset.id), false);
    });
    await t.test("own private media remains exportable; another account's empty dataset cannot inherit labels", async () => {
      await json(await label(owner, secret.id));
      const dataset = await create(owner);
      const mine = records(await readPage(owner, dataset.id)).filter((r: any) => r.recordType === "current_label");
      assert.ok(mine.some((r: any) => r.mediaId === secret.id));
      assert.ok(mine.every((r: any) => r.mediaId === secret.id || r.mediaId === first.id));
      const empty = await create(other);
      assert.equal(empty.recordCount, 0);
      assert.deepEqual(await readPage(other, empty.id), { jsonl: "", nextCursor: 0, done: true });
      assert.equal((await request(other, `/social/label-exports/${dataset.id}/rows`)).status, 404);
      assert.equal((await request(owner, "/social/label-exports", "POST", { status: "unlabeled" })).status, 400);
    });
  } finally {
    await db.delete(exports).where(inArray(exports.userId, users));
    await db.delete(socialBlocksTable).where(inArray(socialBlocksTable.userId, users));
    await db.delete(media).where(inArray(media.userId, users));
    await db.delete(accounts).where(inArray(accounts.userId, users));
    await db.delete(socialRateLimitsTable).where(like(socialRateLimitsTable.key, `${prefix}%`));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
});
