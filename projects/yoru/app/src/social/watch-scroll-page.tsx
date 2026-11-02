import { useCallback, useEffect, useRef, useState } from "react";
import { classifyDwell, isConsumeView, nextPage, sendSignal } from "./feed-signals";
import { LADDER, creatorLens, displayTags, ladderDepth, tagLens, type Lens } from "./feed-lenses";
import { Link } from "wouter";
import { ArrowUp, ChevronsLeft, ChevronsRight, Eye, EyeOff, Flag, Heart, Images, Maximize2, Shuffle, Volume2, VolumeX } from "lucide-react";

/**
 * The loop, in two dimensions.
 *
 *   up / down   next item
 *   in / out    depth — narrow the lens to this kind, this creator, this set,
 *               or widen it back out
 *
 * A lens is a plain equality on a path-derived column, so the deck is a stable
 * shuffle at any depth and the item you are watching never moves when the lens
 * changes. The breadcrumb is the whole state, and every crumb is clickable.
 */

type Item = {
  id: string;
  mediaType: "video" | "image";
  title: string;
  album: string | null;
  collection: string | null;
  tags: string[];
  durationSeconds: number | null;
  createdAt: string;
  kind: string | null;
  creator: string | null;
  set: string | null;
  artist?: string | null;
  pageUrl?: string | null;
  description?: string | null;
  streamUrl: string | null;
  posterUrl: string | null;
  pages?: { url: string; contentType: string }[];
};

