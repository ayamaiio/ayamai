// The feed's depth stack: which lenses narrow it, and where a tag fits.
//
// The ladder is kind → creator → set, derived from the library's source path.
// A tag is not a rung — you can jump straight to one — so it must not consume
// a rung of the ladder, or "deeper" would skip a level.

export const LADDER = ["kind", "creator", "set"] as const;
export type LensLevel = (typeof LADDER)[number] | "tag";
export type Lens = { level: LensLevel; value: string; label: string };

export const isLadderLens = (lens: Lens): boolean => (LADDER as readonly string[]).includes(lens.level);

/** How many rungs of the ladder are in the stack — a tag lens is not one. */
export function ladderDepth(lenses: Lens[]): number {
  return (Array.isArray(lenses) ? lenses : []).filter(isLadderLens).length;
}

/** Pure: a hastag as the API wants it — lowercase, no `#`, no spaces, 40 chars. */
export function normalizeTag(tag: string): string {
  return String(tag ?? "").trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "-").slice(0, 40);
}

/** Pure: jumping to a tag replaces the stack, so the breadcrumb reads honestly. */
export function tagLens(tag: string): Lens | null {
  const value = normalizeTag(tag);
  return value ? { level: "tag", value, label: `#${value}` } : null;
}

export function creatorLens(name: string): Lens | null {
  const value = String(name ?? "").trim();
  return value ? { level: "creator", value, label: value } : null;
}

/** Pure: the tags worth showing on a slide, without the bookkeeping ones. */
const NOISE = new Set(["web-capture", "pixiv-post", "nsfw", "bookmark", "local-import", "manga-page"]);

export function displayTags(tags: string[], limit = 4): { shown: string[]; rest: string[] } {
  const clean = (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag ?? "").trim())
    .filter((tag) => tag && !NOISE.has(tag.toLowerCase()));
  return { shown: clean.slice(0, limit), rest: clean.slice(limit) };
}
