import { useMemo, useState } from 'react';
import { Bookmark, Film, ImagePlus, LogOut, Search, X } from 'lucide-react';
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

const formatBytes = (size: number) =>
  size < 1024 * 1024
    ? `${(size / 1024).toFixed(0)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-[#356c5c] text-[#f6f0df]">
        <Film size={19} strokeWidth={1.8} />
      </span>
      <span className="font-[var(--app-font-serif)] text-[26px] leading-none tracking-[-.02em] text-[#263c37]">
        afterframe<span className="text-[#c77f63]">.</span>
      </span>
    </div>
  );
}

function AppNav() {
  const [active, setActive] = useState('Library');
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-4 py-4 md:px-8">
      <Brand />
      <div className="flex items-center gap-2 rounded-full border border-white/50 bg-[#f7f3e9]/85 p-1 shadow-sm backdrop-blur">
        {['Watch', 'Library'].map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => setActive(label)}
            className={`rounded-full px-4 py-2 text-xs font-semibold ${active === label ? 'bg-[#356c5c] text-white' : 'text-[#52645b]'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => undefined}
        className="grid h-10 w-10 place-items-center rounded-full border border-[#ded9ce] bg-[#f8f5ed] text-[#52645b] transition hover:bg-white"
        aria-label="Sign out"
      >
        <LogOut size={17} />
      </button>
    </header>
  );
}

