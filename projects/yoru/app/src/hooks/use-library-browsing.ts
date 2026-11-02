import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { listMedia } from "@workspace/api-client-react";

export type LibraryFilters = {
  search: string;
  kind: "all" | "image" | "video";
  favorites: boolean;
  collectionFilter: string;
  uncategorized: boolean;
};
type Anchor = { id: string; top: number };
type Bookmark = { filters: LibraryFilters; anchor: Anchor | null };
const defaults: LibraryFilters = {
  search: "", kind: "all", favorites: false, collectionFilter: "", uncategorized: false,
};
const storageKey = (accountId: string) => `afterframe:library:v1:${accountId}`;

export function readLibraryBookmark(accountId: string): Bookmark {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(accountId)) ?? "null");
    const f = value?.filters;
    if (f && typeof f.search === "string" && ["all", "image", "video"].includes(f.kind)
      && typeof f.favorites === "boolean" && typeof f.collectionFilter === "string"
      && typeof f.uncategorized === "boolean" && !(f.collectionFilter && f.uncategorized)) {
      const a = value.anchor;
      return {
        filters: f,
        anchor: a && typeof a.id === "string" && /^[0-9a-f-]{36}$/i.test(a.id)
          && Number.isFinite(a.top) && Math.abs(a.top) < 10000 ? a : null,
      };
    }
  } catch { /* Storage can be unavailable or contain an old/corrupt value. */ }
  return { filters: { ...defaults }, anchor: null };
}

// The caller keys its Library component by authenticated account ID. All refs,
// filters, requests and delayed writes therefore belong to exactly one account.
export function useLibraryBrowsing(accountId: string) {
  const [initial] = useState(() => readLibraryBookmark(accountId));
  const [filters, setFilters] = useState(initial.filters);
  const [anchor, setAnchor] = useState(initial.anchor);
  const gridRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const prependAnchor = useRef<Anchor | null>(null);
  const saved = useRef<Bookmark>(initial);
  const params = {
    q: filters.search || undefined, type: filters.kind,
    favorites: filters.favorites || undefined,
    collection: filters.collectionFilter || undefined,
    uncategorized: filters.uncategorized || undefined,
  };
  const list = useInfiniteQuery({
    queryKey: ["/api/media", "library", accountId, params, anchor?.id],
    queryFn: ({ pageParam, signal }) => listMedia({
      ...params, limit: 60, offset: pageParam.offset, anchorId: pageParam.anchorId,
    }, { signal }),
    initialPageParam: { offset: 0, anchorId: anchor?.id } as { offset: number; anchorId?: string },
    getNextPageParam: (last) => last.offset + last.items.length < last.total && last.items.length
      ? { offset: last.offset + last.items.length } : undefined,
    // Offset windows may not align with page boundaries; limit the earlier page
    // to the gap so the UI never renders overlapping media.
    getPreviousPageParam: (first) => first.offset > 0 ? { offset: Math.max(0, first.offset - 60) } : undefined,
  });
  const items = list.data?.pages.flatMap((page, index, pages) => {
    const nextOffset = pages[index + 1]?.offset;
    return nextOffset === undefined ? page.items : page.items.slice(0, nextOffset - page.offset);
  }) ?? [];

  function visibleAnchor(): Anchor | null {
    const cards = gridRef.current?.querySelectorAll<HTMLElement>("[data-media-id]");
    if (!cards) return null;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom > 80 && rect.top < window.innerHeight) {
        return { id: card.dataset.mediaId!, top: rect.top };
      }
    }
    return null;
  }
  function write() {
    try { localStorage.setItem(storageKey(accountId), JSON.stringify(saved.current)); }
    catch { /* Browsing remains available if the browser blocks storage. */ }
  }
  function capture() {
    if (!restored.current) return;
    saved.current = { filters, anchor: visibleAnchor() };
    write();
  }
  function position(target: Anchor | null) {
    const card = target && Array.from(gridRef.current?.querySelectorAll<HTMLElement>("[data-media-id]") ?? [])
      .find((node) => node.dataset.mediaId === target.id);
    window.scrollTo({ top: card ? Math.max(0, window.scrollY + card.getBoundingClientRect().top - target!.top) : 0, behavior: "instant" });
  }
  useLayoutEffect(() => () => {
    // Save synchronously before React removes the grid, including navigation
    // that happens before the throttled scroll callback has run.
    if (restored.current) {
      saved.current = { ...saved.current, anchor: visibleAnchor() ?? saved.current.anchor };
      write();
    }
  }, [accountId]);
  useLayoutEffect(() => {
    if (!list.isSuccess) return;
    if (!restored.current) {
      position(anchor);
      restored.current = true;
    } else if (prependAnchor.current && !list.isFetchingPreviousPage) {
      position(prependAnchor.current);
      prependAnchor.current = null;
    }
  }, [list.data, list.isSuccess, list.isFetchingPreviousPage, filters, anchor]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(capture);
    };
    const onHidden = () => { if (document.visibilityState === "hidden") capture(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", capture);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", capture);
      document.removeEventListener("visibilitychange", onHidden);
      // The DOM may already be gone on unmount. Keep the last scroll snapshot.
      write();
    };
  }, [filters, accountId]);

  function changeFilter<K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) {
    const next = { ...filters, [key]: value };
    if (key === "collectionFilter") next.uncategorized = false;
    if (key === "uncategorized" && value) next.collectionFilter = "";
    restored.current = false;
    setAnchor(null);
    setFilters(next);
    saved.current = { filters: next, anchor: null };
    write();
  }
  function clearFilters() {
    restored.current = false;
    setAnchor(null);
    setFilters({ ...defaults });
    saved.current = { filters: { ...defaults }, anchor: null };
    write();
  }
  function loadEarlier() {
    prependAnchor.current = visibleAnchor();
    void list.fetchPreviousPage();
  }
  return { filters, changeFilter, clearFilters, list, items, gridRef, capture, loadEarlier };
}
