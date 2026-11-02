import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, mediaItemsTable as media, pool } from "@workspace/db";
import { postDTOs } from "./social-posts";

test("public video DTOs never share the poster's private playback position", async () => {
  const owner = `progress-test-${randomUUID()}`;
  const [item] = await db.insert(media).values({
    userId: owner, title: "Synthetic progress fixture", originalName: "fixture.mp4",
    objectKey: `test-fixtures/${randomUUID()}`, contentType: "video/mp4",
    mediaType: "video", size: 1, visibility: "public", durationSeconds: 120, progressSeconds: 30,
  }).returning();
  try {
    assert.equal((await postDTOs([item!], owner))[0]?.progressSeconds, 30);
    assert.equal((await postDTOs([item!], `viewer-${randomUUID()}`))[0]?.progressSeconds, null);
  } finally {
    await db.delete(media).where(eq(media.id, item!.id));
    await pool.end();
  }
});