const PAGE = 8;
const MUTED_KEY = "ayamai:watch:muted";
const CHROME_KEY = "ayamai:watch:chrome";
const clock = (seconds: number | null) => {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const setLabel = (value: string) => value.split("/").filter(Boolean).slice(-1)[0] ?? value;

/** The next tighter lens that this item can actually justify. */
function deeper(item: Item, depth: number): Lens | null {
  for (let i = depth; i < LADDER.length; i += 1) {
    const level = LADDER[i];
    const value = item[level];
    if (!value) continue;
    return { level, value, label: level === "set" ? setLabel(value) : value };
  }
  return null;
}

function Slide({ item, active, nearby, muted, onToggleMute, onAdvance, onAdvancePage, page, onPage, index, play, onTag, onCreator }: {
  item: Item; active: boolean; nearby: boolean; muted: boolean; onToggleMute: () => void; onAdvance: () => void; onAdvancePage: () => void; page: number; onPage: (delta: number) => void; index: number; play: boolean; onTag: (tag: string) => void; onCreator: (name: string) => void;
}) {
  const [panel, setPanel] = useState(false);
  const [analysis, setAnalysis] = useState<{ pages: number; first: string; last: string } | null>(null);
  const [note, setNote] = useState("");

  async function label(kind: string) {
    if (kind === "manga-confirm") {
      const res = await fetch("/api/watch/label", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, label: kind }),
      });
      const data = await res.json() as { pages?: number };
      setNote(`${data.pages ?? 0} pages catalogued`);
      setPanel(false);
      onAdvance();
      return;
    }
    try {
      const res = await fetch("/api/watch/label", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, label: kind }),
      });
      const data = await res.json() as { analysis?: { pages: number; first: string; last: string } };
      if (kind === "manga" && data.analysis) { setAnalysis(data.analysis); return; }
      setPanel(false);
      onAdvance();
    } catch { setNote("could not save"); }
  }
  const swiped = useRef<{ x: number; y: number } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState(0);
  const pages = item.pages ?? [];
  const pageCount = pages.length || 1;
  const current = pages[Math.min(page, pageCount - 1)]?.url ?? item.streamUrl;
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const seenAt = useRef<number | null>(null);
  const endedOnce = useRef(false);

  useEffect(() => {
    const node = video.current;
    if (!node) return;
    if (active) {
      node.currentTime = 0;
      void node.play().catch(() => {});
    } else {
      node.pause();
    }
  }, [active]);

  useEffect(() => {
    if (video.current) video.current.muted = muted;
  }, [muted]);

  // one dwell event per visit: when this slide becomes the active one, time it;
  // when it stops being active, report how long it was looked at
  useEffect(() => {
    if (active) {
      seenAt.current = Date.now();
      return;
    }
    const start = seenAt.current;
    seenAt.current = null;
    if (start === null) return;
    const ms = Date.now() - start;
    sendSignal(item.id, classifyDwell(ms), ms / 1000);
  }, [active, item.id]);

  async function toggleSave() {
    const next = !saved;
    setSaved(next);
    try {
      await fetch(`/api/media/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isFavorite: next }),
      });
    } catch {
      setSaved(!next);
    }
  }

  const isCapture = item.tags.includes("web-capture") || item.tags.includes("pixiv-post");
  const captureTags = displayTags(item.tags, 4);
  const named = item.title.trim();
  const isCode = /^\d+$/.test(named) || named.length <= 3;
  const headline = isCode ? (item.album ?? named) : (named || item.album || "untitled");
  const subline = isCode && item.album ? `page ${named}` : item.album;

  return (
    <section
      className="relative h-[100dvh] w-full snap-start overflow-hidden bg-black"
      data-index={index}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button, a, input, video, [data-no-advance]")) return;
        onAdvancePage();
      }}

      onPointerDown={(event) => {
        if (pageCount < 2) return;
        swiped.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = swiped.current;
        swiped.current = null;
        if (!start || pageCount < 2) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) onPage(dx < 0 ? 1 : -1);
      }}
    >
      {item.posterUrl && (
        <div
          aria-hidden
          className="absolute inset-0 scale-125 bg-cover bg-center opacity-30 blur-3xl"
          style={{ backgroundImage: `url(${item.posterUrl})` }}
        />
      )}

      {item.mediaType === "video" && item.streamUrl ? (
        <video
          ref={video}
          src={item.streamUrl}
          poster={item.posterUrl ?? undefined}
          className="absolute inset-0 h-full w-full object-contain"
          playsInline
          controls
          muted={muted}
          preload={active || nearby ? "auto" : "none"}
          onError={() => setFailed(true)}
          onPause={(event) => {
            const node = event.currentTarget;
            if (node.currentTime > 0.5) sendSignal(item.id, "progress", node.currentTime);
          }}
          onPlay={() => {
            if (endedOnce.current) { endedOnce.current = false; sendSignal(item.id, "replay", 0); }
          }}
          onEnded={(event) => {
            endedOnce.current = true;
            sendSignal(item.id, "complete", event.currentTarget.duration || 0);
          }}
          onTimeUpdate={(event) => {
            const node = event.currentTarget;
            if (node.duration) setProgress(node.currentTime / node.duration);
          }}
        />
      ) : current ? (
        <img
          src={current}
          alt={item.title}
          className={`absolute inset-0 h-full w-full object-contain ${active ? "kenburns" : "scale-100"}`}
          onError={() => setFailed(true)}
        />
      ) : null}

      {failed && (
        <div className="absolute inset-0 grid place-items-center">
          <p className="font-mono text-xs uppercase tracking-widest text-white/50">cannot decode this one</p>
        </div>
      )}

      {!play && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/80 to-transparent" />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black via-black/70 to-transparent" />
        </>
      )}

      {!play && pageCount > 1 && (
        <>
          <div className="pointer-events-none absolute right-5 top-16 rounded-full border border-white/15 bg-black/55 px-3 py-1 font-mono text-[10px] tracking-widest text-white/70 backdrop-blur">
            {page + 1} / {pageCount} <span className="ml-1 text-white/35">swipe</span>
          </div>
        </>
      )}

      {!play && item.mediaType === "video" && (
        <div className="absolute inset-x-0 top-0 h-[3px] bg-white/10">
          <div className="h-full bg-[var(--red)] transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      <div className={`absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 pb-10 sm:p-8 ${play ? "hidden" : ""}`}>
        <div className="min-w-0 max-w-[68ch]">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.25em] text-white/50">
            {[item.kind, item.mediaType === "video" ? clock(item.durationSeconds) : "still", "nsfw"].filter(Boolean).join("  ·  ")}
          </p>
          <h2 className="truncate text-lg font-semibold leading-tight text-white sm:text-2xl">{headline}</h2>
          {subline && <p className="mt-0.5 truncate text-xs text-white/60">{subline}</p>}
          {isCapture && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em]">
              <span className="text-white/30">{item.kind === "pixiv" || item.tags.includes("pixiv-post") ? "pixiv" : "web"}</span>
              {item.artist && (
                <button
                  type="button"
                  onClick={() => onCreator(item.artist!)}
                  title={`more from ${item.artist}`}
                  className="max-w-[22ch] truncate text-[var(--rei)]/80 transition hover:text-white"
                >
                  {item.artist}
                </button>
              )}
              {captureTags.shown.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onTag(tag)}
                  title={`only posts tagged #${tag}`}
                  className="text-white/45 transition hover:text-white"
                >
                  #{tag}
                </button>
              ))}
              {captureTags.rest.length > 0 && (
                <span className="text-white/25" title={captureTags.rest.map((tag) => `#${tag}`).join("  ")}>
                  +{captureTags.rest.length}
                </span>
              )}
              {item.pageUrl && (
                <a
                  href={item.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={item.description ?? item.pageUrl}
                  className="text-white/40 underline decoration-white/20 transition hover:text-white"
                >
                  open ↗
                </a>
              )}
            </div>
          )}
          {!isCapture && (
            <p className="mt-1 truncate font-mono text-[11px] text-white/40">
              {item.tags.filter((t) => t !== "nsfw" && t !== "local-import").slice(0, 6).map((t) => `#${t}`).join("  ")}
            </p>
          )}
          <div className="relative mt-3">
            <button
              type="button"
              onClick={() => { setPanel((v) => !v); setAnalysis(null); }}
              title="Label this (x dismisses)"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-black/40 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-white/45 backdrop-blur transition hover:border-[var(--rei)]/70 hover:text-white"
            >
              <Flag size={10} /> label
            </button>
            {note && <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ok)]">{note}</span>}

            {panel && (
              <div className="absolute bottom-full left-0 mb-2 w-[270px] overflow-hidden rounded-lg border border-white/12 bg-black/85 backdrop-blur">
                {analysis ? (
                  <div className="p-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">manga set found</p>
                    <p className="mt-1 font-mono text-xs text-white">{analysis.pages} pages · {analysis.first} → {analysis.last}</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => void label("manga-confirm")}
                        className="rounded border border-[var(--rei)]/60 bg-[var(--rei)]/15 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white">
                        catalog as manga
                      </button>
                      <button type="button" onClick={() => setAnalysis(null)}
                        className="rounded border border-white/15 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white/50">
                        back
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {[
                      ["broken", "broken file"],
                      ["game-artifact", "video game artifact"],
                      ["manga", "manga page — find the set"],
                      ["dismiss", "not for me"],
                    ].map(([kind, text]) => (
                      <button key={kind} type="button" onClick={() => void label(kind)}
                        className="border-b border-white/8 px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-white/60 transition last:border-0 hover:bg-white/10 hover:text-white">
                        {text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-3 pb-1">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? "Unmute" : "Mute"}
            className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button
            type="button"
            onClick={() => { void toggleSave(); }}
            aria-label={saved ? "Remove from saved" : "Save"}
            className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
          >
            <Heart size={18} fill={saved ? "currentColor" : "none"} className={saved ? "text-[var(--red)]" : ""} />
          </button>
          <Link
            href={`/library?focus=${item.id}`}
            aria-label="Open in library"
            className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
          >
            <Maximize2 size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Paste a link, watch it land. Same intake panel as everything else. */
function CollectBar() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function collect() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setNote("reading the link…");
    try {
      // The agent is a signed-in browser; it can see what the box cannot.
      const agent = await fetch("http://127.0.0.1:8099/grab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
        signal: AbortSignal.timeout(180_000),
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (agent?.imported) {
        setNote(`collected ${agent.imported} of ${agent.pages} pages`);
        setUrl("");
        return;
      }
      if (agent?.error) { setNote(agent.error); return; }

      const resolved = await fetch("/api/capture/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const link = await resolved.json() as { error?: string; mode?: string; url?: string; title?: string; artist?: string; tags?: string[]; images?: { url: string }[] };
      if (!resolved.ok) { setNote(link.error ?? "could not read that link"); return; }
      const payload = link.mode === "image"
        ? { pageUrl: url.trim(), title: "saved image", images: [{ url: link.url }] }
        : link;
      const saved = await fetch("/api/capture/from-json", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await saved.json() as { imported?: number; error?: string };
      setNote(saved.ok ? `collected ${out.imported ?? 0} pages` : (out.error ?? "failed"));
      if (saved.ok) setUrl("");
    } catch {
      setNote("the box did not answer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setNote(""); }}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rei)]/40 bg-[var(--rei)]/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[#E6ECFF] backdrop-blur transition hover:bg-[var(--rei)]/20"
      >
        ＋ collect
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-[360px] rounded-xl border border-[var(--line)] bg-black/90 p-3 backdrop-blur">
          <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">paste a pixiv artwork link</p>
          <div className="flex gap-2">
            <input
              autoFocus
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void collect(); }}
              placeholder="https://www.pixiv.net/artworks/…"
              className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 font-mono text-[11px] text-white outline-none focus:border-[var(--rei)]"
            />
            <button
              type="button"
              onClick={() => void collect()}
              disabled={busy}
              className="rounded-md bg-[var(--rei)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[#0b0d14] disabled:opacity-50"
            >
              {busy ? "…" : "grab"}
            </button>
          </div>
          {note && <p className="mt-2 font-mono text-[10px] text-white/50">{note}</p>}
        </div>
      )}
    </div>
  );
}

export function WatchScrollPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTED_KEY) !== "false");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState(true);
  const [page, setPage] = useState(0);
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [chrome, setChrome] = useState(() => localStorage.getItem(CHROME_KEY) !== "hidden");
  // consumption: the media and nothing else. Entered by URL, left by Escape or c.
  const [play, setPlay] = useState(() => (typeof window === "undefined" ? false : isConsumeView(window.location.search)));

  const scroller = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const pending = useRef<{ fresh?: boolean; pin?: Item | null } | null>(null);
  const deck = useRef({ seed: Math.random().toString(36).slice(2, 10), offset: 0 });
  const lensRef = useRef<Lens[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const activeRef = useRef(0);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => { document.title = "Watch · yoru"; }, []);
  useEffect(() => { localStorage.setItem(MUTED_KEY, String(muted)); }, [muted]);
  useEffect(() => { localStorage.setItem(CHROME_KEY, chrome ? "shown" : "hidden"); }, [chrome]);

  // the URL is the record of the mode: entering and leaving is visible, and a
  // refresh lands where you left off
  useEffect(() => {
    const url = new URL(window.location.href);
    if (play) url.searchParams.set("play", "1");
    else url.searchParams.delete("play");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [play]);

  const load = useCallback(async (options: { fresh?: boolean; pin?: Item | null } = {}) => {
    if (busy.current) { pending.current = options; return; }
    busy.current = true;
    setLoading(true);
    const { fresh = false, pin = null } = options;
    try {
      if (fresh) deck.current = { seed: Math.random().toString(36).slice(2, 10), offset: 0 };
      const { seed, offset } = deck.current;
      const lens = lensRef.current[lensRef.current.length - 1];
      const query = new URLSearchParams({ seed, offset: String(offset), limit: String(PAGE) });
      if (lens) { query.set("level", lens.level); query.set("value", lens.value); }
      const res = await fetch(`/api/watch/scroll?${query.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { items: Item[]; total: number };
      deck.current.offset += data.items.length;
      setTotal(data.total);
      setItems((current) => {
        const base = fresh ? (pin ? [pin] : []) : current;
        const seen = new Set(base.map((i) => i.id));
        return [...base, ...data.items.filter((i) => !seen.has(i.id))];
      });
      if (fresh) { setActive(0); scroller.current?.scrollTo({ top: 0 }); }
      setError("");
    } catch {
      setError("the loop stalled — scroll to retry");
    } finally {
      busy.current = false;
      setLoading(false);
      const queued = pending.current;
      pending.current = null;
      if (queued) void load(queued);
    }
  }, []);

  useEffect(() => { void load({ fresh: true }); }, [load]);

  // Keep three screens of runway; draw a new deck when this one is spent.
  useEffect(() => {
    if (!items.length) return;
    if (active < items.length - 3) return;
    if (deck.current.offset < total) void load();
    else void load({ fresh: true });
  }, [active, items.length, total, load]);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio > 0.55) {
          setActive(Number((entry.target as HTMLElement).dataset.index ?? 0));
          setHint(false);
        }
      }
    }, { root, threshold: [0.56] });
    root.querySelectorAll("section[data-index]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [items.length]);

  /** A tag replaces the stack: the breadcrumb then reads all › #tag. */
  const goTag = useCallback((tag: string) => {
    const lens = tagLens(tag);
    if (!lens) return;
    lensRef.current = [lens];
    setLenses([lens]);
    void load({ fresh: true });
  }, [load]);

  /** The artist is a creator lens — now possible for captures too. */
  const goCreator = useCallback((name: string) => {
    const lens = creatorLens(name);
    if (!lens) return;
    lensRef.current = [lens];
    setLenses([lens]);
    void load({ fresh: true });
  }, [load]);

  const goDeeper = useCallback(() => {
    const item = itemsRef.current[activeRef.current];
    if (!item) return;
    const lens = deeper(item, lensRef.current.length);
    if (!lens) return;
    const next = [...lensRef.current, lens];
    lensRef.current = next;
    setLenses(next);
    void load({ fresh: true, pin: item });
  }, [load]);

  const goWider = useCallback((to = lensRef.current.length - 1) => {
    if (to < 0) return;
    const next = lensRef.current.slice(0, to);
    lensRef.current = next;
    setLenses(next);
    void load({ fresh: true, pin: itemsRef.current[activeRef.current] ?? null });
  }, [load]);

  const step = useCallback((delta: number) => {
    const root = scroller.current;
    if (!root) return;
    const next = Math.max(0, Math.min(itemsRef.current.length - 1, activeRef.current + delta));
    root.querySelector<HTMLElement>(`section[data-index="${next}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const pageRef = useRef(0);
  useEffect(() => { pageRef.current = page; }, [page]);
  const turnPage = useCallback((delta: number) => {
    setPage((p) => Math.max(0, Math.min((itemsRef.current[activeRef.current]?.pages?.length ?? 1) - 1, p + delta)));
  }, []);
  useEffect(() => { setPage(0); }, [items[active]?.id]);

  /** A click walks the collection, then the feed. */
  const advancePage = useCallback(() => {
    const item = itemsRef.current[activeRef.current];
    const count = item?.pages?.length ?? 1;
    const next = nextPage(pageRef.current, count);
    if (next === null) step(1);
    else turnPage(1);
  }, [step, turnPage]);

  const advance = useCallback((item: Item) => {
    setItems((current) => current.filter((i) => i.id !== item.id));
    step(1);
  }, [step]);

  const dismiss = useCallback((item: Item) => {
    setItems((current) => current.filter((i) => i.id !== item.id));
    void fetch("/api/watch/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id }),
    }).catch(() => {});
    step(1);
  }, [step]);


  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "j" || event.key === " ") { event.preventDefault(); step(1); }
      else if (event.key === "ArrowUp" || event.key === "k") { event.preventDefault(); step(-1); }
      else if (event.key === "ArrowRight" || event.key === "l") {
        event.preventDefault();
        const count = itemsRef.current[activeRef.current]?.pages?.length ?? 1;
        if (pageRef.current < count - 1) turnPage(1); else goDeeper();
      }
      else if (event.key === "ArrowLeft" || event.key === "h") {
        event.preventDefault();
        if (pageRef.current > 0) turnPage(-1); else goWider();
      }
      else if (event.key === "m") setMuted((m) => !m);
      else if (event.key === "c") { if (play) { setPlay(false); setChrome(true); } else setChrome((value) => !value); }
      else if (event.key === "Escape") { event.preventDefault(); setPlay(false); setChrome(true); }
      else if (event.key === "x") {
        const item = itemsRef.current[activeRef.current];
        if (item) dismiss(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, goDeeper, goWider, dismiss, turnPage, play]);

  const current = items[active];
  const canDeeper = current ? deeper(current, ladderDepth(lenses)) !== null : false;
  const canWider = lenses.length > 0;

  return (
    <div className="relative bg-black text-white">
      <style>{`
        @keyframes kenburns { from { transform: scale(1.02); } to { transform: scale(1.12); } }
        .kenburns { animation: kenburns 14s ease-in-out infinite alternate; }
        @keyframes burst { 0% { opacity: 0; transform: translate(-50%,-50%) scale(.4); } 25% { opacity: 1; transform: translate(-50%,-50%) scale(1.05); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1.35); } }
        .heart-burst { animation: burst .9s ease-out forwards; }
        .loop-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .loop-scroll::-webkit-scrollbar { display: none; }
      `}</style>

      {!play && !chrome && (
        <button
          type="button"
          onClick={() => setChrome(true)}
          title="show the menu (c)"
          aria-label="show the menu"
          className="absolute right-3 top-3 z-40 grid h-8 w-8 place-items-center rounded-full border border-white/12 bg-black/45 text-white/55 backdrop-blur transition hover:text-white"
        >
          <Eye size={14} />
        </button>
      )}

      <header className={`absolute inset-x-0 top-0 z-30 flex-col gap-2 p-5 ${!play && chrome ? "flex" : "hidden"}`}>
        <div className="flex items-center justify-between">
          <Link href="/library" className="font-mono text-[11px] uppercase tracking-[0.4em] text-white/70 transition hover:text-white">
            ayamai
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setChrome(false)}
              title="hide the menu (c)"
              aria-label="hide the menu"
              className="grid h-7 w-7 place-items-center rounded-full text-white/40 transition hover:text-white"
            >
              <EyeOff size={13} />
            </button>
            <span className="font-mono text-[10px] tabular-nums text-white/40">
              {total ? `${Math.min(active + 1, total).toLocaleString()} / ${total.toLocaleString()}` : ""}
            </span>
            <CollectBar />
            <button
              type="button"
              onClick={() => { lensRef.current = []; setLenses([]); void load({ fresh: true }); }}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-white/70 backdrop-blur transition hover:bg-white/15 hover:text-white"
            >
              <Shuffle size={12} /> shuffle
            </button>
          </div>
        </div>

        {/* Depth: every crumb is a jump back out, the last one is where you are. */}
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em]">
          <button
            type="button"
            onClick={() => goWider(0)}
            className={`rounded px-1.5 py-0.5 transition ${lenses.length === 0 ? "text-white" : "text-white/45 hover:text-white"}`}
          >
            all
          </button>
          {lenses.map((lens, index) => (
            <span key={`${lens.level}-${lens.value}`} className="flex min-w-0 items-center gap-1.5">
              <span className="text-white/25">›</span>
              <button
                type="button"
                onClick={() => goWider(index)}
                title={lens.value}
                className={`max-w-[26ch] truncate rounded px-1.5 py-0.5 transition ${
                  index === lenses.length - 1 ? "bg-white/10 text-white" : "text-white/45 hover:text-white"
                }`}
              >
                {lens.label}
              </button>
            </span>
          ))}
        </div>
      </header>

      <div ref={scroller} className="loop-scroll h-[100dvh] snap-y snap-mandatory overflow-y-scroll overscroll-none">
        {items.map((item, index) => (
          <Slide
            key={`${item.id}-${index}`}
            item={item}
            index={index}
            active={index === active}
            nearby={index === active + 1}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            onAdvance={() => advance(item)}
            onAdvancePage={advancePage}
            play={play}
            onTag={goTag}
            onCreator={goCreator}
            page={page}
            onPage={turnPage}
          />
        ))}
      </div>

      {/* The second axis gets real controls: this is a keyboard-first surface. */}
      {!play && <div className="absolute bottom-8 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/12 bg-black/55 p-1 backdrop-blur">
        <button
          type="button"
          onClick={() => goWider()}
          disabled={!canWider}
          aria-label="Widen — less like this"
          title="Out — less like this (←)"
          className="grid h-9 w-11 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
        >
          <ChevronsLeft size={18} />
        </button>
        <span className="px-1 font-mono text-[9px] uppercase tracking-[0.22em] text-white/30">depth</span>
        <button
          type="button"
          onClick={goDeeper}
          disabled={!canDeeper}
          aria-label="Narrow — more like this"
          title="In — more like this (→)"
          className="grid h-9 w-11 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-25"
        >
          <ChevronsRight size={18} />
        </button>
      </div>}

      {!play && hint && !items.length && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-white/40">drawing a deck</p>
        </div>
      )}

      {!play && hint && items.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 flex flex-col items-center gap-2 text-white/50">
          <ArrowUp size={16} className="animate-bounce" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em]">scroll</span>
        </div>
      )}

      {error && (
        <div className="absolute inset-x-0 bottom-4 text-center font-mono text-[11px] text-[var(--red)]">{error}</div>
      )}
    </div>
  );
}
