import type { PostAttachment, SocialPost } from "@workspace/api-client-react";
import { MAX_FILE_SIZE, getMediaFileInfo } from "./direct-upload";
import type { MediaFileInfo } from "./direct-upload";

export const MAX_GALLERY_IMAGES = 20;

export type SelectionKind = "empty" | "images" | "video";
export type Candidate = { name: string; type: string; size: number };

/**
 * Decide what a new selection adds to the current one. A post is either up to
 * 20 ordered images (incl. GIFs) or exactly one video; never a mix.
 */
export function admitFiles<T extends Candidate>(currentKind: SelectionKind, currentCount: number, incoming: T[]) {
  const accepted: { file: T; info: MediaFileInfo }[] = [];
  const problems = new Set<string>();
  let kind = currentKind;
  let count = currentCount;
  for (const file of incoming) {
    const info = getMediaFileInfo(file);
    if (!info) { problems.add("Some files aren’t a supported image or video."); continue; }
    if (file.size === 0) { problems.add("Empty files were skipped."); continue; }
    if (file.size > MAX_FILE_SIZE) { problems.add("Files over 5 GB were skipped."); continue; }
    if (info.mediaType === "video") {
      if (kind !== "empty") { problems.add("A post holds either images or one video. Use bulk import for mixed batches."); continue; }
      kind = "video"; count = 1;
      accepted.push({ file, info });
      continue;
    }
    if (kind === "video") { problems.add("A post holds either images or one video. Use bulk import for mixed batches."); continue; }
    if (count >= MAX_GALLERY_IMAGES) { problems.add(`A post holds up to ${MAX_GALLERY_IMAGES} images.`); continue; }
    kind = "images"; count += 1;
    accepted.push({ file, info });
  }
  return { accepted, kind, problems: Array.from(problems) };
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list.slice();
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** True when the server may or may not have created the post (retry must reuse the same submission). */
export function isAmbiguousFailure(status: number | undefined) {
  if (status === undefined) return true;
  if (status === 408 || status === 409 || status === 429) return true;
  return status >= 500;
}

/** Ordered slides of a post. Old clients/data may omit attachments; videos have none. */
export function gallerySlides(post: Pick<SocialPost, "id" | "mediaType" | "attachments">): PostAttachment[] {
  if (post.mediaType === "video" || !post.attachments?.length) return [];
  return post.attachments.slice().sort((a, b) => a.position - b.position);
}

export function clampSlide(index: number, total: number) {
  return Math.max(0, Math.min(total - 1, index));
}
