-- REVIEW ONLY: additive backfill for captures made before Source lines existed.
-- No automatic production migration; run by hand after reading it, and try
-- `BEGIN; ... ROLLBACK;` first to see the row count.
--
-- Captured posts carry the artist and the page in their description but no
-- `Source:` path, and the watch feed's kind/creator/set lenses read that path.
-- This appends the same line the capture route now writes, built from the data
-- already stored, and only where it is missing. Rows whose artist cannot be
-- read are skipped rather than guessed at.
WITH rows AS (
  SELECT id,
         trim(regexp_replace(substring(description from 'Artist: ([^\n[:cntrl:]]*)'), '[/\[\]\r\n]', ' ', 'g')) AS artist,
         (regexp_match(substring(description from 'Page: ([^\n[:cntrl:]]*)'), 'artworks/(\d+)'))[1] AS illust
  FROM media_items
  WHERE 'pixiv-post' = any(tags)
    AND description NOT LIKE '%Source: %'
)
UPDATE media_items AS m
SET description = m.description || E'\nSource: pixiv/[' || r.artist || ']' || coalesce('/' || r.illust, '')
FROM rows AS r
WHERE m.id = r.id
  AND r.artist <> '';
