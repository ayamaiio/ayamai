/** Patch only matching post totals, preserving feed ordering and pagination. */
export function withVideoViewCount(data: unknown, id: string, count: number, visibility: "public" | "private"): unknown {
  if (!data || typeof data !== "object" || !Number.isSafeInteger(count) || count < 0) return data;
  if (Array.isArray(data)) {
    const updated = data.map(value => withVideoViewCount(value, id, count, visibility));
    return updated.some((value, i) => value !== data[i]) ? updated : data;
  }
  const object = data as Record<string, unknown>;
  if (object.id === id && "likeCount" in object && object.visibility === visibility) {
    const next = Math.max(typeof object.viewCount === "number" ? object.viewCount : 0, count);
    return object.viewCount === next ? data : { ...object, viewCount: next };
  }
  let result = object;
  for (const key of ["pages", "items", "posts", "post"]) {
    if (!(key in object)) continue;
    const next = withVideoViewCount(object[key], id, count, visibility);
    if (next !== object[key]) result = { ...result, [key]: next };
  }
  return result;
}
