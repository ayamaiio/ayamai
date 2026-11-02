import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { sharedMediaUrl } from "../lib/shared-delivery";
import { getRequestUserId } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Series and chapters are derived from the Source line the importer wrote into
// each row's description. Nothing is denormalised, so the library can be
// re-read without a migration.
const SOURCE = /^Source: (.+)$/m;

type SeriesRow = { series: string; pages: number; chapters: number; cover: string };

const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 60_000;

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

async function rows<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

router.get("/manga/series", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const list = await cached<SeriesRow[]>(`series:${userId}`, async () => {
    const found = await rows<{ series: string; pages: string; chapters: string; cover: string }>(sql`
      WITH parsed AS (
        SELECT id, original_name,
               split_part(substring(description from 'Source: ([^\n]+)'), '/', 1) AS series,
               split_part(substring(description from 'Source: ([^\n]+)'), '/', 2) AS chapter
        FROM media_items
        WHERE user_id = ${userId} AND collection = 'Manga' AND media_type = 'image'
      )
      SELECT series,
             count(*) AS pages,
             count(DISTINCT chapter) AS chapters,
             (array_agg(id ORDER BY chapter, original_name))[1] AS cover
      FROM parsed
      WHERE series <> '' AND chapter <> ''
      GROUP BY series
      HAVING count(*) > 1
    `);
    return found
      .map((r) => ({ series: r.series, pages: Number(r.pages), chapters: Number(r.chapters), cover: r.cover }))
      .sort((a, b) => natural(a.series, b.series));
  });
  const local = Boolean(process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim());
  res.set("Cache-Control", "private, max-age=60");
  res.json({
    series: list.map((s) => ({ ...s, coverUrl: local ? sharedMediaUrl(req.baseUrl, s.cover, userId) : null })),
  });
});

router.get("/manga/series/:series", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const series = req.params.series;
  const chapters = await cached(`chapters:${userId}:${series}`, async () => {
    const found = await rows<{ chapter: string; pages: string; first: string }>(sql`
      SELECT split_part(substring(description from 'Source: ([^\n]+)'), '/', 2) AS chapter,
             count(*) AS pages,
             (array_agg(id ORDER BY original_name))[1] AS first
      FROM media_items
      WHERE user_id = ${userId} AND collection = 'Manga' AND media_type = 'image'
        AND split_part(substring(description from 'Source: ([^\n]+)'), '/', 1) = ${series}
      GROUP BY chapter
      HAVING count(*) > 0
    `);
    return found
      .map((r) => ({ chapter: r.chapter, pages: Number(r.pages), first: r.first }))
      .sort((a, b) => natural(a.chapter, b.chapter));
  });
  if (!chapters.length) { res.status(404).json({ error: "No such series." }); return; }
  res.set("Cache-Control", "private, max-age=60");
  res.json({ series, chapters });
});

router.get("/manga/series/:series/:chapter", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const { series, chapter } = req.params;
  const pages = await cached(`pages:${userId}:${series}:${chapter}`, async () => {
    const found = await rows<{ id: string; name: string }>(sql`
      SELECT id, original_name AS name
      FROM media_items
      WHERE user_id = ${userId} AND collection = 'Manga' AND media_type = 'image'
        AND split_part(substring(description from 'Source: ([^\n]+)'), '/', 1) = ${series}
        AND split_part(substring(description from 'Source: ([^\n]+)'), '/', 2) = ${chapter}
    `);
    return found.sort((a, b) => natural(a.name, b.name));
  });
  if (!pages.length) { res.status(404).json({ error: "No such chapter." }); return; }
  const local = Boolean(process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim());
  res.set("Cache-Control", "private, max-age=60");
  res.json({
    series, chapter,
    pages: pages.map((p) => ({ ...p, url: local ? sharedMediaUrl(req.baseUrl, p.id, userId) : null })),
  });
});

export default router;
