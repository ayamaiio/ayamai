import { useCallback, useEffect, useState } from "react";
import { Search, X, Check, Film } from "lucide-react";
import { QueuedImage } from "@/components/queued-image";
import { AppNav } from "@/social/app-nav";

type Item = { id: string; title: string; collection: string | null; mediaType: string; url: string | null };
type SearchHit = { id: string; title: string; collection: string | null; mediaType: string };

const PAGE = 60;

export function AfterHoursPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAssets, setShowAssets] = useState(false);

  const load = useCallback(async (next: number, append: boolean) => {
    const res = await fetch(`/api/after-hours?offset=${next}&limit=${PAGE}${showAssets ? "&assets=show" : ""}`, { headers: { Accept: "application/json" } });
    if (!res.ok) { setError("After Hours didn't load."); return; }
    const data = await res.json() as { total: number; items: Item[] };
    setTotal(data.total);
    setOffset(next + data.items.length);
    setItems((prev) => (append ? [...prev, ...data.items] : data.items));
  }, [showAssets]);

  useEffect(() => { void load(0, false).catch(() => setError("After Hours didn't load.")); }, [load]);

  useEffect(() => {
    if (!query.trim()) { setHits(null); return; }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/media?q=${encodeURIComponent(query.trim())}&limit=24`, { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const data = await res.json() as { items: SearchHit[] };
      setHits(data.items);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function mark(id: string, marked: boolean) {
    const res = await fetch("/api/after-hours/mark", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, marked }),
    });
    if (!res.ok) { setError("That change didn't save."); return; }
    if (marked) {
      setHits((prev) => prev?.filter((h) => h.id !== id) ?? null);
      setTotal((n) => n + 1);
    } else {
      setItems((prev) => prev.filter((i) => i.id !== id));
      setTotal((n) => Math.max(0, n - 1));
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AppNav />
      <main className="mx-auto max-w-[1800px] px-3 pb-16 pt-[76px] sm:px-4 md:px-6 md:pt-20">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-primary">Marked explicit</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">After Hours</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowAssets((v) => !v)}
              className="rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              {showAssets ? "hide game assets" : "show game assets"}
            </button>
            <p className="font-mono text-[11px] text-muted-foreground">{total.toLocaleString()} items</p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-md border border-input px-3.5">
          <Search size={16} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find something to mark"
            className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            data-testid="input-after-hours-search"
          />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear"><X size={15} className="text-muted-foreground" /></button>}
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        {hits && (
          <ul className="mt-4 divide-y divide-border rounded-md border border-border">
            {hits.length === 0 && <li className="px-4 py-3 text-xs text-muted-foreground">No matches.</li>}
            {hits.map((hit) => (
              <li key={hit.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">{hit.title}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{hit.collection ?? "uncategorized"}</span>
                <button
                  type="button"
                  onClick={() => void mark(hit.id, true)}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] hover:border-primary/50"
                >
                  <Check size={12} /> mark
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 grid grid-cols-3 gap-1.5 sm:grid-cols-5 md:grid-cols-7 xl:grid-cols-9">
          {items.map((item) => (
            <div key={item.id} className="group relative">
              {item.mediaType === "video"
                // An mp4 cannot decode in an <img>; give video its own tile
                // instead of retrying an impossible load.
                ? <div className="grid aspect-square place-items-center rounded-sm border border-border bg-secondary">
                    <Film size={20} className="text-muted-foreground" aria-hidden="true" />
                  </div>
                : <QueuedImage src={item.url} className="aspect-square rounded-sm" />}
              <button
                type="button"
                onClick={() => void mark(item.id, false)}
                aria-label={`Unmark ${item.title}`}
                className="absolute right-1 top-1 rounded bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>

        {items.length > 0 && items.length < total && (
          <button
            type="button"
            onClick={() => void load(offset, true)}
            className="mt-6 w-full rounded-md border border-border py-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            show more — {(total - items.length).toLocaleString()} remaining
          </button>
        )}
        {items.length === 0 && !hits && <p className="mt-10 text-center text-sm text-muted-foreground">Nothing marked yet.</p>}
      </main>
    </div>
  );
}