function AssetCard({
  asset,
  onFavorite,
}: {
  asset: Asset;
  onFavorite: (id: string) => void;
}) {
  return (
    <article className="group overflow-hidden rounded-[22px] border border-[#e4dfd4] bg-[#fbf8f1] shadow-[0_3px_12px_rgba(45,61,51,.035)] transition hover:-translate-y-1 hover:shadow-[0_14px_34px_rgba(45,61,51,.09)]">
      <div className={`relative aspect-[1.18] overflow-hidden bg-gradient-to-br ${asset.palette}`}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_22%,rgba(255,255,255,.48),transparent_42%),linear-gradient(155deg,transparent_34%,rgba(35,55,47,.2))]" />
        <div className="absolute -bottom-8 -right-5 h-32 w-40 rotate-[-14deg] rounded-[50%] border border-white/20 bg-white/10 blur-[1px]" />
        <span className="absolute left-3 top-3 rounded-full bg-[#f8f4eb]/90 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[#52675d] backdrop-blur">
          {asset.kind}
        </span>
        <div className="absolute right-3 top-3 flex gap-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <button
            type="button"
            onClick={() => onFavorite(asset.id)}
            className="grid h-9 w-9 place-items-center rounded-full bg-[#f9f6ef]/90 text-[#466458] backdrop-blur"
            aria-label={asset.favorite ? 'Unfavorite' : 'Favorite'}
          >
            <Bookmark size={16} fill={asset.favorite ? 'currentColor' : 'none'} />
          </button>
          <button type="button" onClick={() => undefined} className="rounded-full bg-[#f9f6ef]/90 px-3 text-xs font-semibold text-[#466458] backdrop-blur">Edit</button>
          <button type="button" onClick={() => undefined} className="grid h-9 w-9 place-items-center rounded-full bg-[#f9f6ef]/90 text-[#a14c3f] backdrop-blur" aria-label="Delete media">
            <X size={16} />
          </button>
        </div>
        {asset.kind === 'video' && (
          <span className="absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-[#213b34]/45 text-white backdrop-blur">
            <Film size={14} />
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="truncate text-[15px] font-semibold text-[#30453e]">{asset.title}</h3>
        {asset.collection && <p className="mt-1 truncate text-xs font-medium text-[#567b68]">{asset.collection}</p>}
        <div className="mt-2 flex items-center justify-between text-[11px] text-[#829087]">
          <span>{new Date(`${asset.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <span>{formatBytes(asset.size)}</span>
        </div>
      </div>
    </article>
  );
}

export function Current() {
  const [assets, setAssets] = useState(initialAssets);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | MediaKind>('all');
  const [favorites, setFavorites] = useState(false);
  const [collection, setCollection] = useState('');
  const collections = useMemo(() => [...new Set(initialAssets.map((asset) => asset.collection).filter(Boolean))], []);
  const filtered = useMemo(() => assets.filter((asset) => {
    const matchesSearch = `${asset.title} ${asset.collection}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch
      && (kind === 'all' || asset.kind === kind)
      && (!favorites || asset.favorite)
      && (!collection || (collection === 'uncategorized' ? !asset.collection : asset.collection === collection));
  }), [assets, collection, favorites, kind, search]);
  const toggleFavorite = (id: string) => setAssets((current) => current.map((asset) => asset.id === id ? { ...asset, favorite: !asset.favorite } : asset));
  const totalBytes = assets.reduce((sum, asset) => sum + asset.size, 0);

  return (
    <div className="min-h-[100dvh] bg-[#f4f0e7] pb-24">
      <AppNav />
      <main className="mx-auto max-w-[1440px] px-5 pb-12 pt-28 md:px-10 md:pt-32">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#bd785e]">Your personal archive</p>
            <h1 className="font-[var(--app-font-serif)] mt-2 text-5xl tracking-[-.025em] text-[#2b423a] md:text-6xl">Your library</h1>
            <p className="mt-3 text-sm text-[#76837a]">Browse, search, and group your videos and images.</p>
          </div>
          <button type="button" onClick={() => undefined} className="inline-flex items-center justify-center gap-2 self-start rounded-full bg-[#356c5c] px-6 py-3.5 text-sm font-semibold text-[#fffaf0] shadow-[0_8px_22px_rgba(44,91,74,.14)] transition hover:bg-[#285849] md:self-auto">
            <ImagePlus size={17} /> Add files
          </button>
        </div>

        <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {[
            ['All files', assets.length, 'items'],
            ['Videos', assets.filter((asset) => asset.kind === 'video').length, 'videos'],
            ['Images', assets.filter((asset) => asset.kind === 'image').length, 'images'],
            ['Favorites', assets.filter((asset) => asset.favorite).length, 'saved'],
          ].map(([label, count, suffix]) => (
            <div key={String(label)} className="rounded-[18px] border border-[#e3ded2] bg-[#f9f6ee] px-4 py-4 md:px-5">
              <p className="text-[10px] font-semibold uppercase tracking-[.13em] text-[#879188]">{label}</p>
              <p className="font-[var(--app-font-serif)] mt-1 text-3xl text-[#365347]">{count}<span className="ml-2 font-sans text-[11px] text-[#869087]">{suffix}</span></p>
            </div>
          ))}
        </section>
        <p className="mt-3 text-right text-[11px] text-[#89938a]">Using {formatBytes(totalBytes)}</p>

        <section className="mt-8 flex flex-col gap-3 md:flex-row md:items-center">
          <label className="flex h-12 flex-1 items-center gap-3 rounded-full border border-[#ded9ce] bg-[#fbf8f1] px-4 text-[#718078]">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your files…" className="w-full bg-transparent text-sm text-[#2c443b] outline-none placeholder:text-[#9aa29b]" />
          </label>
          <div className="flex gap-2 overflow-x-auto">
            {(['all', 'video', 'image'] as const).map((value) => (
              <button key={value} type="button" onClick={() => setKind(value)} className={`shrink-0 rounded-full border px-4 py-3 text-xs font-semibold capitalize ${kind === value ? 'border-[#356c5c] bg-[#356c5c] text-white' : 'border-[#ded9ce] bg-[#fbf8f1] text-[#617168]'}`}>
                {value === 'all' ? 'Everything' : value === 'image' ? 'Photos' : 'Videos'}
              </button>
            ))}
            <button type="button" onClick={() => setFavorites((value) => !value)} className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-3 text-xs font-semibold ${favorites ? 'border-[#c47d61] bg-[#c47d61] text-white' : 'border-[#ded9ce] bg-[#fbf8f1] text-[#617168]'}`}>
              <Bookmark size={14} fill={favorites ? 'currentColor' : 'none'} /> Favorites
            </button>
            <select aria-label="Filter by collection" value={collection} onChange={(event) => setCollection(event.target.value)} className="h-11 max-w-[180px] shrink-0 rounded-full border border-[#ded9ce] bg-[#fbf8f1] px-4 text-xs font-semibold text-[#617168] outline-none focus:border-[#729684]">
              <option value="">All groups</option>
              <option value="uncategorized">Unsorted</option>
              {collections.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
          </div>
        </section>

        <p className="mt-4 text-xs text-[#89938a]" aria-live="polite">Showing {filtered.length} of {assets.length} files</p>
        {filtered.length ? (
          <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
            {filtered.map((asset) => <AssetCard key={asset.id} asset={asset} onFavorite={toggleFavorite} />)}
          </div>
        ) : (
          <div className="mt-8 rounded-[28px] border border-[#e2ddd2] bg-[#f9f6ee] px-6 py-14 text-center md:py-20">
            <div className="mx-auto grid h-[74px] w-[74px] place-items-center rounded-[26px] bg-[#e3e9dc] text-[#4a7664]"><ImagePlus size={30} strokeWidth={1.5} /></div>
            <p className="font-[var(--app-font-serif)] mt-6 text-4xl text-[#30483f]">No files match.</p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#7b8980]">Try another search or clear a filter to see more of your collection.</p>
            <button type="button" onClick={() => { setSearch(''); setFavorites(false); setKind('all'); setCollection(''); }} className="mt-6 rounded-full border border-[#cbd4c8] px-5 py-3 text-sm font-semibold text-[#44685a]">Clear filters</button>
          </div>
        )}
      </main>
    </div>
  );
}
