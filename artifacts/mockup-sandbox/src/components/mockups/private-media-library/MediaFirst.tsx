import { useMemo, useState } from 'react';
import {
  Bookmark,
  Film,
  ImagePlus,
  LogOut,
  Play,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import './_group.css';

type MediaKind = 'image' | 'video';
type Asset = {
  id: string;
  title: string;
  collection: string;
  kind: MediaKind;
  date: string;
  size: number;
  favorite: boolean;
  palette: string;
};

const initialAssets: Asset[] = [
  { id: 'asset-01', title: 'Evening by the coast', collection: 'Coastal walks', kind: 'image', date: '2025-05-18', size: 4820000, favorite: true, palette: 'from-[#7f9b94] via-[#c7b99e] to-[#e4c19f]' },
  { id: 'asset-02', title: 'A slow Sunday morning', collection: 'At home', kind: 'video', date: '2025-05-16', size: 28400000, favorite: false, palette: 'from-[#b88d70] via-[#d7b99a] to-[#e4d8c4]' },
  { id: 'asset-03', title: 'Light through the trees', collection: 'Field notes', kind: 'image', date: '2025-05-12', size: 6310000, favorite: true, palette: 'from-[#536e5d] via-[#99a582] to-[#d4bf8b]' },
  { id: 'asset-04', title: 'The old greenhouse', collection: 'Field notes', kind: 'video', date: '2025-05-08', size: 41200000, favorite: false, palette: 'from-[#607b70] via-[#adc0a2] to-[#e0d5b6]' },
  { id: 'asset-05', title: 'Soft afternoon shadows', collection: 'At home', kind: 'image', date: '2025-05-02', size: 3760000, favorite: false, palette: 'from-[#c38f76] via-[#e0b996] to-[#eaddc6]' },
  { id: 'asset-06', title: 'Along the shoreline', collection: 'Coastal walks', kind: 'video', date: '2025-04-28', size: 19300000, favorite: true, palette: 'from-[#567c82] via-[#9cb8b3] to-[#d7c9ae]' },
  { id: 'asset-07', title: 'A quiet corner', collection: '', kind: 'image', date: '2025-04-21', size: 5260000, favorite: false, palette: 'from-[#8f7666] via-[#c5a78b] to-[#e5d2b5]' },
  { id: 'asset-08', title: 'Sunday market colors', collection: 'Small moments', kind: 'image', date: '2025-04-14', size: 7180000, favorite: false, palette: 'from-[#9c8068] via-[#c59e75] to-[#e5c99d]' },
];

const formatBytes = (size: number) => size < 1024 * 1024
  ? `${(size / 1024).toFixed(0)} KB`
  : `${(size / (1024 * 1024)).toFixed(1)} MB`;

function Brand() {
  return (
    <div className="flex items-center gap-2.5" aria-label="afterframe">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#ff7417] text-[#17120f] shadow-[0_6px_20px_rgba(255,116,23,.22)]">
        <Film size={18} strokeWidth={2} />
      </span>
      <span className="font-[var(--app-font-serif)] text-[23px] leading-none tracking-[-.03em] text-[#f7f2ed]">
        afterframe<span className="text-[#ff7417]">.</span>
      </span>
    </div>
  );
}

function AppNav() {
  const [active, setActive] = useState('Library');
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[.08] bg-[#11100f]/95 px-4 py-2.5 backdrop-blur-xl md:px-7">
      <Brand />
      <nav aria-label="Main navigation" className="flex items-center gap-1 rounded-full border border-white/[.08] bg-white/[.035] p-1">
        {['Watch', 'Library'].map((label) => (
          <button key={label} type="button" onClick={() => setActive(label)} aria-current={active === label ? 'page' : undefined}
            className={`rounded-full px-4 py-1.5 text-[11px] font-semibold transition ${active === label ? 'bg-[#ff7417] text-[#17120f]' : 'text-[#aaa49e] hover:text-white'}`}>
            {label}
          </button>
        ))}
      </nav>
      <button type="button" onClick={() => undefined} className="grid h-8 w-8 place-items-center rounded-full border border-white/[.1] text-[#aaa49e] transition hover:bg-white/[.08] hover:text-white" aria-label="Sign out">
        <LogOut size={16} />
      </button>
    </header>
  );
}

function VisualTreatment({ asset }: { asset: Asset }) {
  return (
    <>
      <div className={`absolute inset-0 bg-gradient-to-br ${asset.palette}`} />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_24%_20%,rgba(255,255,255,.55),transparent_35%),radial-gradient(ellipse_at_83%_77%,rgba(255,116,23,.42),transparent_40%),linear-gradient(145deg,transparent_28%,rgba(18,13,10,.48))]" />
      <div className="absolute -left-[18%] top-[18%] h-[62%] w-[90%] rotate-[-28deg] rounded-[48%] border border-white/25 bg-white/[.12] blur-[1px]" />
      <div className="absolute -bottom-[44%] -right-[12%] h-[85%] w-[88%] rounded-full border border-white/20 bg-[#24150e]/25 blur-[2px]" />
      <div className="absolute inset-0 opacity-20 mix-blend-soft-light" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%270 0 180 180%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%27.8%27 numOctaves=%274%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27 opacity=%27.45%27/%3E%3C/svg%3E")' }} />
    </>
  );
}

