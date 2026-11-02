import { useEffect, useRef, useState } from 'react';
import { forgetDeletedMedia } from '@/lib/deleted-media';
import type { FormEvent, ReactNode } from 'react';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ArrowRight, Bookmark, Film, ImagePlus, Plus, Search, X } from 'lucide-react';
import { useListMediaCollections, useUpdateMedia, useDeleteMedia } from '@workspace/api-client-react';
import type { MediaAsset } from '@workspace/api-client-react';
import { AppNav, Brand } from '@/social/app-nav';
import { AdultGate } from '@/social/adult-gate';
import { FeedPage } from '@/social/feed-page';
import { CaptureWatcher } from '@/components/capture-watcher';
import { WatchScrollPage } from '@/social/watch-scroll-page';
import { WatchLifecycleFixtureRoute } from '@/social/watch-lifecycle-fixture';
import { ProfilePage } from '@/social/profile-page';
import { AccountPage } from '@/social/account-page';
import { ModerationPage } from '@/social/moderation-page';
import { LabelsPage } from '@/social/labels-page';
import { CapturePage } from '@/pages/capture';
import { MediaUploadDialog } from '@/components/media-upload-dialog';
import { CreatePostDialog } from '@/components/create-post-dialog';
import { MediaViewerDialog } from '@/components/media-viewer-dialog';
import { ImportProgressSync } from '@/components/import-progress-sync';
import { WatchGestureLayer } from '@/components/watch-gesture-layer';
import { LibraryPreview } from '@/components/library-preview';
import { ActivityLine } from '@/components/activity-line';
import { MangaPage } from '@/manga/manga-page';
import { AlbumsPage } from '@/albums/albums-page';
import { AfterHoursPage } from '@/after-hours/after-hours-page';
import NotFound from '@/pages/not-found';
import { LandingPage } from '@/pages/landing';
import { PrivacyPage, TermsPage } from '@/pages/legal';
import { VideosPage } from '@/social/videos-page';
import { InvitationsPage } from '@/membership/invitations-page';
import { JoinPage } from '@/pages/join';
import { isLargeScreen, useLargeScreen } from '@/lib/use-large-screen';
import { useLibraryBrowsing } from '@/hooks/use-library-browsing';
import { usePageTitle } from '@/lib/page-title';
import { useAccessStatus } from '@/hooks/use-access-status';
import { AccessCheckError } from '@/components/access-check-error';
import { Button } from '@workspace/ayamai-design-system/components/ui/button';
import { Input } from '@workspace/ayamai-design-system/components/ui/input';
import { Label } from '@workspace/ayamai-design-system/components/ui/label';
import { Skeleton } from '@workspace/ayamai-design-system/components/ui/skeleton';

const queryClient = new QueryClient();
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const tokenColor = (name: string) => `hsl(var(--${name}))`;
const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: tokenColor('primary'), colorPrimaryForeground: tokenColor('primary-foreground'),
    colorForeground: tokenColor('foreground'), colorMutedForeground: tokenColor('muted-foreground'),
    colorMuted: tokenColor('muted'), colorDanger: tokenColor('destructive'), colorSuccess: tokenColor('chart-2'),
    colorWarning: tokenColor('chart-4'), colorBackground: tokenColor('card'), colorInput: tokenColor('input'),
    colorInputForeground: tokenColor('foreground'), colorNeutral: tokenColor('foreground'), colorBorder: tokenColor('border'),
    colorRing: tokenColor('ring'), colorModalBackdrop: tokenColor('background'),
    fontFamily: 'var(--app-font-sans)', borderRadius: 'var(--radius)',
  },
  elements: {
    rootBox: 'flex w-full min-w-0 justify-center',
    cardBox: 'w-full min-w-0 max-w-[440px] overflow-hidden rounded-lg border border-border bg-card shadow-2xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-foreground font-semibold tracking-tight',
    headerSubtitle: 'text-muted-foreground',
    socialButtonsBlockButtonText: 'text-foreground font-medium',
    formFieldLabel: 'text-foreground font-medium',
    footerActionLink: 'text-primary font-semibold',
    footerActionText: 'text-muted-foreground',
    dividerText: 'text-muted-foreground',
    identityPreviewEditButton: 'text-primary',
    formFieldSuccessText: 'text-success',
    alertText: 'text-destructive',
    logoBox: 'mb-3',
    logoImage: 'h-9 w-9',
    socialButtonsBlockButton: 'rounded-md border-border bg-secondary',
    formButtonPrimary: 'rounded-md bg-primary hover:bg-primary/90 text-primary-foreground',
    formFieldInput: 'rounded-md border-input bg-background text-foreground',
    footerAction: 'text-muted-foreground',
    dividerLine: 'bg-border',
    alert: 'rounded-md',
    otpCodeFieldInput: 'rounded-md',
    formFieldRow: 'mb-4',
    main: 'gap-5',
  },
};

