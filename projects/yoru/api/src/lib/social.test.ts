import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  db, pool, mediaItemsTable as media, socialAccountsTable as accounts, profilesTable,
  commentsTable, blocksTable, reportsTable, savedPostsTable, socialRateLimitsTable,
  socialEventsTable, watchSignalsTable as signals, watchFeedSessionsTable, watchSettingsTable, membersTable, accessMembershipsTable,
} from "@workspace/db";
import socialRouter from "../routes/social";
import mediaRouter from "../routes/media";
import streamsRouter from "../routes/media-stream";
import edgeMediaRouter from "../routes/edge-media";
import { sharedMediaUrl } from "./shared-delivery";
import { postValues } from "./social-access";
import { openMediaTicket, createMediaTicket } from "./media-tickets";
import { recordSocialTelemetry } from "./social-telemetry";
import { collaborativeData } from "./social-feed";

test("shared-post access, anonymity, social mutations and telemetry", async (t) => {
  const prefix = `social-test-${randomUUID()}`, owner = `${prefix}-owner`, viewer = `${prefix}-viewer`, other = `${prefix}-other`, minor = `${prefix}-ungated`;
  const users = [owner, viewer, other, minor], originalMods = process.env.SOCIAL_MODERATOR_USER_IDS;
  await db.insert(membersTable).values(users.map((userId) => ({ userId, source: "legacy" })));
  const originalEdgeSecret = process.env.SHARED_MEDIA_EDGE_SECRET, originalEdgeOrigin = process.env.SHARED_MEDIA_EDGE_ORIGIN;
  // Isolated synthetic service credential; never touches real Worker configuration.
  process.env.SHARED_MEDIA_EDGE_SECRET = randomUUID();
  delete process.env.SHARED_MEDIA_EDGE_ORIGIN;
  process.env.SOCIAL_MODERATOR_USER_IDS = other;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId: uid, tokenType: "session_token" }), { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  app.use("/api", edgeMediaRouter, streamsRouter, socialRouter, mediaRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const request = (uid: string | null, path: string, method = "GET", body?: unknown) =>
    fetch(base + path, { method, headers: { ...(uid ? { "x-test-user": uid } : {}), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (response: Response) => await response.json() as Record<string, any>;
  const posting = { visibility: "public", attribution: "anonymous", description: "Harmless synthetic fixture", tags: ["Coast", " coast ", "#LANDSCAPE"], rightsConfirmed: true };
  const fixtures = await db.insert(media).values(Array.from({ length: 30 }, (_, i) => ({
    userId: owner, title: `PRIVATE TITLE ${i}`, originalName: `PRIVATE-NAME-${i}.png`, objectKey: `test-fixtures/${owner}/${randomUUID()}`,
    mediaType: "image", contentType: "image/png", size: 1,
  }))).returning();
  const item = fixtures[0], another = fixtures[1], privateItem = fixtures[2];
  let commentId = "", sessionId = randomUUID(), nextOffset = 0;
  try {
    // Stream authorization independently requires an active app membership.
    await db.insert(accessMembershipsTable).values(users.map((userId) => ({
      userId, email: `${userId}@example.invalid`, role: "member", status: "active",
    })));
    await t.test("old uploads and omitted posting stay private; sign-in and age gates work", async () => {
      assert.deepEqual(await postValues(owner, undefined), {});
      assert.equal(item.visibility, "private");
      assert.equal((await request(null, "/social/me")).status, 401);
      assert.equal((await request(viewer, `/social/posts/${item.id}`)).status, 404);
      assert.equal((await request(owner, `/social/posts/${item.id}`, "PATCH", posting)).status, 403);
      assert.equal((await request(minor, `/social/feed?sessionId=${randomUUID()}`)).status, 403);
      assert.equal((await request(owner, `/social/posts/${item.id}`)).status, 200);
      for (const uid of [owner, viewer, other]) assert.equal((await request(uid, "/social/me", "PATCH", { adultConfirmed: true, policyAccepted: true })).status, 200);
      assert.equal((await json(await request(owner, "/social/me"))).collaborativeConsent, false);
    });
    await t.test("publishing is explicit, requires rights, normalizes tags and cannot publish someone else's file", async () => {
      assert.equal((await request(owner, `/social/posts/${item.id}`, "PATCH", { ...posting, rightsConfirmed: false })).status, 400);
      assert.equal((await request(owner, `/social/posts/${item.id}`, "PATCH", { ...posting, attribution: "profile" })).status, 400);
      assert.equal((await request(viewer, `/social/posts/${item.id}`, "PATCH", posting)).status, 404);
      for (const f of fixtures.filter((m) => m.id !== privateItem.id)) assert.equal((await request(owner, `/social/posts/${f.id}`, "PATCH", posting)).status, 200);
      const data = await json(await request(viewer, `/social/posts/${item.id}`));
      assert.deepEqual(data.tags, ["coast", "landscape"]);
      assert.equal(data.profile, null);
      for (const secret of [owner, "PRIVATE TITLE", "PRIVATE-NAME", "objectKey", "userId", "originalName"]) assert.ok(!JSON.stringify(data).includes(secret));
    });
    await t.test("anonymous posts have opaque URLs and tickets cannot be swapped or tampered with", async () => {
      const data = await json(await request(viewer, `/media/${item.id}/view-url`));
      assert.ok(data.url.startsWith(`/api/streams/${item.id}?ticket=`));
      assert.ok(!data.url.includes(owner)); assert.ok(!data.url.includes(viewer)); assert.ok(!data.url.includes("cloudflarestorage"));
      const ticket = new URL(data.url, base).searchParams.get("ticket")!;
      assert.equal(openMediaTicket(item.id, ticket), viewer);
      assert.equal(openMediaTicket(another.id, ticket), null);
      assert.equal(openMediaTicket(item.id, ticket.slice(0, -5) + "xxxxx"), null);
      assert.equal((await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}${data.url}`, { headers: { Range: "bytes=0-2,5-8" } })).status, 416);
      assert.equal((await request(minor, `/media/${item.id}/view-url`)).status, 403);
      assert.equal((await request(viewer, `/media/${privateItem.id}/view-url`)).status, 404);
    });
    await t.test("edge grants require service credentials and recheck all shared eligibility with old tickets", async () => {
      const ticket = createMediaTicket(item.id, viewer);
      const grant = (id = item.id, value = ticket, secret = process.env.SHARED_MEDIA_EDGE_SECRET) =>
        fetch(base + "/edge/media-authorize", { method: "POST", headers: {
          "Content-Type": "application/json", "X-Edge-Authorization": `Bearer ${secret}`,
        }, body: JSON.stringify({ id, ticket: value }) });
      assert.equal((await grant(item.id, ticket, "wrong")).status, 404);
      assert.equal((await grant(another.id)).status, 404);
      assert.equal((await grant(item.id, ticket.slice(0, -8) + "tampered")).status, 404);
      assert.equal((await grant(item.id, createMediaTicket(item.id, minor))).status, 404);
      let response = await grant();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.deepEqual(await response.json(), { objectKey: item.objectKey, contentType: item.contentType });
      for (const patch of [
        { visibility: "private" as const }, { moderationState: "removed" as const }, { rightsConfirmedAt: null },
      ]) {
        await db.update(media).set(patch).where(eq(media.id, item.id));
        assert.equal((await grant()).status, 404);
        await db.update(media).set({ visibility: "public", moderationState: "active", rightsConfirmedAt: new Date() }).where(eq(media.id, item.id));
      }
      for (const uid of [owner, viewer]) {
        await db.update(accounts).set({ acceptedAt: null }).where(eq(accounts.userId, uid));
        assert.equal((await grant()).status, 404);
        // Even an owner's ticket may not bypass the shared age gate.
        if (uid === owner) assert.equal((await grant(item.id, createMediaTicket(item.id, owner))).status, 404);
        await db.update(accounts).set({ acceptedAt: new Date() }).where(eq(accounts.userId, uid));
      }
      for (const [from, to] of [[owner, viewer], [viewer, owner]]) {
        await db.insert(blocksTable).values({ userId: from, blockedUserId: to });
        assert.equal((await grant()).status, 404);
        await db.delete(blocksTable).where(and(eq(blocksTable.userId, from), eq(blocksTable.blockedUserId, to)));
      }
      const [deleted] = await db.insert(media).values({
        userId: owner, title: "Synthetic deletion", originalName: "fixture.mp4", objectKey: `test-fixtures/${owner}/edge-delete`,
        mediaType: "video", contentType: "video/mp4", size: 1, visibility: "public", rightsConfirmedAt: new Date(),
      }).returning();
      const deletedTicket = createMediaTicket(deleted.id, viewer);
      assert.equal((await grant(deleted.id, deletedTicket)).status, 200);
      await db.delete(media).where(eq(media.id, deleted.id));
      assert.equal((await grant(deleted.id, deletedTicket)).status, 404);
      process.env.SHARED_MEDIA_EDGE_ORIGIN = "https://opaque-edge.example";
      const edgeUrl = sharedMediaUrl("/api", item.id, viewer);
      assert.equal(new URL(edgeUrl).origin, "https://opaque-edge.example");
      assert.ok(!edgeUrl.includes(owner)); assert.ok(!edgeUrl.includes(viewer)); assert.ok(!edgeUrl.includes(item.objectKey));
      process.env.SHARED_MEDIA_EDGE_ORIGIN = "http://unsafe.example";
      assert.throws(() => sharedMediaUrl("/api", item.id, viewer));
      delete process.env.SHARED_MEDIA_EDGE_ORIGIN;
      assert.equal((await grant()).status, 200);
    });
    await t.test("concurrent likes are idempotent, reversible, and independent from Saved", async () => {
      await Promise.all(Array.from({ length: 6 }, () => request(viewer, `/social/posts/${item.id}/action`, "POST", { action: "like" })));
      let post = await json(await request(viewer, `/social/posts/${item.id}`));
      assert.equal(post.likeCount, 1); assert.equal(post.reaction, "like"); assert.equal(post.isSaved, false);
      await request(viewer, `/social/posts/${item.id}/action`, "POST", { action: "save" });
      await request(viewer, `/social/posts/${item.id}/action`, "POST", { action: "clear-reaction" });
      post = await json(await request(viewer, `/social/posts/${item.id}`));
      assert.equal(post.likeCount, 0); assert.equal(post.isSaved, true);
      await request(viewer, `/social/posts/${item.id}/action`, "POST", { action: "unsave" });
      assert.equal((await json(await request(viewer, `/social/posts/${item.id}`))).isSaved, false);
    });
    await t.test("private likes never become shared-training signals merely because the post is published", async () => {
      await request(owner, `/social/posts/${privateItem.id}/action`, "POST", { action: "like" });
      await request(owner, `/social/posts/${privateItem.id}`, "PATCH", posting);
      const post = await json(await request(viewer, `/social/posts/${privateItem.id}`));
      assert.equal(post.likeCount, 0);
      const [s] = await db.select().from(signals).where(and(eq(signals.userId, owner), eq(signals.mediaId, privateItem.id)));
      assert.equal(s.publicReaction, false);
      await request(owner, `/social/posts/${privateItem.id}`, "PATCH", { ...posting, visibility: "private", rightsConfirmed: false });
    });
    await t.test("private-context comments and their counts never become shared when media is published", async () => {
      const requestId = randomUUID(), privateText = "Private note, never authorized for disclosure";
      assert.equal((await request(owner, `/social/posts/${privateItem.id}/comments`, "POST", { requestId, text: privateText })).status, 201);
      assert.equal((await json(await request(owner, `/social/posts/${privateItem.id}`))).commentCount, 1);
      assert.equal((await json(await request(owner, `/social/posts/${privateItem.id}/comments`))).comments[0].text, privateText);
      await request(owner, `/social/posts/${privateItem.id}`, "PATCH", posting);
      for (const uid of [viewer, owner]) {
        assert.deepEqual((await json(await request(uid, `/social/posts/${privateItem.id}/comments`))).comments, []);
        assert.equal((await json(await request(uid, `/social/posts/${privateItem.id}`))).commentCount, 0);
      }
      const shared = await json(await request(viewer, `/social/posts/${privateItem.id}/comments`, "POST", { requestId: randomUUID(), text: "Deliberately shared comment" }));
      assert.deepEqual((await json(await request(viewer, `/social/posts/${privateItem.id}/comments`))).comments.map((c: any) => c.id), [shared.id]);
      assert.equal((await json(await request(viewer, `/social/posts/${privateItem.id}`))).commentCount, 1);
      // An old private delivery retry must not upgrade its original visibility context.
      await request(owner, `/social/posts/${privateItem.id}/comments`, "POST", { requestId, text: privateText });
      assert.equal((await json(await request(viewer, `/social/posts/${privateItem.id}`))).commentCount, 1);
      await request(owner, `/social/posts/${privateItem.id}`, "PATCH", { ...posting, visibility: "private", rightsConfirmed: false });
      assert.equal((await json(await request(owner, `/social/posts/${privateItem.id}/comments`))).comments.length, 2);
      assert.equal((await request(viewer, `/social/posts/${privateItem.id}/comments`)).status, 404);
      // Restore the fixture so later pagination assertions retain the same candidate count.
      await request(owner, `/social/comments/${shared.id}`, "DELETE");
    });
    await t.test("comments are retry-safe, anonymous, escaped as text, and deletable only by author or post owner", async () => {
      const requestId = randomUUID();
      const replies = await Promise.all(Array.from({ length: 3 }, () => request(viewer, `/social/posts/${item.id}/comments`, "POST", { requestId, text: "<script>plain text</script>" })));
      const bodies = await Promise.all(replies.map(json));
      assert.equal(new Set(bodies.map((b) => b.id)).size, 1); commentId = bodies[0].id;
      assert.equal((await request(viewer, `/social/posts/${item.id}/comments`, "POST", { requestId, text: "Different text" })).status, 409);
      const page = await json(await request(other, `/social/posts/${item.id}/comments`));
      assert.equal(page.comments.length, 1); assert.equal(page.comments[0].canDelete, false);
      assert.ok(!JSON.stringify(page).includes(viewer)); assert.ok(!JSON.stringify(page).includes(owner));
      assert.equal((await request(other, `/social/comments/${commentId}`, "DELETE")).status, 404);
      assert.equal((await request(owner, `/social/comments/${commentId}`, "DELETE")).status, 204);
      assert.equal((await json(await request(viewer, `/social/posts/${item.id}`))).commentCount, 0);
    });
    await t.test("profiles include only chosen named public posts, not anonymous or private uploads", async () => {
      const p = await json(await request(owner, "/social/profile", "PUT", { handle: `test_${randomUUID().slice(0, 8)}`, displayName: "Synthetic pseudonym", bio: "Synthetic fixture" }));
      await request(owner, `/social/posts/${another.id}`, "PATCH", { ...posting, attribution: "profile" });
      const page = await json(await request(viewer, `/social/profiles/${p.id}`));
      assert.equal(page.posts.length, 1); assert.equal(page.posts[0].id, another.id);
      assert.ok(!JSON.stringify(page).includes(owner));
      assert.equal((await json(await request(viewer, `/social/posts/${item.id}`))).profile, null);
    });
    await t.test("feed sessions have stable pages, type filters, no duplicates and immediate dislike/privacy removal", async () => {
      const path = `/social/feed?sessionId=${sessionId}&type=image`;
      const first = await json(await request(viewer, path));
      assert.equal(first.items.length, 24); nextOffset = first.nextOffset;
      assert.deepEqual((await json(await request(viewer, path))).items.map((i: any) => i.id), first.items.map((i: any) => i.id));
      const last = await json(await request(viewer, path + `&offset=${nextOffset}`));
      // The development DB may already contain public posts; assert only our fixtures.
      const fixtureIds = new Set(fixtures.map(m => m.id));
      assert.equal(new Set([...first.items, ...last.items].filter((i: any) => fixtureIds.has(i.id)).map((i: any) => i.id)).size, 29);
      assert.equal((await request(other, path)).status, 409);
      await request(viewer, `/social/posts/${item.id}/action`, "POST", { action: "dislike" });
      const updated = await json(await request(viewer, path));
      assert.ok(!updated.items.some((i: any) => i.id === item.id));
      await request(viewer, `/social/posts/${item.id}/action`, "POST", { action: "clear-reaction" });
      await request(owner, `/social/posts/${item.id}`, "PATCH", { ...posting, visibility: "private", rightsConfirmed: false });
      assert.equal((await request(viewer, `/social/posts/${item.id}`)).status, 404);
      assert.equal((await request(viewer, `/social/posts/${item.id}/comments`)).status, 404);
      assert.equal((await fetch(base + `/streams/${item.id}?ticket=${createMediaTicket(item.id, viewer)}`)).status, 404);
      await request(owner, `/social/posts/${item.id}`, "PATCH", posting);
    });
    await t.test("collaborative ranking requires consent, public-context feedback, eligible public media and five supporting peers", async () => {
      const peers = Array.from({ length: 5 }, (_, i) => `${prefix}-peer-${i}`); users.push(...peers);
      await db.insert(membersTable).values(peers.map((userId) => ({ userId, source: "legacy" })));
      await db.insert(accounts).values([...peers, viewer].map((userId) => ({ userId, acceptedAt: new Date(), collaborativeConsent: true })))
        .onConflictDoUpdate({ target: accounts.userId, set: { collaborativeConsent: true } });
      const seeds = fixtures.slice(8, 11), target = fixtures[11];
      await db.insert(signals).values(seeds.map((m) => ({ userId: viewer, mediaId: m.id, reaction: "like", publicReaction: true }))).onConflictDoNothing();
      await db.insert(signals).values(peers.flatMap((userId) => [...seeds, target].map((m) => ({
        userId, mediaId: m.id, reaction: "like", publicReaction: true,
      }))));
      let data = await collaborativeData(viewer);
      assert.ok((data.collaborative.get(target.id) ?? 0) > 0);
      assert.equal(data.popularity.get(target.id)?.support, 5);
      await db.update(accounts).set({ collaborativeConsent: false }).where(eq(accounts.userId, peers[0]));
      data = await collaborativeData(viewer);
      assert.equal(data.collaborative.has(target.id), false); assert.equal(data.popularity.has(target.id), false);
      await db.update(accounts).set({ collaborativeConsent: true }).where(eq(accounts.userId, peers[0]));
      await db.update(signals).set({ publicReaction: false }).where(and(eq(signals.userId, peers[0]), eq(signals.mediaId, target.id)));
      assert.equal((await collaborativeData(viewer)).popularity.has(target.id), false);
      await db.update(signals).set({ publicReaction: true }).where(and(eq(signals.userId, peers[0]), eq(signals.mediaId, target.id)));
      await db.update(media).set({ visibility: "private" }).where(eq(media.id, target.id));
      data = await collaborativeData(viewer);
      assert.equal(data.collaborative.has(target.id), false); assert.equal(data.popularity.has(target.id), false);
      await db.update(media).set({ visibility: "public" }).where(eq(media.id, target.id));
      await db.insert(blocksTable).values({ userId: viewer, blockedUserId: owner });
      data = await collaborativeData(viewer);
      assert.equal(data.collaborative.has(target.id), false); assert.equal(data.popularity.has(target.id), false);
      await db.delete(blocksTable).where(eq(blocksTable.userId, viewer));
    });
    await t.test("telemetry deduplicates event IDs, clamps floods, respects activity opt-out and requires earned completion", async () => {
      const [video] = await db.update(media).set({ mediaType: "video", contentType: "video/mp4", durationSeconds: 20 }).where(eq(media.id, fixtures[3].id)).returning();
      const eventId = randomUUID();
      assert.equal(await recordSocialTelemetry(viewer, video, { eventId, event: "complete", watchSeconds: 0 }), false);
      await Promise.all(Array.from({ length: 5 }, () => recordSocialTelemetry(viewer, video, { eventId: "f0000000-0000-4000-8000-000000000001", event: "progress", watchSeconds: 10 })));
      let [s] = await db.select().from(signals).where(and(eq(signals.userId, viewer), eq(signals.mediaId, video.id)));
      assert.equal(s.watchedSeconds, 10); assert.equal(s.completions, 0);
      await db.insert(watchSettingsTable).values({ userId: viewer, behaviorEnabled: false }).onConflictDoUpdate({ target: watchSettingsTable.userId, set: { behaviorEnabled: false } });
      assert.equal(await recordSocialTelemetry(viewer, video, { eventId: randomUUID(), event: "progress", watchSeconds: 30 }), false);
      await db.update(watchSettingsTable).set({ behaviorEnabled: true }).where(eq(watchSettingsTable.userId, viewer));
      const progress = await Promise.all(Array.from({ length: 10 }, () => recordSocialTelemetry(viewer, video, { eventId: randomUUID(), event: "progress", watchSeconds: 30 })));
      [s] = await db.select().from(signals).where(and(eq(signals.userId, viewer), eq(signals.mediaId, video.id)));
      assert.ok(s.watchedSeconds < 20, `Flood should not count fake elapsed time (${s.watchedSeconds})`);
    });
    await t.test("reporting is bounded and only an authorized moderator can remove; removal revokes all shared access", async () => {
      await request(viewer, `/social/posts/${item.id}/action`, "POST", { action: "report", reason: "Synthetic review" });
      assert.equal((await request(viewer, "/social/moderation")).status, 403);
      const queue = await json(await request(other, "/social/moderation"));
      const report = queue.reports.find((r: any) => r.mediaId === item.id);
      assert.ok(report);
      assert.equal((await request(viewer, `/social/moderation/${report.id}`, "POST", { action: "remove" })).status, 403);
      assert.equal((await request(other, `/social/moderation/${report.id}`, "POST", { action: "remove" })).status, 204);
      for (const path of [`/social/posts/${item.id}`, `/social/posts/${item.id}/comments`, `/media/${item.id}/view-url`]) assert.equal((await request(viewer, path)).status, 404);
      assert.equal((await request(owner, `/social/posts/${item.id}`, "PATCH", posting)).status, 404);
    });
    await t.test("blocking hides posts, profiles, comments, existing sessions and old stream tickets in both directions", async () => {
      const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, owner));
      assert.equal((await request(viewer, `/social/posts/${another.id}/action`, "POST", { action: "block" })).status, 200);
      for (const path of [`/social/posts/${another.id}`, `/social/posts/${another.id}/comments`, `/social/profiles/${profile.id}`, `/media/${another.id}/view-url`]) assert.equal((await request(viewer, path)).status, 404);
      const blockedFeed = await json(await request(viewer, `/social/feed?sessionId=${sessionId}&type=image`));
      assert.ok(blockedFeed.items.every((i: any) => !fixtures.some(m => m.id === i.id)));
      assert.equal((await fetch(base + `/streams/${another.id}?ticket=${createMediaTicket(another.id, viewer)}`)).status, 404);
    });
  } finally {
    if (originalEdgeSecret === undefined) delete process.env.SHARED_MEDIA_EDGE_SECRET; else process.env.SHARED_MEDIA_EDGE_SECRET = originalEdgeSecret;
    if (originalEdgeOrigin === undefined) delete process.env.SHARED_MEDIA_EDGE_ORIGIN; else process.env.SHARED_MEDIA_EDGE_ORIGIN = originalEdgeOrigin;
    await db.delete(media).where(eq(media.userId, owner));
    await db.delete(accounts).where(inArray(accounts.userId, users));
    await db.delete(membersTable).where(inArray(membersTable.userId, users));
    await db.delete(accessMembershipsTable).where(inArray(accessMembershipsTable.userId, users));
    await db.delete(profilesTable).where(inArray(profilesTable.userId, users));
    await db.delete(blocksTable).where(inArray(blocksTable.userId, users));
    await db.delete(watchSettingsTable).where(inArray(watchSettingsTable.userId, users));
    await db.delete(watchFeedSessionsTable).where(inArray(watchFeedSessionsTable.userId, users));
    await db.delete(socialRateLimitsTable).where(like(socialRateLimitsTable.key, `${prefix}%`));
    if (originalMods === undefined) delete process.env.SOCIAL_MODERATOR_USER_IDS; else process.env.SOCIAL_MODERATOR_USER_IDS = originalMods;
    server.close(); server.closeAllConnections(); await pool.end();
  }
});