function AssetCard({ asset, onFavorite, onDelete }: { asset: Asset; onFavorite: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <article className="group relative min-w-0" aria-label={`${asset.kind === 'video' ? 'Video' : 'Image'} in ${asset.collection || 'Unsorted'} collection`}>
      <div className="relative aspect-[.79] overflow-hidden rounded-[12px] bg-[#28221e] shadow-[0_12px_30px_rgba(0,0,0,.32)] ring-1 ring-white/[.08] transition duration-300 group-hover:ring-[#ff7417]/60 sm:aspect-[.9]">
        <VisualTreatment asset={asset} />
        <span className="absolute left-2 top-2 rounded-sm border border-white/15 bg-[#11100f]/65 px-2 py-1 text-[8px] font-bold uppercase tracking-[.15em] text-white/90 backdrop-blur-md">
          {asset.kind === 'video' ? 'Video' : 'Photo'}
        </span>
        <div className="absolute right-2 top-2 flex gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <button type="button" onClick={() => onFavorite(asset.id)} aria-label={asset.favorite ? `Remove ${asset.title} from favorites` : `Add ${asset.title} to favorites`}
            className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-[#11100f]/70 text-white backdrop-blur-md hover:bg-[#ff7417] hover:text-[#17120f]">
            <Bookmark size={14} fill={asset.favorite ? 'currentColor' : 'none'} />
          </button>
          <button type="button" onClick={() => onDelete(asset.id)} aria-label={`Delete ${asset.title}`}
            className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-[#11100f]/70 text-white backdrop-blur-md hover:bg-[#ff7417] hover:text-[#17120f]">
            <Trash2 size={14} />
          </button>
        </div>
        {asset.kind === 'video' && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-white/50 bg-[#11100f]/35 pl-0.5 text-white shadow-lg backdrop-blur-sm transition group-hover:scale-110 group-hover:border-[#ff7417] group-hover:bg-[#ff7417] group-hover:text-[#17120f]">
              <Play size={16} fill="currentColor" />
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

export function MediaFirst() {
  const [assets, setAssets] = useState(initialAssets);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | MediaKind>('all');
  const [favorites, setFavorites] = useState(false);
  const [collection, setCollection] = useState('');
  const collections = useMemo(() => [...new Set(initialAssets.map((asset) => asset.collection).filter(Boolean))], []);
  const filtered = useMemo(() => assets.filter((asset) => {
    const matchesSearch = `${asset.title} ${asset.collection}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (kind === 'all' || asset.kind === kind) && (!favorites || asset.favorite)
      && (!collection || (collection === 'uncategorized' ? !asset.collection : asset.collection === collection));
  }), [assets, collection, favorites, kind, search]);
  const toggleFavorite = (id: string) => setAssets((current) => current.map((asset) => asset.id === id ? { ...asset, favorite: !asset.favorite } : asset));
  const totalBytes = assets.reduce((sum, asset) => sum + asset.size, 0);
  const clearFilters = () => { setSearch(''); setFavorites(false); setKind('all'); setCollection(''); };

  return (
    <div className="min-h-[100dvh] bg-[#11100f] pb-12 text-[#f7f2ed]">
      <AppNav />
      <main className="mx-auto max-w-[1600px] px-3 pb-12 pt-3 sm:px-5 md:px-7">
        <section aria-label="Collection filters" className="mb-3">
          <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
            <label className="flex h-10 w-full items-center gap-2.5 rounded-lg border border-white/[.1] bg-[#1c1a18] px-3 text-[#948c85] md:max-w-[270px]">
              <Search size={16} />
              <input aria-label="Search your media" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your collection" className="w-full bg-transparent text-xs text-white outline-none placeholder:text-[#766f68]" />
            </label>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {(['all', 'video', 'image'] as const).map((value) => (
                <button key={value} type="button" onClick={() => setKind(value)} aria-pressed={kind === value}
                  className={`shrink-0 rounded-md px-3 py-2 text-[10px] font-bold transition ${kind === value ? 'bg-[#ff7417] text-[#17120f]' : 'border border-white/[.09] bg-[#1c1a18] text-[#b7afa7] hover:border-white/25 hover:text-white'}`}>
                  {value === 'all' ? 'All media' : value === 'image' ? 'Photos' : 'Videos'}
                </button>
              ))}
              <button type="button" onClick={() => setFavorites((value) => !value)} aria-pressed={favorites}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 text-[10px] font-semibold transition ${favorites ? 'border-[#ff7417] bg-[#ff7417] text-[#17120f]' : 'border-white/[.09] bg-[#1c1a18] text-[#b7afa7] hover:border-white/25 hover:text-white'}`}>
                <Bookmark size={13} fill={favorites ? 'currentColor' : 'none'} /> Saved
              </button>
              <label className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/[.09] bg-[#1c1a18] pl-2.5 text-[#9e929e]">
                <SlidersHorizontal size={13} />
                <select aria-label="Filter by collection" value={collection} onChange={(event) => setCollection(event.target.value)} className="h-9 max-w-[140px] bg-transparent pr-2 text-[10px] font-semibold text-[#c7bfb8] outline-none">
                  <option className="bg-[#1c1a18]" value="">All collections</option>
                  <option className="bg-[#1c1a18]" value="uncategorized">Unsorted</option>
                  {collections.map((name) => <option className="bg-[#1c1a18]" value={name} key={name}>{name}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => undefined} aria-label="Add files" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-[#ff7417] px-3 text-[10px] font-bold text-[#17120f] transition hover:bg-[#ff8b3e]">
                <ImagePlus size={14} /> Upload
              </button>
            </div>
          </div>
          <div className="flex h-7 items-end justify-between border-b border-white/[.08] pb-2">
            <p className="text-[10px] text-[#938b83]" aria-live="polite">Showing <span className="font-semibold text-[#f7f2ed]">{filtered.length}</span> of {assets.length}</p>
            <span className="hidden text-[9px] text-[#716a64] sm:inline">{formatBytes(totalBytes)} stored</span>
          </div>
        </section>

        {filtered.length ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {filtered.map((asset) => <AssetCard key={asset.id} asset={asset} onFavorite={toggleFavorite} onDelete={(id) => setAssets((current) => current.filter((item) => item.id !== id))} />)}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/[.08] bg-[#1c1a18] px-5 py-14 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[#ff7417]/15 text-[#ff8b3e]"><X size={22} /></div>
            <p className="font-[var(--app-font-serif)] mt-4 text-3xl text-[#f7f2ed]">Nothing in this reel.</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-[#a49b93]">Try a different search or loosen a filter.</p>
            <button type="button" onClick={clearFilters} className="mt-5 rounded-md bg-[#ff7417] px-4 py-2.5 text-xs font-bold text-[#17120f] transition hover:bg-[#ff8b3e]">Show everything</button>
          </div>
        )}
      </main>
    </div>
  );
}
