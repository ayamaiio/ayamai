// Repair: posts pulled before the importer fix arrived as one row per page.
// Group them by the pixiv artwork in their description, keep the first as the
// cover, hang the rest off it as gallery attachments, and drop the extras.
import { readFileSync } from "node:fs";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

if (!process.env.DATABASE_URL) {
  const env = readFileSync(`${process.env.HOME}/ayamai-deepseek/.env`, "utf8");
  process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
}

const result = await db.execute(sql`
  select id, title, description, object_key, content_type, size, created_at
  from media_items
  where 'web-capture' = any(tags)
    and description ~ 'pixiv\.net/artworks/[0-9]+'
  order by created_at asc
`);
const rows = Array.isArray(result) ? result : (result.rows ?? []);

const groups = new Map();
for (const row of rows) {
  const id = String(row.description ?? "").match(/pixiv\.net\/artworks\/(\d+)/)?.[1];
  if (!id) continue;
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push(row);
}

let merged = 0;
let removed = 0;
for (const [, group] of groups) {
  if (group.length < 2) continue;
  const [cover, ...rest] = group;
  const gallery = rest.map((row) => ({
    id: String(row.id),
    objectKey: String(row.object_key),
    originalName: String(row.title).slice(0, 120),
    contentType: String(row.content_type ?? "image/jpeg"),
    size: Number(row.size ?? 0),
  }));
  const total = group.reduce((sum, row) => sum + Number(row.size ?? 0), 0);
  const cleanTitle = String(cover.title).replace(/\s*\(\d+\/\d+\)$/, "");

  await db.execute(sql`
    update media_items
       set gallery_images = ${JSON.stringify(gallery)}::jsonb,
           title = ${cleanTitle},
           size = ${total},
           tags = (select array(select distinct unnest(tags || array['pixiv-post','bookmark'])))
     where id = ${cover.id}::uuid
  `);
  const ids = rest.map((row) => String(row.id));
  await db.execute(sql`delete from media_items where id = any(${ids}::uuid[])`);
  merged += 1;
  removed += rest.length;
}

console.log(`merged ${merged} posts, removed ${removed} stray page rows`);
process.exit(0);
