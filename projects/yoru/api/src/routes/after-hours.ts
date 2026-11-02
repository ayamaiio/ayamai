import { and, desc, eq, sql } from "drizzle-orm";
import { db, mediaItemsTable } from "@workspace/db";
import { Router, type IRouter } from "express";
import { isNotGameAsset } from "../lib/media-classification";
import { sharedMediaUrl } from "../lib/shared-delivery";
import { getRequestUserId } from "../middlewares/requireAuth";

const router: IRouter = Router();

// "NSFW" is a tag, not a schema concept: `nsfw` inside media_items.tags. Marking
// stays reversible, shows up beside every other label, and needs no migration
// over a 247k-row table.
const NSFW = "nsfw";
const isMarked = (userId: string, assets: boolean) =>
  and(
    eq(mediaItemsTable.userId, userId),
    sql`${NSFW} = any(${mediaItemsTable.tags})`,
    assets ? undefined : isNotGameAsset,
  );

router.get("/after-hours", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const limit = Math.min(120, Math.max(1, Number(req.query.limit ?? 60)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  const withAssets = req.query.assets === "show";

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: mediaItemsTable.id,
        title: mediaItemsTable.title,
        collection: mediaItemsTable.collection,
        mediaType: mediaItemsTable.mediaType,
        contentType: mediaItemsTable.contentType,
        size: mediaItemsTable.size,
        createdAt: mediaItemsTable.createdAt,
      })
      .from(mediaItemsTable)
      .where(isMarked(userId, withAssets))
      .orderBy(desc(mediaItemsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(mediaItemsTable).where(isMarked(userId, withAssets)),
  ]);

  const local = Boolean(process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim());
  res.set("Cache-Control", "private, no-store");
  res.json({
    total: total?.n ?? 0,
    offset,
    items: rows.map((r) => ({ ...r, url: local ? sharedMediaUrl(req.baseUrl, r.id, userId) : null })),
  });
});

router.post("/after-hours/mark", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const { id, marked } = (req.body ?? {}) as { id?: unknown; marked?: unknown };
  if (typeof id !== "string" || typeof marked !== "boolean") {
    res.status(400).json({ error: "id and marked are required." });
    return;
  }

  const [updated] = await db
    .update(mediaItemsTable)
    .set({
      tags: marked
        ? sql`(select array_agg(distinct t) from unnest(${mediaItemsTable.tags} || ${NSFW}::text) as t)`
        : sql`(select coalesce(array_agg(t), '{}') from unnest(${mediaItemsTable.tags}) as t where t <> ${NSFW})`,
    })
    .where(and(eq(mediaItemsTable.id, id), eq(mediaItemsTable.userId, userId)))
    .returning({ id: mediaItemsTable.id, tags: mediaItemsTable.tags });

  if (!updated) {
    res.status(404).json({ error: "Media item not found." });
    return;
  }
  res.json({ id: updated.id, marked, tags: updated.tags });
});

export default router;
