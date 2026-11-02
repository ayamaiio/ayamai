import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { sharedMediaUrl } from "../lib/shared-delivery";
import { isNotGameAsset } from "../lib/media-classification";
import { getRequestUserId } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Hentai content did not arrive as series/chapters. It arrived as folders of
// images (game asset sets, doujin pages), so an album is a directory.

const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 60_000;

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function rows<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

const DIR = sql`regexp_replace(substring(description from 'Source: ([^\n]+)'), '/[^/]+$', '')`;

router.get("/albums", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const albums = await cached(`albums:${userId}`, async () => {
    const found = await rows<{ dir: string; items: string; cover: string }>(sql`
      SELECT ${DIR} AS dir,
             count(*) AS items,
             (array_agg(id ORDER BY original_name))[1] AS cover
      FROM media_items
      WHERE user_id = ${userId} AND collection = 'Hentai' AND media_type = 'image'
        AND ${isNotGameAsset}
      GROUP BY dir
      HAVING count(*) >= 2
      ORDER BY count(*) DESC
      LIMIT 400
    `);
    return found.map((r) => ({
      dir: r.dir,
      name: r.dir.split("/").slice(-1)[0],
      items: Number(r.items),
      cover: r.cover,
    }));
  });
  const local = Boolean(process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim());
  res.set("Cache-Control", "private, max-age=60");
  res.json({
    albums: albums.map((a) => ({ ...a, coverUrl: local ? sharedMediaUrl(req.baseUrl, a.cover, userId) : null })),
  });
});

router.get("/albums/assets", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const albums = await cached(`assets:${userId}`, async () => {
    const found = await rows<{ dir: string; items: string; cover: string }>(sql`
      SELECT ${DIR} AS dir,
             count(*) AS items,
             (array_agg(id ORDER BY original_name))[1] AS cover
      FROM media_items
      WHERE user_id = ${userId} AND 'game-asset' = any(tags) AND media_type = 'image'
      GROUP BY dir
      ORDER BY count(*) DESC
      LIMIT 200
    `);
    return found.map((r) => ({ dir: r.dir, name: r.dir.split("/").slice(-2).join("/"), items: Number(r.items), cover: r.cover }));
  });
  const local = Boolean(process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim());
  res.set("Cache-Control", "private, max-age=60");
  res.json({ albums: albums.map((a) => ({ ...a, coverUrl: local ? sharedMediaUrl(req.baseUrl, a.cover, userId) : null })) });
});

router.get("/albums/items", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  const dir = typeof req.query.dir === "string" ? req.query.dir : "";
  if (!dir) { res.status(400).json({ error: "dir is required." }); return; }

  const items = await cached(`album:${userId}:${dir}`, async () => {
    const found = await rows<{ id: string; name: string }>(sql`
      SELECT id, original_name AS name
      FROM media_items
      WHERE user_id = ${userId} AND collection = 'Hentai' AND media_type = 'image'
        AND ${DIR} = ${dir}
      ORDER BY original_name
    `);
    return found;
  });

  if (!items.length) { res.status(404).json({ error: "No such album." }); return; }
  const local = Boolean(process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim());
  res.set("Cache-Control", "private, max-age=60");
  res.json({
    dir,
    items: items.map((i) => ({ ...i, url: local ? sharedMediaUrl(req.baseUrl, i.id, userId) : null })),
  });
});

export default router;
