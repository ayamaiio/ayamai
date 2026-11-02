import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetWatchFeedQueryParams,
  GetWatchFeedResponse,
  GetWatchReactionParams,
  GetWatchReactionResponse,
  GetWatchSettingsResponse,
  RecordWatchEventBody,
  RecordWatchEventParams,
  RecordWatchEventResponse,
  SetWatchReactionBody,
  SetWatchReactionParams,
  SetWatchReactionResponse,
  UpdateWatchSettingsBody,
  UpdateWatchSettingsResponse,
} from "@workspace/api-zod";
import {
  db,
  mediaItemsTable,
  watchFeedSessionsTable,
  watchSettingsTable,
  watchSignalsTable,
  socialEventsTable,
} from "@workspace/db";
import { getRequestUserId, requireAuth } from "../middlewares/requireAuth";
import { rankWatchFeed } from "../lib/watchFeedRanking";
import { libraryReadScope } from "../lib/library-access";

const router: IRouter = Router();
const SESSION_RETENTION_DAYS = 7;

function toMediaAsset(
  row: Pick<
    typeof mediaItemsTable.$inferSelect,
    | "id"
    | "title"
    | "collection"
    | "originalName"
    | "mediaType"
    | "contentType"
    | "size"
    | "isFavorite"
    | "progressSeconds"
    | "createdAt"
  >,
) {
  return {
    id: row.id,
    title: row.title,
    collection: row.collection,
    originalName: row.originalName,
    mediaType: row.mediaType,
    contentType: row.contentType,
    size: row.size,
    isFavorite: row.isFavorite,
    progressSeconds: row.progressSeconds,
    createdAt: row.createdAt,
  };
}

router.use(requireAuth);

