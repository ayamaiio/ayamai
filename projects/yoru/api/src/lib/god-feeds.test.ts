import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, pool, mediaItemsTable as media, accessMembershipsTable as access,
  socialAccountsTable as accounts, blocksTable as blocks, watchSignalsTable as signals,
  watchFeedSessionsTable as sessions } from "@workspace/db";
import { socialFeed } from "./social-feed";
import { accessibleMedia } from "./social-access";
import watchRouter from "../routes/watch";
import { GetWatchFeedResponse } from "@workspace/api-zod";

test("GOD feed cycles cover all active media without publishing it or relaxing member access", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.equal(pool.totalCount, 0);
  const schema = `god_feeds_${randomUUID().replaceAll("-", "")}`;
  pool.options.options = `-c search_path=${schema},pg_catalog`;
  const god = "verified-owner", member = "itachi", legacy = "restored-uploader", creator = "public-creator";
  const stamp = new Date("2020-01-01");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId, tokenType: "session_token" }),
      { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  app.use(watchRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, user: string | null = god) => fetch(base + path, {
    headers: user ? { "x-test-user": user } : {},
  });
  const cycle = async (user: string, lane = "for-you", type = "all", tag = "") => {
    const sessionId = randomUUID(), ids: string[] = [];
    let offset = 0;
    while (true) {
      const page = await socialFeed(user, sessionId, lane, type, offset, tag);
      ids.push(...page.items.map(p => p.id));
      if (!page.hasMore) break;
      assert.ok(page.nextOffset > offset);
      offset = page.nextOffset;
    }
    assert.equal(new Set(ids).size, ids.length, "no duplicate parent posts across pages");
    return { sessionId, ids };
  };
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const tables = await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of tables.rows) {
      assert.match(tablename, /^[a-z][a-z0-9_]*$/);
      await pool.query(`CREATE TABLE "${schema}"."${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`);
    }
    await db.insert(access).values([
      { userId: god, email: "god@example.invalid", role: "owner", status: "active" },
      { userId: member, email: "member@example.invalid", role: "member", status: "active" },
    ]);
    await db.insert(accounts).values([god, member, creator].map(userId => ({ userId, acceptedAt: stamp })));
    const attachment = { id: randomUUID(), objectKey: "synthetic/extra", originalName: "extra.jpg", contentType: "image/jpeg", size: 1 };
    const rows = await db.insert(media).values(Array.from({ length: 1105 }, (_, i) => ({
      userId: i === 0 ? god : i === 1 ? member : legacy,
      title: `Synthetic ${i}`, originalName: `${i}.jpg`, objectKey: `synthetic/${i}`,
      contentType: i % 2 ? "video/mp4" : "image/jpeg", mediaType: i % 2 ? "video" : "image", size: 1,
      createdAt: stamp, tags: i === 2 ? ["keep-me"] : [],
      galleryImages: i === 2 ? [attachment] : [],
    }))).returning();
    const [publicPost, noRights, noAcceptance, removed] = await db.insert(media).values([
      { userId: creator, visibility: "public", rightsConfirmedAt: stamp },
      { userId: creator, visibility: "public", rightsConfirmedAt: null },
      { userId: legacy, visibility: "public", rightsConfirmedAt: stamp },
      { userId: legacy, visibility: "public", rightsConfirmedAt: stamp, moderationState: "removed" },
    ].map((r, i) => ({ ...r, title: "Synthetic public", originalName: "public.jpg", objectKey: `synthetic/public/${i}`,
      contentType: "image/jpeg", mediaType: "image", size: 1 }))).returning();
    await db.insert(signals).values({ userId: god, mediaId: rows[2].id, reaction: "dislike" });
    await db.insert(blocks).values({ userId: legacy, blockedUserId: god });
    const expected = [...rows, publicPost, noRights, noAcceptance].map(r => r.id);
    await t.test("full catalog exceeds the former 1,000-candidate ceiling in both social lanes", async () => {
      for (const lane of ["for-you", "collection"]) {
        const result = await cycle(god, lane);
        assert.deepEqual(new Set(result.ids), new Set(expected));
        assert.ok(!result.ids.includes(removed.id));
        const page = await socialFeed(god, result.sessionId, lane, "all", 0);
        assert.deepEqual(page.items.map(p => p.id), result.ids.slice(0, 24));
      }
      const gallery = await socialFeed(god, randomUUID(), "for-you", "image", 0, "keep-me");
      assert.deepEqual(gallery.items.map(p => p.id), [rows[2].id]);
      assert.equal(gallery.items[0].attachments.length, 2);
      assert.equal(gallery.items[0].visibility, "private");
      assert.equal(gallery.items[0].isOwner, false);
      assert.equal((await cycle(god, "for-you", "video")).ids.length, rows.filter(r => r.mediaType === "video").length);
      assert.equal((await accessibleMedia(rows[2].id, god)).userId, legacy);
      await assert.rejects(accessibleMedia(removed.id, god), { status: 404 });
    });
    await t.test("members retain visibility, rights, uploader acceptance, blocks and dislike restrictions", async () => {
      assert.deepEqual((await cycle(member)).ids, [publicPost.id]);
      assert.deepEqual((await cycle(member, "collection")).ids, [rows[1].id]);
      await assert.rejects(accessibleMedia(rows[2].id, member), { status: 404 });
      await db.insert(signals).values({ userId: member, mediaId: publicPost.id, reaction: "dislike" });
      assert.deepEqual((await cycle(member)).ids, []);
      await db.delete(signals).where(eq(signals.userId, member));
      await db.insert(blocks).values({ userId: creator, blockedUserId: member });
      assert.deepEqual((await cycle(member)).ids, []);
      await assert.rejects(socialFeed("unaccepted", randomUUID(), "for-you", "all", 0), { status: 403 });
    });
    await t.test("deleted and moderated slots cannot strand pagination on an empty page", async () => {
      const result = await cycle(god);
      await db.delete(media).where(inArray(media.id, result.ids.slice(0, 25)));
      await db.update(media).set({ moderationState: "removed" }).where(inArray(media.id, result.ids.slice(25, 50)));
      const page = await socialFeed(god, result.sessionId, "for-you", "all", 0);
      assert.deepEqual(page.items.map(p => p.id), result.ids.slice(50, 74));
      assert.equal(page.nextOffset, 74);
      const next = await socialFeed(god, result.sessionId, "for-you", "all", page.nextOffset);
      assert.deepEqual(next.items.map(p => p.id), result.ids.slice(74, 98));
      await assert.rejects(socialFeed(member, result.sessionId, "for-you", "all", 0), { status: 409 });
      await assert.rejects(socialFeed(god, result.sessionId, "collection", "all", 0), { status: 409 });
      assert.equal((await request(`/watch/feed?sessionId=${result.sessionId}`)).status, 409);
    });
    await t.test("legacy Watch uses global read scope and prevents session/account confusion", async () => {
      const id = randomUUID();
      const response = await request(`/watch/feed?sessionId=${id}&limit=24`);
      assert.equal(response.status, 200);
      const first = GetWatchFeedResponse.parse(await response.json());
      const remaining = await db.select().from(media).where(eq(media.moderationState, "active"));
      assert.equal(first.total, remaining.length);
      const seen = [...first.items.map((p: { id: string }) => p.id)];
      for (let offset = 24; offset < first.total; offset += 24) {
        const page = GetWatchFeedResponse.parse(await (await request(`/watch/feed?sessionId=${id}&limit=24&offset=${offset}`)).json());
        seen.push(...page.items.map((p: { id: string }) => p.id));
      }
      assert.deepEqual(new Set(seen), new Set(remaining.map(r => r.id)));
      assert.equal(seen.length, remaining.length);
      assert.equal((await request(`/watch/feed?sessionId=${id}`, member)).status, 409);
      assert.equal((await request(`/watch/feed?sessionId=${randomUUID()}`, null)).status, 401);
      const ordinary = GetWatchFeedResponse.parse(await (await request(`/watch/feed?sessionId=${randomUUID()}`, member)).json());
      assert.ok(ordinary.items.every((p: { id: string }) => p.id === rows[1].id));
      const foreign = remaining.find(r => r.userId === legacy)!;
      assert.equal((await request(`/watch/media/${foreign.id}/reaction`)).status, 200);
      assert.equal((await request(`/watch/media/${foreign.id}/reaction`, member)).status, 404);
    });
    await t.test("revoking GOD or replacing it with admin immediately closes stored feed access", async () => {
      const first = await cycle(god);
      await db.update(access).set({ role: "admin" }).where(eq(access.userId, god));
      const page = await socialFeed(god, first.sessionId, "for-you", "all", 0);
      assert.ok(page.items.every(p => p.id === publicPost.id));
      await db.update(access).set({ role: "owner", status: "revoked" }).where(eq(access.userId, god));
      const revoked = await socialFeed(god, first.sessionId, "for-you", "all", 0);
      assert.ok(revoked.items.every(p => p.id === publicPost.id));
      const foreign = rows.find(r => first.ids.includes(r.id) && r.userId === legacy)!;
      await assert.rejects(accessibleMedia(foreign.id, god), { status: 404 });
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});
