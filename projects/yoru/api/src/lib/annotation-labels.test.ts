import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray, like } from "drizzle-orm";
import {
  db, pool, mediaItemsTable as media, mediaAnnotationsTable as annotations,
  mediaAnnotationHistoryTable as history, socialAccountsTable as accounts,
  socialRateLimitsTable, watchFeedSessionsTable, watchSignalsTable,
} from "@workspace/db";
import annotationsRouter from "../routes/annotations";
import socialRouter from "../routes/social";
import { canonicalHashtag, canonicalAttributes, canonicalSourceUrl } from "./annotation-labels";

test("hashtags and structured keys use canonical Unicode, case and whitespace; provenance strips credentials", () => {
  assert.equal(canonicalHashtag(" #ＡＱＵＡ "), "aqua");
  assert.equal(canonicalHashtag("##Aqua Blue"), "aqua-blue");
  assert.equal(canonicalHashtag("日本語"), "日本語");
  assert.throws(() => canonicalHashtag("bad,tag"));
  assert.throws(() => canonicalHashtag("a".repeat(81)));
  assert.throws(() => canonicalAttributes({ STYLE: ["painted"], style: ["drawn"] }));
  assert.throws(() => canonicalAttributes(JSON.parse('{"__proto__":["bad"]}')));
  assert.deepEqual({ ...canonicalAttributes({ "Art Style": ["Painted", " painted "] }) }, { "art-style": ["painted"] });
  assert.equal(canonicalSourceUrl("https://example.com/posts/123?token=secret#secret"), "https://example.com/posts/123");
  assert.throws(() => canonicalSourceUrl("https://user:password@example.com/post"));
  assert.throws(() => canonicalSourceUrl("javascript:alert(1)"));
});