router.get("/watch/feed", async (req, res): Promise<void> => {
  const parsed = GetWatchFeedQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = getRequestUserId(req);
  const { sessionId, limit, offset } = parsed.data;
  let [session] = await db
    .select()
    .from(watchFeedSessionsTable)
    .where(
      and(
        eq(watchFeedSessionsTable.sessionId, sessionId),
        eq(watchFeedSessionsTable.userId, userId),
      ),
    )
    .limit(1);

  if (!session) {
    const [claimed] = await db
      .select({ userId: watchFeedSessionsTable.userId })
      .from(watchFeedSessionsTable)
      .where(eq(watchFeedSessionsTable.sessionId, sessionId))
      .limit(1);
    if (claimed) {
      res.status(409).json({ error: "This feed session is unavailable." });
      return;
    }

    const [settings] = await db
      .select()
      .from(watchSettingsTable)
      .where(eq(watchSettingsTable.userId, userId))
      .limit(1);
    const [items, signals] = await Promise.all([
      db
        .select({
          id: mediaItemsTable.id,
          title: mediaItemsTable.title,
          collection: mediaItemsTable.collection,
          mediaType: mediaItemsTable.mediaType,
        })
        .from(mediaItemsTable)
        .where(libraryReadScope(userId)),
      db
        .select({
          mediaId: watchSignalsTable.mediaId,
          reaction: watchSignalsTable.reaction,
          watchedSeconds: watchSignalsTable.watchedSeconds,
          completions: watchSignalsTable.completions,
          replays: watchSignalsTable.replays,
          quickSkips: watchSignalsTable.quickSkips,
        })
        .from(watchSignalsTable)
        .where(eq(watchSignalsTable.userId, userId)),
    ]);
    const mediaIds = rankWatchFeed(
      items.map((item) => ({
        id: item.id,
        title: item.title,
        collection: item.collection,
        mediaType: item.mediaType,
      })),
      signals.map((signal) => ({
        mediaId: signal.mediaId,
        reaction: signal.reaction,
        watchedSeconds: signal.watchedSeconds,
        completions: signal.completions,
        replays: signal.replays,
        quickSkips: signal.quickSkips,
      })),
      sessionId,
      settings?.behaviorEnabled ?? true,
    );

    await db
      .delete(watchFeedSessionsTable)
      .where(
        and(
          eq(watchFeedSessionsTable.userId, userId),
          lt(
            watchFeedSessionsTable.createdAt,
            new Date(Date.now() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000),
          ),
        ),
      );
    await db
      .insert(watchFeedSessionsTable)
      .values({ sessionId, userId, mediaIds })
      .onConflictDoNothing({ target: watchFeedSessionsTable.sessionId });
    [session] = await db
      .select()
      .from(watchFeedSessionsTable)
      .where(
        and(
          eq(watchFeedSessionsTable.sessionId, sessionId),
          eq(watchFeedSessionsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!session) {
      res.status(409).json({ error: "This feed session is unavailable." });
      return;
    }
  }

  if (session.lane !== "legacy") {
    res.status(409).json({ error: "Start a new Watch session." });
    return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  const ids = session.mediaIds.slice(offset, offset + limit);
  const [rows, pageSignals] = ids.length
    ? await Promise.all([
        db
          .select({
            id: mediaItemsTable.id,
            title: mediaItemsTable.title,
            collection: mediaItemsTable.collection,
            originalName: mediaItemsTable.originalName,
            mediaType: mediaItemsTable.mediaType,
            contentType: mediaItemsTable.contentType,
            size: mediaItemsTable.size,
            isFavorite: mediaItemsTable.isFavorite,
            progressSeconds: mediaItemsTable.progressSeconds,
            createdAt: mediaItemsTable.createdAt,
          })
          .from(mediaItemsTable)
          .where(
            and(
              libraryReadScope(userId),
              inArray(mediaItemsTable.id, ids),
            ),
          ),
        db
          .select({ mediaId: watchSignalsTable.mediaId, reaction: watchSignalsTable.reaction })
          .from(watchSignalsTable)
          .where(
            and(
              eq(watchSignalsTable.userId, userId),
              inArray(watchSignalsTable.mediaId, ids),
            ),
          ),
      ])
    : [[], []];
  const byId = new Map(rows.map((item) => [item.id, item]));
  const reactions = new Map(pageSignals.map((signal) => [signal.mediaId, signal.reaction]));
  const orderedItems = ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [{ ...toMediaAsset(item), reaction: reactions.get(id) ?? null }] : [];
  });
  res.json(
    GetWatchFeedResponse.parse({
      sessionId,
      items: orderedItems,
      offset,
      total: session.mediaIds.length,
      hasMore: offset + ids.length < session.mediaIds.length,
    }),
  );
});

router.get("/watch/settings", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const [settings] = await db
    .select()
    .from(watchSettingsTable)
    .where(eq(watchSettingsTable.userId, userId))
    .limit(1);
  res.json(GetWatchSettingsResponse.parse({
    behaviorEnabled: settings?.behaviorEnabled ?? true,
    autoplayEnabled: settings?.autoplayEnabled ?? null,
    dataSaverEnabled: settings?.dataSaverEnabled ?? false,
    alwaysVisibleControls: settings?.alwaysVisibleControls ?? false,
  }));
});

router.patch("/watch/settings", async (req, res): Promise<void> => {
  const body = UpdateWatchSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "At least one Watch setting is required." });
    return;
  }
  const userId = getRequestUserId(req);
  const [settings] = await db
    .insert(watchSettingsTable)
    .values({ userId, ...body.data })
    .onConflictDoUpdate({
      target: watchSettingsTable.userId,
      set: { ...body.data, updatedAt: new Date() },
    })
    .returning();
  res.json(UpdateWatchSettingsResponse.parse({
    behaviorEnabled: settings.behaviorEnabled,
    autoplayEnabled: settings.autoplayEnabled,
    dataSaverEnabled: settings.dataSaverEnabled,
    alwaysVisibleControls: settings.alwaysVisibleControls,
  }));
});

router.delete("/watch/history", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  await db.transaction(async (tx) => {
    await tx.delete(socialEventsTable).where(eq(socialEventsTable.userId, userId));
    await tx
      .update(watchSignalsTable)
      .set({
        watchedSeconds: 0,
        completions: 0,
        replays: 0,
        quickSkips: 0,
        updatedAt: new Date(),
      })
      .where(eq(watchSignalsTable.userId, userId));
    await tx
      .delete(watchSignalsTable)
      .where(
        and(
          eq(watchSignalsTable.userId, userId),
          isNull(watchSignalsTable.reaction),
        ),
      );
  });
  res.sendStatus(204);
});

