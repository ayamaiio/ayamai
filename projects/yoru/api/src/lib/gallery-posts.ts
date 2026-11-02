import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { CreateGalleryPostBody } from "@workspace/api-zod";
import { db, mediaItemsTable as media, type MediaItem } from "@workspace/db";
import { deleteMediaObject, deleteMediaPreviews, isSupportedMediaContentType, verifyUploadedObject } from "./r2Storage";
import { postValues, SocialError } from "./social-access";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type GalleryInput = z.infer<typeof CreateGalleryPostBody>;

export function postAttachments(item: Pick<MediaItem, "id" | "mediaType" | "contentType" | "galleryImages">) {
  if (item.mediaType !== "image") return [];
  return [
    { id: item.id, contentType: item.contentType, position: 0 },
    ...(item.galleryImages ?? []).map((image, i) => ({ id: image.id, contentType: image.contentType, position: i + 1 })),
  ];
}

export function validateGalleryUploads(userId: string, images: GalleryInput["images"]) {
  if (!images.length || images.length > 20) throw new SocialError(400, "Choose between 1 and 20 images or GIFs.");
  if (new Set(images.map(image => image.objectKey)).size !== images.length) throw new SocialError(400, "Each image must have its own upload.");
  for (const image of images) {
    if (!image.objectKey.startsWith(`media/${userId}/`) || image.objectKey.length > 1024 ||
      image.objectKey.split("/").some(part => part === "." || part === "..")) {
      throw new SocialError(400, "This upload does not belong to your account.");
    }
    if (!isSupportedMediaContentType("image", image.contentType)) throw new SocialError(415, "Image posts support images and GIFs, not videos.");
  }
}

// Serialize claims across both legacy single-file and gallery publication.
// Sorted locks avoid deadlocks when two submissions share several object keys.
export async function lockUploadKeys(tx: Transaction, keys: string[]) {
  for (const key of [...new Set(keys)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
}
export async function findUploadClaim(tx: Transaction, keys: string[]) {
  const [claimed] = await tx.select().from(media).where(or(
    inArray(media.objectKey, keys),
    ...keys.map(key => sql`${media.galleryImages} @> ${JSON.stringify([{ objectKey: key }])}::jsonb`),
  )).limit(1);
  return claimed;
}

export async function deletePostObjects(item: Pick<MediaItem, "objectKey" | "galleryImages">, dependencies: {
  remove?: typeof deleteMediaObject;
  removePreviews?: typeof deleteMediaPreviews;
} = {}) {
  for (const key of new Set([...(item.galleryImages ?? []).map(image => image.objectKey), item.objectKey])) {
    await (dependencies.removePreviews ?? deleteMediaPreviews)(key);
    await (dependencies.remove ?? deleteMediaObject)(key);
  }
}

export async function recordGalleryPost(userId: string, input: GalleryInput, dependencies: {
  verify?: typeof verifyUploadedObject;
  posting?: typeof postValues;
} = {}) {
  validateGalleryUploads(userId, input.images);
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const existing = async () => {
    const [post] = await db.select().from(media).where(and(eq(media.userId, userId), eq(media.submissionId, input.submissionId))).limit(1);
    if (post && post.submissionHash !== hash) throw new SocialError(409, "This post was already submitted with different contents.");
    return post;
  };
  // A lost response can be retried even if the original short-lived upload URL expired.
  const previous = await existing();
  if (previous) return previous;
  const posting = await (dependencies.posting ?? postValues)(userId, input.posting);
  for (const image of input.images) {
    if (!(await (dependencies.verify ?? verifyUploadedObject)(image.objectKey, image.size, image.contentType))) {
      throw new SocialError(400, "An uploaded image could not be verified. No post was published; retry the upload.");
    }
  }
  return db.transaction(async tx => {
    await lockUploadKeys(tx, [`gallery-submission:${userId}:${input.submissionId}`, ...input.images.map(image => image.objectKey)]);
    const [retry] = await tx.select().from(media).where(and(eq(media.userId, userId), eq(media.submissionId, input.submissionId))).limit(1);
    if (retry) {
      if (retry.submissionHash !== hash) throw new SocialError(409, "This post was already submitted with different contents.");
      return retry;
    }
    if (await findUploadClaim(tx, input.images.map(image => image.objectKey))) throw new SocialError(409, "An image is already part of another post. Upload it again to create a new post.");
    const [cover, ...images] = input.images;
    const [created] = await tx.insert(media).values({
      ...posting,
      userId, title: input.title?.trim() || cover.originalName.replace(/\.[^.]+$/, "").slice(0, 255) || "Image post",
      originalName: cover.originalName, objectKey: cover.objectKey, contentType: cover.contentType, size: cover.size,
      mediaType: "image", collection: input.collection?.trim().replace(/\s+/g, " ") || null,
      submissionId: input.submissionId, submissionHash: hash,
      galleryImages: images.map(image => ({ ...image, id: randomUUID() })),
    }).returning();
    return created;
  });
}
