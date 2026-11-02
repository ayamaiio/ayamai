import { and, desc, eq, sql } from "drizzle-orm";
import { db, mediaItemsTable, socialEventsTable as events, videoViewsTable as views, watchSettingsTable, watchSignalsTable as signals } from "@workspace/db";
import { RecordSocialEventBody } from "@workspace/api-zod";
import { SocialError } from "./social-access";

export async function recordSocialTelemetry(userId: string, item: typeof mediaItemsTable.$inferSelect, input: unknown) {
  const parsed = RecordSocialEventBody.safeParse(input);
  if (!parsed.success) throw new SocialError(400, "Invalid playback event.");
  const [settings] = await db.select().from(watchSettingsTable).where(eq(watchSettingsTable.userId, userId)).limit(1);
  if (settings?.behaviorEnabled === false) return false;
  const body = parsed.data;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 7913))`);
    const [duplicate] = await tx.select({ id: events.eventId }).from(events).where(eq(events.eventId, body.eventId)).limit(1);
    if (duplicate) return false;
    const [previous] = await tx.select().from(events).where(and(eq(events.userId, userId), sql`${events.seconds} > 0`)).orderBy(desc(events.createdAt)).limit(1);
    const now = new Date();
    // A user's parallel tabs cannot manufacture more than real elapsed time (+ small delivery jitter).
    const elapsed = previous ? Math.max(0, (now.getTime() - previous.createdAt.getTime()) / 1000) : 30;
    let seconds = body.event === "progress" || body.event === "dwell" ? Math.min(30, body.watchSeconds, elapsed) : 0;
    const [daily] = await tx.select({
      seconds: sql<number>`coalesce(sum(${events.seconds}),0)::float`,
      complete: sql<number>`count(*) filter(where ${events.kind}='complete')::int`,
      replay: sql<number>`count(*) filter(where ${events.kind}='replay')::int`,
      skips: sql<number>`count(*) filter(where ${events.kind}='quick-skip')::int`,
    }).from(events).where(and(eq(events.userId, userId), eq(events.mediaId, item.id), sql`${events.createdAt} > now() - interval '24 hours'`));
    seconds = Math.max(0, Math.min(seconds, 3600 - Number(daily.seconds)));
    if (item.mediaType === "image") seconds = Math.min(seconds, Math.max(0, 12 - Number(daily.seconds)));
    const duration = item.durationSeconds ?? body.durationSeconds ?? 30;
    const canComplete = item.mediaType === "video" && Number(daily.seconds) >= (Number(daily.complete) + 1) * Math.max(1, duration * 0.8) && Number(daily.complete) < 3;
    const accepted = body.event === "complete" ? canComplete
      : body.event === "replay" ? item.mediaType === "video" && Number(daily.replay) < Math.max(0, Number(daily.complete) - 1)
      : body.event === "quick-skip" ? Number(daily.skips) < 3
      : seconds > 0;
    // Store rejected IDs too: retrying a completion later must not turn a rejected delivery into a completion.
    await tx.insert(events).values({ eventId: body.eventId, userId, mediaId: item.id, kind: accepted ? body.event : "ignored", seconds: accepted ? seconds : 0 });
    if (!accepted) return false;
    if (item.mediaType === "video" && body.event === "progress" && seconds > 0) {
      // Snapshot current visibility under the same transaction. Private viewing
      // never becomes a public count merely because the post is published later.
      const [current] = await tx.select({ visibility: mediaItemsTable.visibility, owner: mediaItemsTable.userId })
        .from(mediaItemsTable).where(eq(mediaItemsTable.id, item.id)).for("share");
      if (!current || (current.visibility === "private" && current.owner !== userId)) throw new SocialError(404, "Post unavailable.");
      await tx.insert(views).values({
        userId, mediaId: item.id, day: now.toISOString().slice(0, 10),
        visibility: current.visibility, watchedSeconds: Math.min(3, seconds),
      }).onConflictDoUpdate({
        target: [views.userId, views.mediaId, views.day, views.visibility],
        set: { watchedSeconds: sql`least(3, ${views.watchedSeconds} + ${seconds})` },
      });
    }
    // Earn completion from accumulated foreground progress too. HTTP deliveries can arrive
    // out of order; a completion request racing its final progress batch must not lose the signal.
    const earnedByProgress = item.mediaType === "video" && Number(daily.complete) < 3
      && seconds > 0 && Number(daily.seconds) + seconds >= (Number(daily.complete) + 1) * Math.max(1, duration * 0.8);
    const watched = Math.floor(seconds), complete = body.event === "complete" || earnedByProgress ? 1 : 0,
      replay = body.event === "replay" ? 1 : 0, skips = body.event === "quick-skip" ? 1 : 0;
    await tx.insert(signals).values({ userId, mediaId: item.id, watchedSeconds: watched, completions: complete, replays: replay, quickSkips: skips })
      .onConflictDoUpdate({ target: [signals.userId, signals.mediaId], set: {
        watchedSeconds: sql`least(86400, ${signals.watchedSeconds} + ${watched})`,
        completions: sql`least(100, ${signals.completions} + ${complete})`,
        replays: sql`least(100, ${signals.replays} + ${replay})`,
        quickSkips: sql`least(100, ${signals.quickSkips} + ${skips})`, updatedAt: now,
      } });
    if (item.userId === userId && body.durationSeconds && !item.durationSeconds) await tx.update(mediaItemsTable)
      .set({ durationSeconds: body.durationSeconds }).where(and(eq(mediaItemsTable.id, item.id), sql`${mediaItemsTable.durationSeconds} is null`));
    await tx.delete(events).where(and(eq(events.userId, userId), sql`${events.createdAt} < now() - interval '90 days'`));
    return true;
  });
}
