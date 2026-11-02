import { useEffect, useRef, useState } from "react";
import { ArrowLeft, X, ChevronLeft, ChevronRight } from "lucide-react";
import { QueuedImage } from "@/components/queued-image";
import { AppNav } from "@/social/app-nav";

type Album = { dir: string; name: string; items: number; coverUrl: string | null };
type Item = { id: string; name: string; url: string | null };

const PAGE = 120;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

export function AlbumsPage() {
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [openDir, setOpenDir] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [viewing, setViewing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<Album[]>([]);
  const [showAssets, setShowAssets] = useState(false);
  const viewer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getJson<{ albums: Album[] }>("/api/albums")
      .then((d) => setAlbums(d.albums))
      .catch(() => setError("The album shelf didn't load."));
  }, []);

  useEffect(() => {
    // Game asset dumps live behind their own door, not on the same shelf.
    getJson<{ albums: Album[] }>("/api/albums/assets")
      .then((d) => setAssets(d.albums))
      .catch(() => setAssets([]));
  }, []);

  useEffect(() => {
    if (!openDir) { setItems(null); return; }
    setItems(null); setShown(PAGE);
    getJson<{ items: Item[] }>(`/api/albums/items?dir=${encodeURIComponent(openDir)}`)
      .then((d) => setItems(d.items))
      .catch(() => setError("That album didn't load."));
  }, [openDir]);

  useEffect(() => {
    if (viewing === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewing(null);
      if (event.key === "ArrowRight") setViewing((i) => (i === null ? i : Math.min((items?.length ?? 1) - 1, i + 1)));
      if (event.key === "ArrowLeft") setViewing((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, items]);

  const current = viewing !== null ? items?.[viewing] : null;
  const openAlbum = albums?.find((a) => a.dir === openDir);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AppNav />
      <main className="mx-auto max-w-[1800px] px-3 pb-16 pt-[76px] sm:px-4 md:px-6 md:pt-20">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">
              {openDir ? `${items?.length ?? 0} images` : "Image sets"}
            </p>
            <h1 className="mt-1 max-w-[70ch] truncate text-2xl font-semibold tracking-tight md:text-3xl">
              {openDir ? openAlbum?.name ?? "Album" : "Albums"}
            </h1>
            {openDir && <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{openDir}</p>}
          </div>
          {openDir && (
            <button type="button" onClick={() => { setOpenDir(null); setViewing(null); }}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft size={14} /> Albums
            </button>
          )}
        </div>

        {error && <p className="mt-6 text-sm text-destructive">{error}</p>}

        {!openDir && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {(albums ?? []).map((a) => (
              <button key={a.dir} type="button" onClick={() => setOpenDir(a.dir)} className="group text-left" data-testid={`album-${a.name}`}>
                <QueuedImage src={a.coverUrl} className="aspect-square rounded-md border border-border transition-transform duration-500 group-hover:scale-[1.02]" />
                <p className="mt-2 truncate text-xs font-medium">{a.name}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{a.items} images</p>
              </button>
            ))}
          </div>
        )}

        {!openDir && assets.length > 0 && (
          <section className="mt-10">
            <button
              type="button"
              onClick={() => setShowAssets((v) => !v)}
              className="flex w-full items-baseline justify-between gap-3 border-t border-border pt-5 text-left"
            >
              <span>
                <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Game assets</span>
                <span className="ml-3 text-xs text-muted-foreground">
                  {assets.reduce((n, a) => n + a.items, 0).toLocaleString()} files from game folders — not image sets
                </span>
              </span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {showAssets ? "hide" : `show ${assets.length}`}
              </span>
            </button>
            {showAssets && (
              <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
                {assets.map((a) => (
                  <button key={a.dir} type="button" onClick={() => setOpenDir(a.dir)} className="group text-left opacity-80 hover:opacity-100">
                    <QueuedImage src={a.coverUrl} className="aspect-square rounded-md border border-border" />
                    <p className="mt-2 truncate text-[11px] text-muted-foreground" title={a.dir}>{a.name}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{a.items} files</p>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {openDir && items && (
          <>
            <div className="mt-6 grid grid-cols-3 gap-1.5 sm:grid-cols-5 md:grid-cols-7 xl:grid-cols-9">
              {items.slice(0, shown).map((item, index) => (
                <button key={item.id} type="button" onClick={() => setViewing(index)} className="group" aria-label={item.name}>
                  <QueuedImage src={item.url} className="aspect-square rounded-sm" fit="cover" />
                </button>
              ))}
            </div>
            {items.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)}
                className="mt-6 w-full rounded-md border border-border py-2.5 text-xs text-muted-foreground hover:text-foreground">
                show more — {items.length - shown} remaining
              </button>
            )}
          </>
        )}
      </main>

      {current && (
        <div ref={viewer} className="fixed inset-0 z-50 flex flex-col bg-background/98">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-3 md:px-5">
            <p className="truncate font-mono text-[11px] text-muted-foreground">{current.name}</p>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] text-muted-foreground">{(viewing ?? 0) + 1} / {items?.length ?? 0}</span>
              <button type="button" onClick={() => setViewing(null)} aria-label="Close" className="rounded-md p-1.5 hover:bg-secondary"><X size={16} /></button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
            <button type="button" onClick={() => setViewing((i) => (i === null ? i : Math.max(0, i - 1)))}
              className="absolute left-2 z-10 rounded-full bg-background/70 p-2 text-muted-foreground hover:text-foreground" aria-label="Previous">
              <ChevronLeft size={22} />
            </button>
            <img src={current.url ?? undefined} alt={current.name} className="max-h-full max-w-full object-contain" />
            <button type="button" onClick={() => setViewing((i) => (i === null ? i : Math.min((items?.length ?? 1) - 1, i + 1)))}
              className="absolute right-2 z-10 rounded-full bg-background/70 p-2 text-muted-foreground hover:text-foreground" aria-label="Next">
              <ChevronRight size={22} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
