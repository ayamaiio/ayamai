import {
  asc,
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateMediaBody,
  CreateMediaResponse,
  DeleteMediaParams,
  GetMediaSummaryResponse,
  GetMediaViewUrlParams,
  GetMediaViewUrlResponse,
  ListMediaCollectionsResponse,
  ListMediaQueryParams,
  ListMediaResponse,
  UpdateMediaBody,
  UpdateMediaParams,
  UpdateMediaResponse,
} from "@workspace/api-zod";
import { db, mediaItemsTable, savedPostsTable } from "@workspace/db";
import { accessibleMedia, postValues, SocialError } from "../lib/social-access";
import { sharedMediaUrl } from "../lib/shared-delivery";
import { libraryReadScope } from "../lib/library-access";
import { isGameAsset, isNotGameAsset } from "../lib/media-classification";
import { deletePostObjects, findUploadClaim, lockUploadKeys } from "../lib/gallery-posts";
import { enqueuePreview, withPreviewLock } from "../lib/media-previews";
import { captureDigest, capturePrefix, verifyCapture } from "../lib/browser-capture";
import {
  createViewUrl,
  deleteMediaObject,
  isSupportedMediaContentType,
  verifyUploadedObject,
} from "../lib/r2Storage";
import {
  getRequestUserId,
  requireAuth,
} from "../middlewares/requireAuth";

const router: IRouter = Router();
const MAX_MEDIA_TITLE_LENGTH = 255;
const MAX_COLLECTION_NAME_LENGTH = 80;

async function discardUnclaimedCapture(objectKey: string) {
  // Share claim locks with galleries and ordinary media creation: a duplicate
  // must not remove an object another post acquired while this request ran.
  await db.transaction(async (tx) => {
    await lockUploadKeys(tx, [objectKey]);
    if (!await findUploadClaim(tx, [objectKey])) await deleteMediaObject(objectKey);
  });
}

function normalizeCollectionName(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, MAX_COLLECTION_NAME_LENGTH) : null;
}

function toMediaAsset(row: typeof mediaItemsTable.$inferSelect, captureDuplicate = false) {
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
    ...(captureDuplicate ? { captureDuplicate: true } : {}),
  };
}

router.use(requireAuth);

router.get("/media", async (req, res): Promise<void> => {
  const parsed = ListMediaQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    q,
    type = "all",
    favorites,
    collection,
    uncategorized,
    limit = 30,
    offset = 0,
    anchorId,
  } = parsed.data;
  if (collection && uncategorized) {
    res.status(400).json({ error: "Choose a collection or uncategorized items, not both." });
    return;
  }
  const conditions = [libraryReadScope(getRequestUserId(req))];
  // Game asset dumps are library content too, but they are not pictures someone
  // chose. They stay out of the default view; ?assets=show brings them back.
  const assets = req.query.assets === "show" ? "all" : req.query.assets === "only" ? "only" : "hide";
  if (assets === "hide") conditions.push(isNotGameAsset);
  else if (assets === "only") conditions.push(isGameAsset);
  if (type !== "all") {
    conditions.push(eq(mediaItemsTable.mediaType, type));
  }
  if (favorites === true) {
    conditions.push(eq(mediaItemsTable.isFavorite, true));
  }
  if (collection?.trim()) {
    conditions.push(eq(mediaItemsTable.collection, collection.trim()));
  } else if (uncategorized === true) {
    conditions.push(isNull(mediaItemsTable.collection));
  }
  if (q?.trim()) {
    const search = `%${q.trim()}%`;
    conditions.push(
      or(
        ilike(mediaItemsTable.title, search),
        ilike(mediaItemsTable.originalName, search),
        ilike(mediaItemsTable.collection, search),
      )!,
    );
  }
  const where = and(...conditions);
  let pageOffset = offset;
  if (anchorId) {
    // Resolve within the same authorized scope and active filters.
    const [anchor] = await db.select({
      id: mediaItemsTable.id,
      createdAt: mediaItemsTable.createdAt,
    }).from(mediaItemsTable).where(and(where, eq(mediaItemsTable.id, anchorId))).limit(1);
    pageOffset = 0;
    if (anchor) {
      const [rank] = await db.select({ total: count() }).from(mediaItemsTable).where(and(
        where,
        or(
          gt(mediaItemsTable.createdAt, anchor.createdAt),
          and(eq(mediaItemsTable.createdAt, anchor.createdAt), gt(mediaItemsTable.id, anchor.id)),
        ),
      ));
      // Include context before the anchor without downloading earlier pages.
      pageOffset = Math.max(0, Number(rank?.total ?? 0) - Math.min(12, limit - 1));
    }
  }

  const [items, totals] = await Promise.all([
    db
      .select()
      .from(mediaItemsTable)
      .where(where)
      .orderBy(desc(mediaItemsTable.createdAt), desc(mediaItemsTable.id))
      .limit(limit)
      .offset(pageOffset),
    db.select({ total: count() }).from(mediaItemsTable).where(where),
  ]);

  res.json(
    ListMediaResponse.parse({
      items: items.map((row) => toMediaAsset(row)),
      total: totals[0]?.total ?? 0,
      offset: pageOffset,
    }),
  );
});