function FullPageLoading() {
  return <div className="grid min-h-[100dvh] place-items-center bg-background" aria-busy="true"><Skeleton className="h-8 w-8 rounded-full" /></div>;
}

function QueryCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const id = user?.id ?? null;
    if (previous.current !== undefined && previous.current !== id) client.clear();
    previous.current = id;
  }), [addListener, client]);
  return null;
}

function Home() {
  const { isSignedIn, isLoaded } = useUser();
  if (!isLoaded) return <FullPageLoading />;
  return isSignedIn ? <Redirect to={isLargeScreen() ? "/videos" : "/feed"} /> : <LandingPage />;
}

function PrivateRoute({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useUser();
  const { signOut } = useClerk();
  const access = useAccessStatus();
  if (!isLoaded) return <FullPageLoading />;
  if (!isSignedIn) return <Redirect to="/" />;
  if (access.isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-background p-6" aria-busy="true"><div className="w-full max-w-sm space-y-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-24 w-full rounded-lg" /><Skeleton className="h-24 w-full rounded-lg" /></div></div>;
  if (access.isError) return <main className="grid min-h-[100dvh] place-items-center bg-background px-4 py-10 text-foreground"><AccessCheckError error={access.error} retry={() => access.refetch()} /></main>;
  if (!access.data?.membership) return <main className="grid min-h-[100dvh] place-items-center bg-background px-4 py-10 text-foreground"><section className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center" data-testid="status-invitation-required"><p className="font-mono text-xs uppercase tracking-widest text-primary">Private library</p><h1 className="mt-2 text-2xl font-semibold">An invitation is required</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">This account does not have access yet. Ask the library owner for an invitation, then accept it using the invited verified email address.</p><div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row"><Button asChild variant="outline" data-testid="link-invitation-accept"><Link href="/join">I have an invitation</Link></Button><Button variant="ghost" onClick={() => signOut({ redirectUrl: basePath || "/" })} data-testid="button-access-sign-out">Sign out</Button></div></section></main>;
  return <><ImportProgressSync />{children}</>;
}

function AssetCard({ asset, onOpen }: { asset: MediaAsset; onOpen: (asset: MediaAsset) => void }) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") { setNearViewport(true); return; }
    const observer = new IntersectionObserver(([entry]) => setNearViewport(entry.isIntersecting), { rootMargin: "400px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <button
    ref={cardRef}
    type="button"
    onClick={() => onOpen(asset)}
    className="relative block aspect-[4/5] w-full overflow-hidden rounded-md bg-muted outline-none transition duration-200 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
    aria-label={`Open ${asset.mediaType === 'video' ? 'video' : 'photo'} ${asset.title || asset.originalName}`}
    data-testid={`button-open-media-${asset.id}`}
    data-media-id={asset.id}
  >
    <LibraryPreview id={asset.id} visible={nearViewport} />
  </button>;
}

function Library({ accountId }: { accountId: string }) {
  const large = useLargeScreen();
  const [, navigate] = useLocation();
  const openAsset = (asset: MediaAsset) => large && asset.mediaType === 'video' ? navigate(`/videos?id=${asset.id}`) : setViewing(asset);
  const { filters, changeFilter, clearFilters, list, items, gridRef, capture, loadEarlier } = useLibraryBrowsing(accountId);
  const { search, kind, favorites, collectionFilter, uncategorized } = filters;
  const setSearch = (value: string) => changeFilter('search', value);
  const setKind = (value: typeof kind) => changeFilter('kind', value);
  const setFavorites = (update: (previous: boolean) => boolean) => changeFilter('favorites', update(favorites));
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(() => new URLSearchParams(window.location.search).get('create') === '1');
  useEffect(() => {
    if (createOpen && new URLSearchParams(window.location.search).get('create') === '1') navigate('/library', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const open = () => setCreateOpen(true);
    window.addEventListener('ayamai:create-post', open);
    return () => window.removeEventListener('ayamai:create-post', open);
  }, []);
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState<MediaAsset | null>(null);
  const [viewingAsset, setViewing] = useState<MediaAsset | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCollection, setEditCollection] = useState('');
  usePageTitle('Library');
  const client = useQueryClient();
  const collectionQuery = useListMediaCollections({ query: { staleTime: 60_000 } });
  const update = useUpdateMedia();
  const remove = useDeleteMedia();
  const totalItems = list.data?.pages[0]?.total ?? 0;
  const collections = collectionQuery.data?.collections ?? [];
  const viewing = viewingAsset ? items.find((item) => item.id === viewingAsset.id) ?? viewingAsset : null;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const hasFilters = Boolean(search || favorites || kind !== 'all' || collectionFilter || uncategorized);
  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !list.hasNextPage || list.isFetchingNextPage) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void list.fetchNextPage();
    }, { rootMargin: '800px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [items.length, list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage]);
  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    if (!editing || !editTitle.trim()) return;
    try {
      await update.mutateAsync({
        id: editing.id,
        data: {
          title: editTitle.trim(),
          collection: editCollection.trim() || null,
        },
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['/api/media'] }),
        client.invalidateQueries({ queryKey: ['/api/media/collections'] }),
      ]);
      setEditing(null);
    } catch { setActionError('Couldn’t update that title. Please try again.'); }
  }
  function startEdit(asset: MediaAsset) {
    setViewing(null);
    setEditing(asset); setEditTitle(asset.title); setEditCollection(asset.collection ?? '');
  }
  async function toggleFavorite(asset: MediaAsset) {
    try {
      await update.mutateAsync({ id: asset.id, data: { isFavorite: !asset.isFavorite } });
      await Promise.all([
        client.invalidateQueries({ queryKey: ['/api/media'] }),
        client.invalidateQueries({ queryKey: ['/api/watch/feed'] }),
        client.invalidateQueries({ queryKey: ['/api/social/saved'] }),
        client.invalidateQueries({ queryKey: ['/api/social/feed'], refetchType: 'none' }),
      ]);
    } catch { setActionError('Couldn’t update Saved. Please try again.'); }
  }
  async function deleteAsset(asset: MediaAsset) {
    if (!window.confirm(`Permanently delete “${asset.title}” and its stored file? This removes the upload from your library and shared feeds. This can’t be undone.`)) return;
    try {
      await remove.mutateAsync({ id: asset.id });
      setViewing(null);
      await forgetDeletedMedia(client, asset.id, accountId);
    } catch { setActionError('Couldn’t delete that item. Please try again.'); }
  }
  return <div onClickCapture={capture} className="library-shell min-h-[100dvh] pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-foreground">
    <AppNav />
    <main className="mx-auto max-w-[1800px] px-3 pb-8 pt-[76px] sm:px-4 md:px-6 md:pt-20">
      <div className="flex items-center justify-between gap-3">
        <div><p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">Your uploads · shared &amp; unlisted</p><h1 className="mt-1 font-serif text-3xl font-normal tracking-[0.02em] text-foreground md:text-4xl">Library</h1></div>
        <div className="flex shrink-0 gap-2"><Button asChild variant="outline" className="hidden md:inline-flex" data-testid="link-library-videos"><Link href="/videos"><Film size={17} /> Videos</Link></Button><Button variant="outline" onClick={() => setUploadOpen(true)} className="shrink-0" data-testid="button-open-upload"><ImagePlus size={17} /> <span className="hidden sm:inline">Bulk import</span></Button><Button onClick={() => setCreateOpen(true)} className="shrink-0" data-testid="button-create-post"><Plus size={17} /> Create post</Button></div>
      </div>
      <ActivityLine />
      <section className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-md border border-input bg-background px-3.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your collection" className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" data-testid="input-library-search" /></label>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {(['all', 'video', 'image'] as const).map((value) => <button key={value} onClick={() => setKind(value)} aria-pressed={kind === value} className={`shrink-0 rounded border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors ${kind === value ? 'border-foreground/40 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`} data-testid={`button-filter-${value}`}>{value === 'all' ? 'All media' : value === 'image' ? 'Photos' : 'Videos'}</button>)}
          <button onClick={() => setFavorites((v) => !v)} aria-pressed={favorites} className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors ${favorites ? 'border-foreground/40 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`} data-testid="button-filter-favorites"><Bookmark size={13} fill={favorites ? 'currentColor' : 'none'} /> Saved</button>
          <select
            aria-label="Filter by collection"
            value={uncategorized ? 'uncategorized' : collectionFilter ? `group:${collectionFilter}` : 'all'}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'uncategorized') changeFilter('uncategorized', true);
              else changeFilter('collectionFilter', value.startsWith('group:') ? value.slice(6) : '');
            }}
            className="h-9 max-w-[180px] shrink-0 rounded-md border border-border bg-popover px-3 text-xs font-semibold text-foreground/80 outline-none focus:border-primary/70"
            data-testid="select-filter-collection"
          >
            <option value="all">All groups</option>
            <option value="uncategorized">Unsorted</option>
            {collectionFilter && !collections.includes(collectionFilter) && <option value={`group:${collectionFilter}`}>{collectionFilter}</option>}
            {collections.map((name) => <option value={`group:${name}`} key={name}>{name}</option>)}
          </select>
        </div>
      </section>
      {!list.isLoading && !list.isError && <p className="mt-2 text-[11px] text-muted-foreground" aria-live="polite">Showing {items.length} of {totalItems}</p>}
      {actionError && <div className="mt-3 flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert"><span>{actionError}</span><button onClick={() => setActionError('')} aria-label="Dismiss" data-testid="button-dismiss-error"><X size={16} /></button></div>}
      {list.isLoading ? <div className="mt-4 grid grid-cols-2 gap-1.5 md:grid-cols-3 md:gap-2 lg:grid-cols-4 2xl:grid-cols-6">{[0,1,2,3].map((n) => <Skeleton key={n} className="aspect-[4/5] rounded-md" />)}</div>
      : list.isError ? <div className="mt-8 rounded-lg border border-border bg-secondary p-8 text-center"><p className="text-lg font-semibold text-foreground">Your library didn’t load.</p><p className="mt-2 text-sm text-muted-foreground">Your files are safe. Try again.</p><Button onClick={() => list.refetch()} className="mt-5" data-testid="button-retry-library">Try again</Button></div>
      : items.length ? <>
        {list.hasPreviousPage && <div className="mt-3 flex justify-center"><Button type="button" variant="outline" onClick={loadEarlier} disabled={list.isFetchingPreviousPage} data-testid="button-load-earlier">{list.isFetchingPreviousPage ? 'Loading…' : 'Load earlier'}</Button></div>}
        {list.isFetchPreviousPageError && <p role="alert" className="mt-3 text-sm text-destructive">Couldn’t load earlier items. Use “Load earlier” to retry.</p>}
        <div ref={gridRef} className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3 lg:grid-cols-4 2xl:grid-cols-6" data-testid="grid-library">{items.map((asset) => <AssetCard key={asset.id} asset={asset} onOpen={openAsset} />)}</div>
        {list.hasNextPage && <div ref={loadMoreRef} className="mt-6 flex justify-center py-3">
          <Button
            type="button"
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
            variant="outline"
            data-testid="button-load-more"
          >{list.isFetchingNextPage ? 'Loading…' : 'Load more'}</Button>
        </div>}
        {list.isFetchNextPageError && <p className="mt-4 text-center text-sm text-destructive" role="alert">Couldn’t load the next page. Use “Load more” to retry.</p>}
      </>
      : <div className="mt-6 rounded-lg border border-border bg-secondary px-5 py-12 text-center" data-testid="empty-library">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-accent text-accent-foreground"><ImagePlus size={24} /></div>
          <p className="mt-4 text-lg font-semibold text-foreground">{hasFilters ? 'Nothing here.' : 'Your library is empty.'}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{hasFilters ? 'Try another search or clear the filters.' : 'Add photos and videos from this device to start your collection.'}</p>
          {hasFilters ? <Button variant="outline" onClick={clearFilters} className="mt-5" data-testid="button-clear-filters">Clear filters</Button> : <Button onClick={() => setCreateOpen(true)} className="mt-5" data-testid="button-empty-upload">Create post <ArrowRight size={16} /></Button>}
        </div>}
    </main>
    {createOpen && <CreatePostDialog collections={collections} onClose={() => setCreateOpen(false)} onOpenBulk={() => { setCreateOpen(false); setUploadOpen(true); }} />}
    {uploadOpen && <MediaUploadDialog collections={collections} onClose={() => setUploadOpen(false)} />}
    {viewing && <MediaViewerDialog asset={viewing} onClose={() => setViewing(null)} onToggleFavorite={() => void toggleFavorite(viewing)} favoritePending={update.isPending} onEdit={() => startEdit(viewing)} onDelete={() => void deleteAsset(viewing)} deletePending={remove.isPending} />}
    {editing && <div className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-4 backdrop-blur-sm"><form onSubmit={saveTitle} className="w-full max-w-md rounded-lg border border-border bg-popover p-6 shadow-2xl" role="dialog" aria-modal="true" aria-label="Edit details"><div className="flex items-start justify-between"><div><p className="font-mono text-xs uppercase tracking-widest text-primary">Edit details</p><h2 className="mt-1 text-xl font-semibold text-foreground">Collection</h2></div><button type="button" onClick={() => setEditing(null)} aria-label="Close edit" className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid="button-close-edit"><X size={16} /></button></div><Label className="mt-5 block" htmlFor="edit-title">Title</Label><Input id="edit-title" value={editTitle} maxLength={255} onChange={(e) => setEditTitle(e.target.value)} className="mt-2" autoFocus data-testid="input-edit-title" /><Label className="mt-4 block" htmlFor="edit-collection">Collection</Label><Input id="edit-collection" value={editCollection} maxLength={80} list="edit-collection-options" onChange={(e) => setEditCollection(e.target.value)} placeholder="Leave blank to remove from group" className="mt-2" data-testid="input-edit-collection" /><datalist id="edit-collection-options">{collections.map((name) => <option value={name} key={name} />)}</datalist><Button type="submit" disabled={update.isPending || !editTitle.trim()} className="mt-5 w-full" data-testid="button-save-title">{update.isPending ? 'Saving…' : 'Save details'}</Button></form></div>}
  </div>;
}

