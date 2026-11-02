-- Additive and safe to rerun. Apply to the target database before releasing
-- the API that reads gallery_images. Existing single-file posts remain intact.
BEGIN;
ALTER TABLE media_items
  ADD COLUMN IF NOT EXISTS gallery_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS submission_id uuid,
  ADD COLUMN IF NOT EXISTS submission_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS media_items_user_submission_idx
  ON media_items (user_id, submission_id);
CREATE INDEX IF NOT EXISTS media_items_gallery_images_idx
  ON media_items USING gin (gallery_images);
COMMIT;