router.get("/media/collections", async (req, res): Promise<void> => {
  const rows = await db
    .select({ collection: mediaItemsTable.collection })
    .from(mediaItemsTable)
    .where(
      and(
        libraryReadScope(getRequestUserId(req)),
        isNotNull(mediaItemsTable.collection),
      ),
    )
    .groupBy(mediaItemsTable.collection)
    .orderBy(asc(mediaItemsTable.collection));

  res.json(
    ListMediaCollectionsResponse.parse({
      collections: rows.flatMap((row) => row.collection ? [row.collection] : []),
    }),
  );
});

router.get("/media/summary", async (req, res): Promise<void> => {
  const [summary] = await db
    .select({
      totalItems: count(),
      videoCount: sql<number>`count(*) filter (where ${mediaItemsTable.mediaType} = 'video')`,
      imageCount: sql<number>`count(*) filter (where ${mediaItemsTable.mediaType} = 'image')`,
      favoriteCount: sql<number>`count(*) filter (where ${mediaItemsTable.isFavorite} = true)`,
      totalBytes: sql<string>`coalesce(sum(${mediaItemsTable.size} + coalesce((select sum((image->>'size')::bigint) from jsonb_array_elements(${mediaItemsTable.galleryImages}) image), 0)), 0)::text`,
    })
    .from(mediaItemsTable)
    .where(libraryReadScope(getRequestUserId(req)));

  res.json(
    GetMediaSummaryResponse.parse({
      totalItems: summary?.totalItems ?? 0,
      videoCount: Number(summary?.videoCount ?? 0),
      imageCount: Number(summary?.imageCount ?? 0),
      favoriteCount: Number(summary?.favoriteCount ?? 0),
      totalBytes: Number(summary?.totalBytes ?? 0),
    }),
  );
});