function SignInPage() {
  usePageTitle('Sign in');
  const redirectTo = safeAuthRedirect();
  return <main className="threshold-auth-page">
    <Link href="/" className="threshold-auth-back">&larr; Back</Link>
    <div className="threshold-auth-content"><div className="w-full min-w-0"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} forceRedirectUrl={redirectTo} /></div><nav className="threshold-auth-footer" aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></div>
  </main>;
}
function SignUpPage() {
  const redirectTo = safeAuthRedirect();
  return <main className="threshold-auth-page">
    <Link href="/" className="threshold-auth-back">&larr; Back</Link>
    <div className="threshold-auth-content"><div className="w-full min-w-0"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={redirectTo} /></div><nav className="threshold-auth-footer" aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></div>
  </main>;
}
function safeAuthRedirect() {
  const fallback = `${basePath}/`;
  const requested = new URLSearchParams(window.location.search).get('redirect_url');
  if (!requested) return fallback;
  try {
    const target = new URL(requested, window.location.origin);
    if (target.origin !== window.location.origin) return fallback;
    if (basePath && target.pathname !== basePath && !target.pathname.startsWith(`${basePath}/`)) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to={isLargeScreen() ? "/videos" : "/feed"} /></Show><Show when="signed-out"><Home /></Show></>;
}
function SocialFeedRoute({ saved = false }: { saved?: boolean }) {
  const { user } = useUser();
  return <PrivateRoute><AdultGate><FeedPage key={`${user?.id}:${saved}`} saved={saved} /></AdultGate></PrivateRoute>;
}
function FeedRoute() { return <WatchScrollPage />; }
function SavedRoute() { return <SocialFeedRoute saved />; }
function ProfileRoute() { return <PrivateRoute><AdultGate><ProfilePage /></AdultGate></PrivateRoute>; }
function AccountRoute() { return <PrivateRoute><AccountPage /></PrivateRoute>; }
function ModerationRoute() { return <PrivateRoute><AdultGate><ModerationPage /></AdultGate></PrivateRoute>; }
function LabelsRoute() {
  const { user } = useUser();
  return <PrivateRoute>{user && <LabelsPage key={user.id} uid={user.id} />}</PrivateRoute>;
}
function CaptureRoute() {
  const { user, isLoaded } = useUser();
  // Stay on the nonce-bearing capture route while signing in in another tab.
  // Never redirect an unauthenticated transfer into a different account flow.
  if (!isLoaded) return <FullPageLoading />;
  return user ? <PrivateRoute><CapturePage key={user.id} uid={user.id} /></PrivateRoute> : <main className="min-h-screen bg-background p-8 text-foreground"><h1 className="text-xl font-semibold">Sign in to receive selected media</h1><p className="mt-3">Sign in to ayamai in another tab, then return here to pair your account.</p><a href={`${basePath}/sign-in`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-primary">Open sign in</a></main>;
}
function VideosRoute() { return <PrivateRoute><AdultGate><VideosPage /></AdultGate></PrivateRoute>; }
function LibraryRoute() {
  const { user } = useUser();
  return <PrivateRoute>{user && <Library key={user.id} accountId={user.id} />}</PrivateRoute>;
}
function AppRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to ayamai.' } }, signUp: { start: { title: 'Create your ayamai account', subtitle: 'Use the email address on your invitation.' } } }}
    routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}>
      <QueryCacheInvalidator />
      <CaptureWatcher />
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/welcome" component={LandingPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/terms" component={TermsPage} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/join/*?" component={JoinPage} />
        <Route path="/invitations"><PrivateRoute><InvitationsPage /></PrivateRoute></Route>
        <Route path="/feed" component={FeedRoute} />
        {import.meta.env.DEV && <Route path="/__watch-lifecycle" component={WatchLifecycleFixtureRoute} />}
        <Route path="/saved" component={SavedRoute} />
        <Route path="/library" component={LibraryRoute} />
        <Route path="/videos" component={VideosRoute} />
        <Route path="/manga"><PrivateRoute><MangaPage /></PrivateRoute></Route>
        <Route path="/albums"><PrivateRoute><AlbumsPage /></PrivateRoute></Route>
        <Route path="/after-hours"><PrivateRoute><AfterHoursPage /></PrivateRoute></Route>
        <Route path="/profile/:id" component={ProfileRoute} />
        <Route path="/account" component={AccountRoute} />
        <Route path="/moderation" component={ModerationRoute} />
        <Route path="/labels" component={LabelsRoute} />
        <Route path="/capture" component={CaptureRoute} />
        <Route component={NotFound} />
      </Switch>
    </QueryClientProvider>
  </ClerkProvider>;
}
function App() {
  return <WouterRouter base={basePath}><AppRoutes /></WouterRouter>;
}
export default App;
