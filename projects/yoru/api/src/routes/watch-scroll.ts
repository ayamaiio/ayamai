import { Router, type IRouter } from "express";
import { db, mediaItemsTable as media, watchSignalsTable as signals } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getRequestUserId } from "../middlewares/requireAuth";
import { createMediaTicket } from "../lib/media-tickets";
import { sharedMediaUrl } from "../lib/shared-delivery";
import { mediaObjectExists } from "../lib/r2Storage";
import { previewKey } from "../lib/preview-render";

const router: IRouter = Router();

const panelUrl = (id: string, viewer: string) => `${"/api"}/streams/${id}?ticket=${encodeURIComponent(createMediaTicket(id, viewer))}`;
const galleryUrl = (id: string, attachmentId: string, viewer: string) =>
  `${"/api"}/gallery-streams/${id}/${attachmentId}?ticket=${encodeURIComponent(createMediaTicket(id, viewer))}`;

// The importer wrote "Source: Doujin/[SAKULA] - Kabe Chie/13_012.jpg" into every
// row's description. That path is the only library structure we have, and it is
// enough for three lenses: what kind of thing it is, who made it, and which set
// it belongs to.
const sourcePath = sql<string>`substring(${media.description} from 'Source: ([^[:cntrl:]]*)')`;
const kindSql = sql<string>`nullif(split_part(${sourcePath}, '/', 1), '')`;
const creatorSql = sql<string>`nullif(coalesce(
  nullif(substring(${sourcePath} from '\\[([^\\]]+)\\]'), ''),
  case when split_part(${sourcePath}, '/', 1) in ('3DAnimation', 'Games')
    then nullif(split_part(${sourcePath}, '/', 2), '') end
), '')`;
const setSql = sql<string>`nullif(regexp_replace(${sourcePath}, '/[^/]+$', ''), '')`;

function lensFilter(level: string | undefined, value: string | undefined) {
  if (!level || !value) return undefined;
  const column = level === "kind" ? kindSql : level === "creator" ? creatorSql : level === "set" ? setSql : null;
  if (!column) return undefined;
  return sql`${column} = ${value}`;
}

const LENSES = ["kind", "creator", "set"] as const;
type LensLevel = typeof LENSES[number];

/**
 * The deck. Four kinds of thing, mixed at fixed rates rather than one flat
 * shuffle, because they are not equally valuable to look at:
 *
 *   45%  short video      the cream: clips under four minutes
 *   20%  captured posts   anything grabbed from the web (pixiv, boorus)
 *   15%  long video       episodes and films
 *   10%  images           everything else that is not manga
 *   10%  manga pages      present, deliberately rarer
 */
const base = and(
  eq(media.moderationState, "active"),
  sql`(('nsfw' = any(${media.tags})) or ('web-capture' = any(${media.tags})))`,
  sql`not ('game-asset' = any(${media.tags}))`,
  sql`not ('broken' = any(${media.tags}))`,
  sql`${media.mediaType} in ('video','image')`,
);

const isCaptured = sql`'web-capture' = any(${media.tags})`;
const isManga = sql`'manga-page' = any(${media.tags})`;
const shortVideo = and(base, eq(media.mediaType, "video"), sql`coalesce(${media.durationSeconds}, 0) between 1 and 240 and not ${isCaptured}`);
const longVideo = and(base, eq(media.mediaType, "video"), sql`(${media.durationSeconds} is null or ${media.durationSeconds} > 240) and not ${isCaptured}`);
const captured = and(base, isCaptured);
const mangaPages = and(base, isManga);
const images = and(base, sql`${media.mediaType} = 'image'`, sql`not ${isManga}`, sql`not ${isCaptured}`);

const BUCKETS: { weight: number; where: ReturnType<typeof and> }[] = [
  { weight: 0.45, where: shortVideo },
  { weight: 0.20, where: captured },
  { weight: 0.15, where: longVideo },
  { weight: 0.10, where: images },
  { weight: 0.10, where: mangaPages },
];