router.post("/media", async (req, res): Promise<void> => {
  const parsed = CreateMediaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  const userId = getRequestUserId(req);
  let posting;
  try { posting = await postValues(userId, data.posting); }
  catch (error) {
    if (error instanceof SocialError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
  if (!isSupportedMediaContentType(data.mediaType, data.contentType)) {
    res.status(415).json({ error: "This image or video format is not supported." });
    return;
  }
  const expectedPrefix = `media/${userId}/`;
  if (!data.objectKey.startsWith(expectedPrefix)) {
    res.status(400).json({ error: "This upload does not belong to your account." });
    return;
  }

  // A retry of an already-saved capture returns its existing owner-only record
  // without touching storage (including a duplicate PUT object already removed).
  const digest = captureDigest(data.objectKey, userId);
  if (digest) {
    const prefix = capturePrefix(userId, digest);
    const [duplicate] = await db.select().from(mediaItemsTable).where(and(
      eq(mediaItemsTable.userId, userId),
      sql`left(${mediaItemsTable.objectKey}, ${prefix.length}) = ${prefix}`,
    )).limit(1);
    if (duplicate) {
      if (duplicate.moderationState !== "active") { res.status(409).json({ error: "This capture is not available." }); return; }
      // A new duplicate's uploaded bytes are not referenced by any post.
      if (duplicate.objectKey !== data.objectKey) await discardUnclaimedCapture(data.objectKey);
      res.status(200).json(CreateMediaResponse.parse(toMediaAsset(duplicate, true)));
      return;
    }
  }
  const verified = await verifyUploadedObject(
    data.objectKey,
    data.size,
    data.contentType,
  );
  if (!verified) {
    res.status(400).json({ error: "The uploaded file could not be verified." });
    return;
  }
  try { await verifyCapture(data.objectKey, userId, data.contentType, data.size); }
  catch (error) {
    if (error instanceof SocialError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }

  let created;
  try {
    created = await db.transaction(async tx => {
      const digest = captureDigest(data.objectKey, userId);
      const prefix = digest ? capturePrefix(userId, digest) : null;
      await lockUploadKeys(tx, [data.objectKey, ...(prefix ? [prefix] : [])]);
      if (prefix) {
        const [duplicate] = await tx.select().from(mediaItemsTable).where(and(
          eq(mediaItemsTable.userId, userId),
          sql`left(${mediaItemsTable.objectKey}, ${prefix.length}) = ${prefix}`,
        )).limit(1);
        if (duplicate) {
          if (duplicate.moderationState !== "active") throw new SocialError(409, "This capture is not available.");
          return duplicate;
        }
      }
      const claimed = await findUploadClaim(tx, [data.objectKey]);
      if (claimed && (claimed.objectKey !== data.objectKey || claimed.userId !== userId)) {
        throw new SocialError(409, "This image is already part of another post.");
      }
      if (claimed) return claimed;
      const [inserted] = await tx
    .insert(mediaItemsTable)
    .values({
      ...posting,
      userId,
      title: data.title.slice(0, MAX_MEDIA_TITLE_LENGTH),
      collection: normalizeCollectionName(data.collection),
      originalName: data.originalName,
      objectKey: data.objectKey,
      contentType: data.contentType,
      mediaType: data.mediaType,
      size: data.size,
    })
    .onConflictDoNothing({ target: mediaItemsTable.objectKey })
    .returning();
      return inserted;
    });
  } catch (error) {
    if (error instanceof SocialError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }

  if (created) {
    if (captureDigest(data.objectKey, userId) && created.objectKey !== data.objectKey) {
      await discardUnclaimedCapture(data.objectKey);
    }
    enqueuePreview(created.id);
    res.status(201).json(CreateMediaResponse.parse(toMediaAsset(created, !!digest && created.objectKey !== data.objectKey)));
    return;
  }

  const [existing] = await db
    .select()
    .from(mediaItemsTable)
    .where(
      and(
        eq(mediaItemsTable.objectKey, data.objectKey),
        eq(mediaItemsTable.userId, userId),
      ),
    )
    .limit(1);
  if (!existing) {
    res.status(409).json({ error: "This upload could not be recorded. Please retry." });
    return;
  }
  res.status(201).json(CreateMediaResponse.parse(toMediaAsset(existing)));
  enqueuePreview(existing.id);
});

router.patch("/media/:id", async (req, res): Promise<void> => {
  const params = UpdateMediaParams.safeParse(req.params);
  const body = UpdateMediaBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({
      error: body.error.message,
    });
    return;
  }
  if (Object.keys(body.data).length === 0) {
    res.status(400).json({ error: "Provide at least one field to update." });
    return;
  }

  const updated = await db.transaction(async (tx) => {
    const [item] = await tx
      .update(mediaItemsTable)
      .set({
        ...body.data,
        ...(body.data.collection !== undefined
          ? { collection: normalizeCollectionName(body.data.collection) }
          : {}),
      })
      .where(
        and(
          eq(mediaItemsTable.id, params.data.id),
          eq(mediaItemsTable.userId, getRequestUserId(req)),
        ),
      )
      .returning();
    if (item && body.data.isFavorite !== undefined) {
      const userId = getRequestUserId(req);
      if (body.data.isFavorite) {
        await tx.insert(savedPostsTable).values({ userId, mediaId: item.id }).onConflictDoNothing();
      } else {
        await tx.delete(savedPostsTable).where(and(eq(savedPostsTable.userId, userId), eq(savedPostsTable.mediaId, item.id)));
      }
    }
    return item;
  });

  if (!updated) {
    res.status(404).json({ error: "Media item not found." });
    return;
  }
  res.json(UpdateMediaResponse.parse(toMediaAsset(updated)));
});

router.delete("/media/:id", async (req, res): Promise<void> => {
  const params = DeleteMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [item] = await db
    .select()
    .from(mediaItemsTable)
    .where(
      and(
        eq(mediaItemsTable.id, params.data.id),
        eq(mediaItemsTable.userId, getRequestUserId(req)),
      ),
    )
    .limit(1);
  if (!item) {
    res.status(404).json({ error: "Media item not found." });
    return;
  }

  await withPreviewLock(item.id, async () => {
    await deletePostObjects(item);
    await db
      .delete(mediaItemsTable)
      .where(
        and(
          eq(mediaItemsTable.id, item.id),
          eq(mediaItemsTable.userId, getRequestUserId(req)),
        ),
      );
  });
  res.sendStatus(204);
});

router.get("/media/:id/view-url", async (req, res): Promise<void> => {
  const params = GetMediaViewUrlParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const userId = getRequestUserId(req);
  let item;
  try { item = await accessibleMedia(params.data.id, userId); }
  catch (error) {
    if (error instanceof SocialError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }

  if (!isSupportedMediaContentType(item.mediaType, item.contentType)) {
    res.status(415).json({ error: "This image or video format is not supported." });
    return;
  }

  const url = item.visibility === "public" || process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim()
    ? sharedMediaUrl(req.baseUrl, item.id, userId)
    : await createViewUrl(item.objectKey, item.contentType);
  res.set("Cache-Control", "private, no-store");
  res.json(
    GetMediaViewUrlResponse.parse({
      url,
      contentType: item.contentType,
    }),
  );
});

export default router;
