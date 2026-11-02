import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { forgetPost } from "@/social/social-lib";
import { forgetVideoProgress } from "./video-progress";

/** Remove a deleted item without resetting scroll position or page cursors. */
function removeFromLists(data: unknown, id: string): unknown {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) {
    const next = data.filter(item => !item || typeof item !== "object" || item.id !== id)
      .map(item => removeFromLists(item, id));
    return next.length !== data.length || next.some((item, i) => item !== data[i]) ? next : data;
  }
  const source = data as Record<string, unknown>;
  let result = source;
  for (const key of ["pages", "items", "posts"]) {
    if (!(key in source)) continue;
    const next = removeFromLists(source[key], id);
    if (next !== source[key]) result = { ...result, [key]: next };
  }
  return result;
}

/** Each deleted post counts once, regardless of the number of images inside it. */
export function withoutDeletedMedia(data: unknown, id: string): unknown {
  const next = removeFromLists(data, id);
  if (next === data) return data;
  const updateTotals = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const source = value as Record<string, unknown>;
    const result = { ...source };
    if (typeof source.total === "number") result.total = Math.max(0, source.total - 1);
    // Every loaded page reports the same collection total, even when the
    // removed post occurred on a different page.
    if (Array.isArray(source.pages)) result.pages = source.pages.map(updateTotals);
    return result;
  };
  return updateTotals(next);
}

const isMediaList = ({ queryKey }: { queryKey: QueryKey }) => {
  const path = String(queryKey[0]);
  return ["/api/media", "/api/watch/feed", "/api/social/feed", "/api/social/saved", "/api/social/videos"].includes(path)
    || path.startsWith("/api/social/profiles/");
};

export async function forgetDeletedMedia(client: QueryClient, id: string, uid: string) {
  await client.cancelQueries({ predicate: isMediaList });
  client.setQueriesData({ predicate: isMediaList }, data => withoutDeletedMedia(data, id));
  forgetPost(client, id);
  forgetVideoProgress(client, uid, id);
  await Promise.all([
    // Refetching every loaded infinite page here would jump the viewer and can hit rate limits.
    client.invalidateQueries({ predicate: isMediaList, refetchType: "none" }),
    client.invalidateQueries({ queryKey: ["/api/media/summary"] }),
    client.invalidateQueries({ queryKey: ["/api/media/collections"] }),
  ]);
}
