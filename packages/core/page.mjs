// Paging a list, once, for every surface that might grow.
//
// The rules are boring on purpose: a default size, a ceiling, and an honest
// total - so a page can say "Showing 50 of 27,551" and mean it.

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

const whole = (value, fallback) => {
  // Number(null) is 0, and a missing query param is null: absent is not zero
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : fallback;
};

/** Pure: one page of a list, clamped. Never throws, never returns more than `max`. */
export function page(items, { limit = DEFAULT_LIMIT, offset = 0, max = MAX_LIMIT } = {}) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.min(max, Math.max(1, whole(limit, DEFAULT_LIMIT)));
  const start = Math.max(0, whole(offset, 0));
  return {
    items: list.slice(start, start + size),
    total: list.length,
    offset: start,
    limit: size,
    more: start + size < list.length,
  };
}

/** Pure: read the paging numbers off a URL's search params. */
export function paging(searchParams, options = {}) {
  return {
    limit: whole(searchParams?.get?.("limit"), options.limit ?? DEFAULT_LIMIT),
    offset: whole(searchParams?.get?.("offset"), options.offset ?? 0),
    max: options.max ?? MAX_LIMIT,
  };
}
