import { canonicalHashtag } from "./annotation-labels";

/**
 * Single tag-key contract shared by ingestion, affinity and the feed.
 * It is exactly the transform social-feed.ts already applies to public tags:
 * canonical hashtags when possible, otherwise a conservative NFKC lowercase
 * fallback. Danbooru-style tags (underscores, parentheses, punctuation) take
 * the fallback path, so this must not be "improved" without a migration.
 */
export function tagKey(raw: string): string {
  try {
    return canonicalHashtag(raw);
  } catch {
    return raw.normalize("NFKC").trim().toLowerCase();
  }
}

/** True when the tag needed the fallback path (useful for coverage reporting). */
export function tagKeyFellBack(raw: string): boolean {
  try {
    canonicalHashtag(raw);
    return false;
  } catch {
    return true;
  }
}