router.get("/watch/media/:id/reaction", async (req, res): Promise<void> => {
  const params = GetWatchReactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const [item] = await db
    .select({ id: mediaItemsTable.id, reaction: watchSignalsTable.reaction })
    .from(mediaItemsTable)
    .leftJoin(watchSignalsTable, and(
      eq(watchSignalsTable.mediaId, mediaItemsTable.id),
      eq(watchSignalsTable.userId, userId),
    ))
    .where(and(eq(mediaItemsTable.id, params.data.id), libraryReadScope(userId)))
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Media item not found." });
    return;
  }
  // Reactions here are personal, including GOD reads of other uploaders' items.
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetWatchReactionResponse.parse({
    mediaId: item.id,
    reaction: item.reaction ?? null,
    likeCount: item.reaction === "like" ? 1 : 0,
  }));
});

router.patch("/watch/media/:id/reaction", async (req, res): Promise<void> => {
  const params = SetWatchReactionParams.safeParse(req.params);
  const body = SetWatchReactionBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const [item] = await db
    .select({ id: mediaItemsTable.id })
    .from(mediaItemsTable)
    .where(
      and(
        eq(mediaItemsTable.id, params.data.id),
        libraryReadScope(userId),
      ),
    )
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Media item not found." });
    return;
  }

  await db
    .insert(watchSignalsTable)
    .values({ userId, mediaId: item.id, reaction: body.data.reaction, publicReaction: false })
    .onConflictDoUpdate({
      target: [watchSignalsTable.userId, watchSignalsTable.mediaId],
      set: { reaction: body.data.reaction, publicReaction: false, updatedAt: new Date() },
    });
  res.json(
    SetWatchReactionResponse.parse({
      mediaId: item.id,
      reaction: body.data.reaction,
      likeCount: body.data.reaction === "like" ? 1 : 0,
    }),
  );
});

router.post("/watch/media/:id/event", async (req, res): Promise<void> => {
  const params = RecordWatchEventParams.safeParse(req.params);
  const body = RecordWatchEventBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const [item] = await db
    .select({ id: mediaItemsTable.id })
    .from(mediaItemsTable)
    .where(
      and(
        eq(mediaItemsTable.id, params.data.id),
        libraryReadScope(userId),
      ),
    )
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Media item not found." });
    return;
  }

  const [settings] = await db
    .select()
    .from(watchSettingsTable)
    .where(eq(watchSettingsTable.userId, userId))
    .limit(1);
  if (settings?.behaviorEnabled ?? true) {
    const { event, watchedSeconds } = body.data;
    const increments = {
      completions: event === "complete" ? 1 : 0,
      replays: event === "replay" ? 1 : 0,
      quickSkips: event === "quick-skip" ? 1 : 0,
    };
    await db
      .insert(watchSignalsTable)
      .values({
        userId,
        mediaId: item.id,
        watchedSeconds: event === "progress" ? watchedSeconds : 0,
        ...increments,
      })
      .onConflictDoUpdate({
        target: [watchSignalsTable.userId, watchSignalsTable.mediaId],
        set: {
          watchedSeconds: sql`${watchSignalsTable.watchedSeconds} + ${event === "progress" ? watchedSeconds : 0}`,
          completions: sql`${watchSignalsTable.completions} + ${increments.completions}`,
          replays: sql`${watchSignalsTable.replays} + ${increments.replays}`,
          quickSkips: sql`${watchSignalsTable.quickSkips} + ${increments.quickSkips}`,
          updatedAt: new Date(),
        },
      });
  }
  const [summary] = await db
    .select()
    .from(watchSignalsTable)
    .where(
      and(
        eq(watchSignalsTable.userId, userId),
        eq(watchSignalsTable.mediaId, item.id),
      ),
    )
    .limit(1);
  res.json(
    RecordWatchEventResponse.parse({
      mediaId: item.id,
      reaction: summary?.reaction ?? null,
      watchedSeconds: summary?.watchedSeconds ?? 0,
      completions: summary?.completions ?? 0,
      replays: summary?.replays ?? 0,
      quickSkips: summary?.quickSkips ?? 0,
    }),
  );
});

export default router;