router.get("/watch/scroll", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const seed = String(req.query.seed ?? "0").slice(0, 40);
  const limit = Math.min(24, Math.max(1, Number(req.query.limit ?? 10)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  const level = String(req.query.level ?? "");
  const value = String(req.query.value ?? "").slice(0, 200);

  const notDismissed = sql`not exists (
    select 1 from watch_signals s
    where s.user_id = ${userId} and s.media_id = ${media.id} and s.reaction = 'dislike'
  )`;
  const lens = lensFilter(level, value);

  const parts = await Promise.all(BUCKETS.map(async (bucket) => {
    const where = and(bucket.where, notDismissed, lens);
    const take = Math.max(1, Math.round(limit * bucket.weight));
    const [rows, [{ count }]] = await Promise.all([
      db.select({
        id: media.id, objectKey: media.objectKey, title: media.title, collection: media.collection,
        tags: media.tags, mediaType: media.mediaType, durationSeconds: media.durationSeconds,
        createdAt: media.createdAt, galleryImages: media.galleryImages, kind: kindSql, creator: creatorSql, set: setSql,
      }).from(media).where(where)
        .orderBy(sql`md5(${media.id}::text || ${seed})`)
        .limit(take).offset(Math.round(offset * bucket.weight)),
      db.select({ count: sql<number>`count(*)::int` }).from(media).where(where),
    ]);
    return { rows, count };
  }));

  const seen = new Set<string>();
  const rows = parts
    .flatMap((part) => part.rows)
    .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, limit);
  const count = parts.reduce((total, part) => total + part.count, 0);

  const items = await Promise.all(rows.map(async (row) => {
    let streamUrl: string | null = null;
    try { streamUrl = sharedMediaUrl(req.baseUrl, row.id, userId); } catch { streamUrl = null; }
    const hasTile = await mediaObjectExists(previewKey(row.objectKey));
    return {
      id: row.id,
      mediaType: row.mediaType,
      title: row.title,
      collection: row.collection,
      tags: row.tags,
      pages: (() => {
        const cover = panelUrl(row.id, userId);
        const extras = (row as { galleryImages?: { id: string; contentType: string }[] }).galleryImages ?? [];
        return [
          { url: cover, contentType: "image" },
          ...extras.map((image) => ({ url: galleryUrl(row.id, image.id, userId), contentType: image.contentType })),
        ];
      })(),
      durationSeconds: row.durationSeconds,
      createdAt: row.createdAt,
      kind: row.kind,
      creator: row.creator,
      set: row.set,
      album: row.set ? row.set.split('/').filter(Boolean).slice(-1)[0] : null,
      streamUrl,
      posterUrl: hasTile
        ? `${req.baseUrl}/media/${row.id}/preview/image?ticket=${createMediaTicket(`preview:${row.id}`, userId)}`
        : null,
    };
  }));

  res.set("Cache-Control", "private, no-store");
  res.json({ items, total: count, seed, offset, level: level || null, value: value || null });
});

/**
 * The feedback loop. One button, one meaning: this item does not belong in the
 * loop, now or on the next draw. Stored as a dislike signal, which excludes it
 * from every lens.
 */
router.post("/watch/dismiss", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const id = String(req.body?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ error: "Invalid media ID." }); return; }
  await db.insert(signals)
    .values({ userId, mediaId: id, reaction: "dislike" })
    .onConflictDoUpdate({ target: [signals.userId, signals.mediaId], set: { reaction: "dislike", updatedAt: new Date() } });
  res.set("Cache-Control", "private, no-store");
  res.json({ ok: true, id });
});

/**
 * One panel, a few honest labels.
 *
 *   broken          the file is unreadable; never show it again
 *   game-artifact   it is a game asset that slipped the import filter
 *   manga           it is a page from a set that was never catalogued
 *   dismiss         not for me
 *
 * "manga" returns an analysis of the folder instead of writing anything: page
 * count and the first/last file. Confirming turns the whole folder into a manga
 * set, at which point the loop stops showing its pages.
 */
const LABEL_TAGS: Record<string, string> = { broken: "broken", "game-artifact": "game-asset" };

const sourceOf = sql<string>`substring(${media.description} from 'Source: ([^[:cntrl:]]*)')`;
const folderOf = sql<string>`regexp_replace(${media.description}, '/[^/]+$', '')`;

router.post("/watch/label", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const id = String(req.body?.id ?? "");
  const label = String(req.body?.label ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(400).json({ error: "Invalid media ID." }); return; }

  const [item] = await db.select({ description: media.description }).from(media).where(eq(media.id, id)).limit(1);
  if (!item) { res.status(404).json({ error: "Media item not found." }); return; }
  const source = /Source: ([^\n]*)/.exec(item.description ?? "")?.[1]?.trim() ?? "";
  const folder = source.split("/").slice(0, -1).join("/");

  if (label === "dismiss") {
    await db.insert(signals).values({ userId, mediaId: id, reaction: "dislike" })
      .onConflictDoUpdate({ target: [signals.userId, signals.mediaId], set: { reaction: "dislike", updatedAt: new Date() } });
    res.json({ ok: true });
    return;
  }

  if (label === "manga") {
    const analysis = await db.execute<{ pages: number; first: string; last: string }>(sql`
      select count(*)::int as pages,
             min(regexp_replace(${sourceOf}, '^.*/', '')) as first,
             max(regexp_replace(${sourceOf}, '^.*/', '')) as last
      from ${media}
      where ${sourceOf} like ${folder + "/%"}
    `);
    res.json({ ok: true, analysis: { ...analysis.rows[0], folder } });
    return;
  }

  if (label === "manga-confirm") {
    const result = await db.execute(sql`
      update ${media}
      set collection = 'Manga',
          tags = case when 'manga-page' = any(tags) then tags else array_append(tags, 'manga-page') end
      where ${sourceOf} like ${folder + "/%"}
    `);
    res.json({ ok: true, pages: result.rowCount ?? 0, folder });
    return;
  }

  const tag = LABEL_TAGS[label];
  if (!tag) { res.status(400).json({ error: "Unknown label." }); return; }
  await db.execute(sql`
    update ${media}
    set tags = case when ${tag} = any(tags) then tags else array_append(tags, ${tag}) end
    where id = ${id}
  `);
  res.json({ ok: true, tag });
});

export default router;