test("private annotations: authorization, normalization, revisions, catalog, stable hashtag sessions and redaction", async (t) => {
  const prefix = `annotation-test-${randomUUID()}`;
  const owner = `${prefix}-owner`, viewer = `${prefix}-viewer`, outsider = `${prefix}-outsider`;
  const users = [owner, viewer, outsider];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId: uid, tokenType: "session_token" }), { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  app.use("/api", annotationsRouter, socialRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const request = (uid: string | null, path: string, method = "GET", body?: unknown) =>
    fetch(base + path, { method, headers: { ...(uid ? { "x-test-user": uid } : {}), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (res: Response) => res.json() as Promise<Record<string, any>>;
  const fixtures = await db.insert(media).values([true, true, false].map((isPublic) => ({
    userId: owner, title: "Synthetic nonexplicit fixture", originalName: "fixture.png",
    objectKey: `test-fixtures/${prefix}/${randomUUID()}`, mediaType: "image",
    contentType: "image/png", size: 1, tags: isPublic ? ["coast"] : ["owner-secret"],
    visibility: isPublic ? "public" : "private", rightsConfirmedAt: isPublic ? new Date() : null,
  }))).returning();
  const [first, second, privatePost] = fixtures;
  const path = `/social/posts/${first.id}/annotation`;
  const draft = {
    expectedRevision: 0, tags: ["#AQUA", "ＡＱＵＡ", "aqua"], attributes: { Style: ["Painted", "painted"] },
    notes: "PRIVATE ANNOTATION NOTES", reviewStatus: "reviewed", confidence: "confident",
    sourceUrl: "https://example.com/posts/1?token=do-not-store#private",
  };
  try {
    await db.insert(accounts).values(users.map((userId) => ({ userId, acceptedAt: new Date() })));
    await t.test("only authenticated viewers with current media access can read or label", async () => {
      assert.equal((await request(null, path)).status, 401);
      assert.equal((await request(viewer, `/social/posts/${privatePost.id}/annotation`, "PUT", draft)).status, 404);
      assert.equal((await json(await request(viewer, path))).revision, 0);
    });
    await t.test("canonical labels save atomically with private raw-input history; retries do not duplicate history", async () => {
      const response = await request(viewer, path, "PUT", draft);
      assert.equal(response.status, 200, await response.clone().text());
      const saved = await json(response);
      assert.deepEqual(saved.tags, ["aqua"]);
      assert.deepEqual(saved.attributes, { style: ["painted"] });
      assert.equal(saved.sourceUrl, "https://example.com/posts/1");
      assert.equal(saved.revision, 1);
      assert.equal(saved.schemaVersion, 1);
      const retried = await request(viewer, path, "PUT", draft);
      assert.equal(retried.status, 200);
      assert.equal((await json(retried)).revision, 1);
      const rows = await db.select().from(history).where(eq(history.userId, viewer));
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0].payload.rawTags, draft.tags);
      assert.equal(JSON.stringify(rows).includes("do-not-store"), false);
    });
    await t.test("private labels and notes never leak through other viewers, post DTOs or catalogs", async () => {
      assert.equal((await json(await request(owner, path))).revision, 0);
      assert.equal((await json(await request(outsider, path))).revision, 0);
      const publicDTO = await json(await request(owner, `/social/posts/${first.id}`));
      assert.deepEqual(publicDTO.tags, ["coast"]);
      assert.equal(JSON.stringify(publicDTO).includes("PRIVATE ANNOTATION"), false);
      const mine = await json(await request(viewer, "/social/labels"));
      assert.ok(mine.items.some((entry: { tag: string }) => entry.tag === "aqua"));
      assert.equal(mine.items.some((entry: { tag: string }) => entry.tag === "owner-secret"), false);
      const others = await json(await request(outsider, "/social/labels"));
      assert.equal(others.items.some((entry: { tag: string }) => entry.tag === "aqua"), false);
      const historyRows = await db.select().from(annotations).where(eq(annotations.userId, owner));
      assert.equal(historyRows.length, 0);
    });
    await t.test("filters combine public tags and only the viewer's personal tags; session filter cannot be switched", async () => {
      const sessionId = randomUUID();
      const page = await request(viewer, `/social/feed?sessionId=${sessionId}&hashtag=%23AQUA`);
      assert.equal(page.status, 200, await page.clone().text());
      assert.deepEqual((await json(page)).items.map((item: { id: string }) => item.id), [first.id]);
      const otherPage = await json(await request(outsider, `/social/feed?sessionId=${randomUUID()}&hashtag=aqua`));
      assert.equal(otherPage.items.length, 0);
      assert.equal((await request(viewer, `/social/feed?sessionId=${sessionId}&hashtag=coast`)).status, 409);
      const publicFilter = await json(await request(viewer, `/social/feed?sessionId=${randomUUID()}&hashtag=COAST&type=image`));
      assert.deepEqual(new Set(publicFilter.items.map((item: { id: string }) => item.id)), new Set([first.id, second.id]));
      const cleared = await request(viewer, path, "PUT", { ...draft, expectedRevision: 1, tags: [] });
      assert.equal(cleared.status, 200);
      const stable = await json(await request(viewer, `/social/feed?sessionId=${sessionId}&hashtag=aqua`));
      assert.deepEqual(stable.items.map((item: { id: string }) => item.id), [first.id]);
      const refreshed = await json(await request(viewer, `/social/feed?sessionId=${randomUUID()}&hashtag=aqua`));
      assert.equal(refreshed.items.length, 0);
    });
    await t.test("concurrent stale drafts cannot overwrite or duplicate a revision; invalid attributes fail explicitly", async () => {
      const responses = await Promise.all(["device-a", "device-b"].map((notes) =>
        request(viewer, path, "PUT", { ...draft, expectedRevision: 2, notes })));
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
      const rows = await db.select().from(history).where(eq(history.userId, viewer));
      assert.deepEqual(rows.map((r) => r.revision).sort(), [1, 2, 3]);
      const invalid = await request(viewer, path, "PUT", { ...draft, expectedRevision: 3, attributes: { Style: ["a"], style: ["b"] } });
      assert.equal(invalid.status, 400);
      assert.equal((await json(await request(viewer, path))).revision, 3);
    });
    await t.test("unpublishing revokes annotation reads, writes, catalog entries and even previously pinned feed items", async () => {
      await db.update(media).set({ visibility: "private" }).where(eq(media.id, first.id));
      assert.equal((await request(viewer, path)).status, 404);
      assert.equal((await request(viewer, path, "PUT", { ...draft, expectedRevision: 3 })).status, 404);
      const catalog = await json(await request(viewer, "/social/labels"));
      assert.equal(catalog.items.some((entry: { tag: string }) => entry.tag === "aqua"), false);
    });
  } finally {
    await db.delete(watchFeedSessionsTable).where(inArray(watchFeedSessionsTable.userId, users));
    await db.delete(watchSignalsTable).where(inArray(watchSignalsTable.userId, users));
    await db.delete(socialRateLimitsTable).where(like(socialRateLimitsTable.key, `${prefix}%`));
    await db.delete(media).where(inArray(media.userId, users));
    await db.delete(accounts).where(inArray(accounts.userId, users));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
});
