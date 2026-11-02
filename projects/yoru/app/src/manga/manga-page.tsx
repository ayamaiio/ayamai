import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, X } from "lucide-react";
import { QueuedImage } from "@/components/queued-image";
import { AppNav } from "@/social/app-nav";

type Series = { series: string; pages: number; chapters: number; coverUrl: string | null };
type Chapter = { chapter: string; pages: number; first: string };
type Page = { id: string; name: string; url: string | null };
type Position = { series: string; chapter: string; page: number; at: string };

const LAST_KEY = "manga:last";
const chapterKey = (series: string, chapter: string) => `manga:chapter:${series}\u0000${chapter}`;
const enc = (s: string) => encodeURIComponent(s);

function readPosition(): Position | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null") as Position | null;
    if (!raw?.series || !raw.chapter) return null;
    return raw;
  } catch { return null; }
}

function readChapterPage(series: string, chapter: string): number {
  const raw = Number(localStorage.getItem(chapterKey(series, chapter)));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as T;
}

export function MangaPage() {
  const [series, setSeries] = useState<Series[] | null>(null);
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<Position | null>(() => readPosition());
  const [currentPage, setCurrentPage] = useState(0);

  const pane = useRef<HTMLDivElement>(null);
  const pageNodes = useRef<(HTMLDivElement | null)[]>([]);
  const restoredFor = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantedSeries = params.get("series");
    const wantedChapter = params.get("chapter");
    if (wantedSeries) setOpenSeries(wantedSeries);
    if (wantedSeries && wantedChapter) setOpenChapter(wantedChapter);
  }, []);

  useEffect(() => {
    getJson<{ series: Series[] }>("/api/manga/series")
      .then((d) => setSeries(d.series))
      .catch(() => setError("The manga shelf didn't load."));
  }, []);

  useEffect(() => {
    if (!openSeries) { setChapters(null); return; }
    setChapters(null);
    getJson<{ chapters: Chapter[] }>(`/api/manga/series/${enc(openSeries)}`)
      .then((d) => setChapters(d.chapters))
      .catch(() => setError("That series didn't load."));
  }, [openSeries]);

  useEffect(() => {
    if (!openSeries || !openChapter) { setPages(null); return; }
    setPages(null);
    restoredFor.current = null;
    getJson<{ pages: Page[] }>(`/api/manga/series/${enc(openSeries)}/${enc(openChapter)}`)
      .then((d) => setPages(d.pages))
      .catch(() => setError("That chapter didn't load."));
  }, [openSeries, openChapter]);

  // Remember where the reader is: per chapter, and globally for "continue".
  const remember = useCallback((index: number) => {
    if (!openSeries || !openChapter) return;
    localStorage.setItem(chapterKey(openSeries, openChapter), String(index));
    const next: Position = { series: openSeries, chapter: openChapter, page: index, at: new Date().toISOString() };
    localStorage.setItem(LAST_KEY, JSON.stringify(next));
    setResume(next);
  }, [openSeries, openChapter]);

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => remember(currentPage), 400);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [currentPage, remember]);

  // Scrollspy: whichever page is crossing the reading band is the position.
  useEffect(() => {
    if (!pages || !pane.current) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .map((e) => Number((e.target as HTMLElement).dataset.page))
        .filter((n) => Number.isFinite(n));
      if (visible.length) setCurrentPage(Math.min(...visible));
    }, { root: pane.current, rootMargin: "-40% 0px -55% 0px", threshold: 0 });

    for (const node of pageNodes.current) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [pages]);

  // Restore the saved page once per opened chapter.
  useEffect(() => {
    if (!pages || !openSeries || !openChapter) return;
    const key = `${openSeries}\u0000${openChapter}`;
    if (restoredFor.current === key) return;
    const target = readChapterPage(openSeries, openChapter);
    const jump = () => {
      const node = pageNodes.current[target];
      if (node) node.scrollIntoView({ block: "start" });
      setCurrentPage(target);
    };
    requestAnimationFrame(jump);
    const settle = window.setTimeout(jump, 700);
    restoredFor.current = key;
    return () => window.clearTimeout(settle);
  }, [pages, openSeries, openChapter]);

  const step = useCallback((delta: number) => {
    if (!chapters || !openChapter) return;
    const index = chapters.findIndex((c) => c.chapter === openChapter);
    const next = chapters[index + delta];
    if (next) setOpenChapter(next.chapter);
  }, [chapters, openChapter]);

  useEffect(() => {
    if (!openChapter) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenChapter(null);
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "j") pane.current?.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" });
      if (event.key === "k") pane.current?.scrollBy({ top: -window.innerHeight * 0.9, behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openChapter, step]);

  const openAt = (position: Position) => {
    setOpenSeries(position.series);
    setOpenChapter(position.chapter);
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AppNav />
      <main className="mx-auto max-w-[1800px] px-3 pb-16 pt-[76px] sm:px-4 md:px-6 md:pt-20">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">
              {openSeries ? "Chapters" : "Reading shelf"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">{openSeries ?? "Manga"}</h1>
          </div>
          {openSeries && (
            <button
              type="button"
              onClick={() => { setOpenSeries(null); setOpenChapter(null); }}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft size={14} /> Shelf
            </button>
          )}
        </div>

        {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

        {!openSeries && resume && (
          <button
            type="button"
            onClick={() => openAt(resume)}
            className="mt-6 flex w-full items-center gap-4 rounded-md border border-primary/30 bg-accent px-4 py-3 text-left transition-colors hover:border-primary/60"
            data-testid="continue-reading"
          >
            <BookOpen size={18} className="shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">Continue reading</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                {resume.series} · {resume.chapter} · page {resume.page + 1}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              resume
            </span>
          </button>
        )}

        {!openSeries && (
          <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
            {(series ?? []).map((s) => (
              <button key={s.series} type="button" onClick={() => setOpenSeries(s.series)} className="group text-left" data-testid={`series-${s.series}`}>
                <div className={`relative aspect-[2/3] overflow-hidden rounded-md border transition-colors ${resume?.series === s.series ? "border-primary/70" : "border-border group-hover:border-primary/40"}`}>
                  {s.coverUrl
                    ? <QueuedImage src={s.coverUrl} label="cover" className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]" />
                    : <div className="grid h-full place-items-center text-xs text-muted-foreground">no cover</div>}
                </div>
                {resume?.series === s.series && (
                  <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-primary-foreground">
                    reading
                  </span>
                )}
                <p className="mt-2 line-clamp-2 text-xs font-medium leading-snug">{s.series}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{s.chapters} ch · {s.pages.toLocaleString()} p</p>
              </button>
            ))}
          </div>
        )}

        {openSeries && (
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {(chapters ?? []).map((c) => {
              const savedPage = openSeries ? readChapterPage(openSeries, c.chapter) : 0;
              const here = resume?.series === openSeries && resume.chapter === c.chapter;
              return (
                <button
                  key={c.chapter}
                  type="button"
                  onClick={() => setOpenChapter(c.chapter)}
                  className={`flex items-center justify-between rounded-md border px-3 py-2.5 text-left transition-colors ${here ? "border-primary/60 bg-accent" : "border-border hover:border-primary/40 hover:bg-accent"}`}
                  data-testid={`chapter-${c.chapter}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{c.chapter}</span>
                    {savedPage > 0 && (
                      <span className="mt-1 block h-[2px] w-16 overflow-hidden rounded bg-border">
                        <span className="block h-full bg-primary" style={{ width: `${Math.min(100, ((savedPage + 1) / c.pages) * 100)}%` }} />
                      </span>
                    )}
                  </span>
                  <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground">{c.pages} p</span>
                </button>
              );
            })}
          </div>
        )}
      </main>

      {openChapter && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3 md:px-5">
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground">{openSeries}</p>
              <p className="truncate text-sm font-medium">{openChapter}</p>
            </div>
            <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
              <span className="hidden sm:inline">{pages ? `${currentPage + 1} / ${pages.length}` : "…"}</span>
              <span className="hidden md:inline">← → chapters · j k scroll · esc close</span>
              <button type="button" onClick={() => setOpenChapter(null)} aria-label="Close reader" className="rounded-md p-1.5 hover:bg-secondary">
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="h-[2px] w-full shrink-0 bg-border">
            <div className="h-full bg-primary transition-[width] duration-150" style={{ width: pages?.length ? `${((currentPage + 1) / pages.length) * 100}%` : "0%" }} />
          </div>
          <div ref={pane} className="min-h-0 flex-1 overflow-y-auto" data-testid="manga-reader">
            <div className="mx-auto flex max-w-3xl flex-col gap-1 px-0 sm:px-4">
              {(pages ?? []).map((p, i) => (
                <div key={p.id} ref={(node) => { pageNodes.current[i] = node; }} data-page={i}>
                  {p.url
                    ? <QueuedImage src={p.url} alt={`page ${i + 1}`} eager={i < 2} fit="natural" className="w-full" label={`page ${i + 1} unavailable`} />
                    : null}
                </div>
              ))}
              {!pages && <p className="py-16 text-center text-sm text-muted-foreground">loading…</p>}
              {pages && (() => {
                const index = (chapters ?? []).findIndex((c) => c.chapter === openChapter);
                const next = index >= 0 ? (chapters ?? [])[index + 1] : undefined;
                if (!next) return null;
                return (
                  <button
                    type="button"
                    onClick={() => setOpenChapter(next.chapter)}
                    className="mx-3 my-8 flex items-center justify-between rounded-lg border border-primary/40 bg-accent px-5 py-4 text-left transition-colors hover:border-primary/70"
                  >
                    <span>
                      <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">next chapter</span>
                      <span className="mt-1 block text-base font-medium">{next.chapter}</span>
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">{next.pages} p →</span>
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
