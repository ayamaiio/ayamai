import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/react";
import { Link } from "wouter";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Hash, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { getGetLabelCatalogQueryKey, useGetLabelCatalog, getGetSocialFeedQueryKey, getGetWatchSettingsQueryKey, getSocialFeed, getSavedSocialPosts, getGetSavedSocialPostsQueryKey, useGetWatchSettings, useUpdateWatchSettings } from "@workspace/api-client-react";
import { AppNav } from "./app-nav";
import { SocialTile } from "./social-tile";
import { sessionFor } from "./social-lib";
import { canonicalTag } from "./annotation-lib";
import { isLargeScreen } from "@/lib/use-large-screen";
import { useWatchChrome, watchChromeAttributes, watchChromeClass } from "@/lib/use-watch-chrome";
import { Switch } from "@workspace/ayamai-design-system/components/ui/switch";

type LengthMode = "short" | "long";
const currentMode = (): LengthMode => isLargeScreen() ? "long" : "short";

type Lane = "for-you" | "collection";
type Kind = "all" | "image" | "video";

export function FeedPage({ saved = false }: { saved?: boolean }) {
  useEffect(() => { document.title = saved ? "Saved · yoru" : "Watch · yoru"; }, [saved]);
  const { user } = useUser();
  const uid = user?.id ?? "anon";
  const [lane, setLane] = useState<Lane>("for-you");
  const [kind, setKind] = useState<Kind>("all");
  const [hashtag, setHashtag] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [tagText, setTagText] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const scope = (k: Kind, tag: string) => tag ? `${k}.tag.${tag}` : k;
  const [lengthMode, setLengthMode] = useState<LengthMode>(currentMode);
  const [sessionId, setSessionId] = useState(() => sessionFor(uid, "for-you", "all", false, lengthMode));
  const [active, setActive] = useState(0);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mediaControlsPinned, setMediaControlsPinned] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [legacyAutoplay, setLegacyAutoplay] = useState<{ userId: string; enabled: boolean } | null>(null);
  const migratedUser = useRef<string | null>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const client = useQueryClient();
  const settingsKey = [...getGetWatchSettingsQueryKey(), uid];
  const currentUid = useRef(uid);
  currentUid.current = uid;
  const settings = useGetWatchSettings({ query: { queryKey: settingsKey, enabled: !!user?.id, staleTime: 0, refetchOnWindowFocus: true } });
  const updateSettings = useUpdateWatchSettings();
  const autoplayReady = Boolean(user?.id && settings.data && !settings.isLoading);
  const autoplayEnabled = autoplayReady && (settings.data!.autoplayEnabled ?? (legacyAutoplay && legacyAutoplay.userId === user?.id ? legacyAutoplay.enabled : true));
  const dataSaverEnabled = settings.data?.dataSaverEnabled ?? false;
  const alwaysVisibleControls = settings.data?.alwaysVisibleControls ?? false;
  // Bind writes to the account that started them, including delayed responses.
  const saveSettings = (saved: NonNullable<typeof settings.data>) => {
    if (currentUid.current !== uid) return;
    client.setQueryData(settingsKey, saved);
  };
  useEffect(() => {
    if (!user?.id || !settings.data || settings.data.autoplayEnabled !== null || migratedUser.current === user.id) return;
    migratedUser.current = user.id;
    try {
      const stored = window.localStorage.getItem(`afterframe.watch.autoplay.${user.id}`);
      if (stored !== "true" && stored !== "false") return;
      const enabled = stored === "true";
      setLegacyAutoplay({ userId: user.id, enabled });
      updateSettings.mutate({ data: { autoplayEnabled: enabled } }, {
        onSuccess: (saved) => {
          if (currentUid.current !== uid) return;
          saveSettings(saved);
          setSettingsMessage("Your autoplay preference is now synced to your account.");
        },
        onError: () => setSettingsMessage("Your previous autoplay choice could not be synced. You can set it here and try again."),
      });
    } catch {
      setSettingsMessage("Your previous autoplay choice could not be read. Set autoplay here to save it to your account.");
    }
  }, [user?.id, settings.data, updateSettings, client]);
  const toggleAutoplay = () => {
    if (!autoplayReady || updateSettings.isPending) return;
    const enabled = !autoplayEnabled;
    updateSettings.mutate({ data: { autoplayEnabled: enabled } }, {
      onSuccess: (saved) => {
        if (currentUid.current !== uid) return;
        saveSettings(saved);
        setSettingsMessage(`Video autoplay ${saved.autoplayEnabled ? "enabled" : "disabled"}.`);
      },
      onError: () => setSettingsMessage("Autoplay preference could not be saved. Try again."),
    });
  };
  const toggleDataSaver = () => {
    if (!autoplayReady || updateSettings.isPending) return;
    updateSettings.mutate({ data: { dataSaverEnabled: !dataSaverEnabled } }, {
      onSuccess: (saved) => {
        if (currentUid.current !== uid) return;
        saveSettings(saved);
        setSettingsMessage(`Data saver ${saved.dataSaverEnabled ? "enabled" : "disabled"}.`);
      },
      onError: () => setSettingsMessage("Data saver preference could not be saved. Try again."),
    });
  };
  const toggleAlwaysVisibleControls = () => {
    if (!autoplayReady || updateSettings.isPending) return;
    updateSettings.mutate({ data: { alwaysVisibleControls: !alwaysVisibleControls } }, {
      onSuccess: (saved) => {
        if (currentUid.current !== uid) return;
        saveSettings(saved);
        setSettingsMessage(saved.alwaysVisibleControls ? "Watch controls will stay visible." : "Watch controls will hide automatically.");
      },
      onError: () => {
        if (currentUid.current === uid) setSettingsMessage("Controls preference could not be saved. Try again.");
      },
    });
  };
  const behaviorEnabled = settings.data?.behaviorEnabled ?? false;

  const switchTo = (nextLane: Lane, nextKind: Kind, fresh = false, nextTag = hashtag) => {
    setLane(nextLane); setKind(nextKind); setHashtag(nextTag);
    // Length mode is re-read only when a new cycle/context starts; each mode keeps its own session id.
    const mode = currentMode();
    setLengthMode(mode);
    setSessionId(sessionFor(uid, nextLane, scope(nextKind, nextTag), fresh || nextTag !== hashtag, mode));
    setRemoved(new Set());
    setActive(0);
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const pickTag = (raw: string) => {
    const tag = canonicalTag(raw);
    setTagOpen(false); setTagText("");
    if (sheetOpen) return;
    switchTo(lane, kind, true, tag);
  };
  const tagPrefix = canonicalTag(tagText);
  const catalogParams = tagPrefix ? { prefix: tagPrefix } : undefined;
  const catalog = useGetLabelCatalog(catalogParams, { query: { enabled: tagOpen, queryKey: [...getGetLabelCatalogQueryKey(catalogParams), uid], staleTime: 60_000 } });
  useEffect(() => { setHashtag(""); setSheetOpen(false); setSettingsOpen(false); setSettingsMessage(""); const mode = currentMode(); setLengthMode(mode); setSessionId(sessionFor(uid, lane, kind, false, mode)); /* account switch */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const params = hashtag ? { sessionId, lane, type: kind, hashtag, lengthPreference: lengthMode } : { sessionId, lane, type: kind, lengthPreference: lengthMode };
  const feed = useInfiniteQuery({
    queryKey: [...(saved ? getGetSavedSocialPostsQueryKey({ type: kind }) : getGetSocialFeedQueryKey(params)), uid],
    queryFn: async ({ pageParam }) => {
      if (saved) {
        const page = await getSavedSocialPosts({ type: kind, ...(typeof pageParam === "string" ? { cursor: pageParam } : {}) });
        return { ...page, nextPage: page.nextCursor };
      }
      const page = await getSocialFeed({ ...params, offset: Number(pageParam) });
      return { ...page, nextPage: page.nextOffset };
    },
    initialPageParam: 0 as number | string,
    getNextPageParam: (last) => last.hasMore ? last.nextPage ?? undefined : undefined,
    staleTime: saved ? 0 : Infinity,
    refetchOnWindowFocus: saved,
  });
  const fetchMore = feed.fetchNextPage;
  const seen = new Set<string>();
  const items = (feed.data?.pages.flatMap((p) => p.items) ?? []).filter((p) => !removed.has(p.id) && !seen.has(p.id) && seen.add(p.id));
  const atEnd = items.length > 0 && !feed.hasNextPage && !feed.isFetchingNextPage;
  useEffect(() => {
    if (saved && active >= items.length) setActive(Math.max(0, items.length - 1));
  }, [saved, active, items.length]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number((entry.target as HTMLElement).dataset.index);
        setActive(index);
        if (index >= items.length - 3 && feed.hasNextPage && !feed.isFetchingNextPage && !feed.isFetchNextPageError) void feed.fetchNextPage();
      }
    }, { root, threshold: 0.6 });
    root.querySelectorAll("[data-index]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items.length, feed.hasNextPage, feed.isFetchingNextPage, feed.isFetchNextPageError, feed.fetchNextPage]);

  // Reaching the end card rolls into a fresh cycle, never reshuffling mid-cycle.
  const endActive = atEnd && active === items.length;
  useEffect(() => {
    if (saved || !endActive || sheetOpen) return;
    const t = setTimeout(() => switchTo(lane, kind, true), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endActive, saved, sheetOpen]);

  const chrome = useWatchChrome(items[active]?.id ?? "", settingsOpen || tagOpen || sheetOpen || mediaControlsPinned || !items[active], true, alwaysVisibleControls);
  const onGone = (id: string) => setRemoved((cur) => new Set(cur).add(id));
  const chip = (on: boolean) => `rounded-full px-3 py-1.5 text-[11px] font-bold transition ${on ? "bg-foreground text-primary-foreground" : "text-foreground/80 hover:text-foreground"}`;

  return <div className="h-[100dvh] overflow-hidden bg-background" {...chrome.handlers}>
    <div {...watchChromeAttributes(chrome.visible)} className={`relative z-40 ${watchChromeClass(chrome.visible)}`}><AppNav /></div>
    <div {...watchChromeAttributes(chrome.visible)} className={`fixed right-3 top-[66px] z-40 ${watchChromeClass(chrome.visible)}`}>
      <button type="button" onClick={() => setSettingsOpen((open) => !open)} aria-label="Feed settings" aria-expanded={settingsOpen} className="grid h-9 w-9 place-items-center rounded-full border border-border bg-background/60 text-foreground backdrop-blur-md" data-testid="button-watch-settings"><SlidersHorizontal size={16} /></button>
      {settingsOpen && <section className="absolute right-0 mt-2 w-[min(320px,calc(100vw-2rem))] rounded-lg border border-border bg-popover/95 p-4 text-foreground shadow-2xl backdrop-blur-xl" aria-label="Watch feed settings">
        <h2 className="text-sm font-bold">Watch playback</h2>
        <p className="mt-1 text-xs leading-5 text-foreground/80">Saved to your account across devices. Data saver stops Watch autoplay and preloading; manual playback uses original video quality. Library playback is unchanged.</p>
        <button type="button" role="switch" aria-checked={autoplayReady ? autoplayEnabled : false} onClick={toggleAutoplay} disabled={!autoplayReady || updateSettings.isPending} className="mt-4 flex w-full items-center justify-between rounded-md border border-border bg-secondary px-3 py-3 text-left text-xs font-semibold disabled:opacity-60" data-testid="switch-watch-autoplay"><span>Autoplay videos</span><span className={`rounded-full px-2.5 py-1 ${autoplayReady && !autoplayEnabled ? "bg-secondary text-foreground/80" : "bg-primary text-primary-foreground"}`}>{!autoplayReady ? (settings.isError ? "Unavailable" : "Loading…") : !autoplayEnabled ? "Off" : "On"}</span></button>
        <button type="button" role="switch" aria-checked={autoplayReady ? dataSaverEnabled : false} onClick={toggleDataSaver} disabled={!autoplayReady || updateSettings.isPending} className="mt-2 flex w-full items-center justify-between rounded-md border border-border bg-secondary px-3 py-3 text-left text-xs font-semibold disabled:opacity-60" data-testid="switch-watch-data-saver"><span>Data saver</span><span className={`rounded-full px-2.5 py-1 ${dataSaverEnabled ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground/80"}`}>{!autoplayReady ? (settings.isError ? "Unavailable" : "Loading…") : dataSaverEnabled ? "On" : "Off"}</span></button>
        <div className="mt-4 flex items-center justify-between gap-3">
          <label htmlFor="watch-always-visible-controls" className="text-xs font-semibold">Always show controls</label>
          <Switch id="watch-always-visible-controls" checked={alwaysVisibleControls} onCheckedChange={toggleAlwaysVisibleControls} disabled={!autoplayReady || updateSettings.isPending} aria-describedby="watch-controls-description" data-testid="switch-watch-always-visible-controls" />
        </div>
        <p id="watch-controls-description" className="mt-1 text-xs leading-5 text-foreground/80">Keep navigation and playback controls visible in Watch and Saved. Off hides them automatically.</p>
        {settings.isError && <button type="button" onClick={() => void settings.refetch()} className="mt-2 text-xs font-semibold text-accent-foreground underline">Retry loading settings</button>}
        {settingsMessage && <p className="mt-2 text-xs text-accent-foreground" role="status">{settingsMessage}</p>}
      </section>}
    </div>
    <div {...watchChromeAttributes(chrome.visible)} className={`pointer-events-none fixed inset-x-0 top-[66px] z-30 flex flex-col items-center gap-1.5 px-3 ${watchChromeClass(chrome.visible)}`}>
      {saved ? <h1 className="rounded-md bg-background/60 px-5 py-2 text-sm font-bold text-foreground backdrop-blur-md">Saved · Only you</h1> : <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-background/45 p-1 backdrop-blur-md" role="tablist" aria-label="Feed lane">
        {(["for-you", "collection"] as const).map((l) => <button key={l} role="tab" aria-selected={lane === l} onClick={() => lane !== l && switchTo(l, kind)} className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${lane === l ? "text-foreground" : "text-muted-foreground hover:text-foreground/80"}`} data-testid={`tab-lane-${l}`}>{l === "for-you" ? "For You" : "Collection"}{lane === l && <span className="mx-auto mt-0.5 block h-0.5 w-5 rounded-full bg-primary" />}</button>)}
      </div>}
      <div className="pointer-events-auto flex gap-0.5 rounded-full bg-background/35 p-0.5 backdrop-blur-md" aria-label="Media type">
        {(["all", "video", "image"] as const).map((k) => <button key={k} aria-pressed={kind === k} onClick={() => kind !== k && switchTo(lane, k)} className={chip(kind === k)} data-testid={`button-feed-type-${k}`}>{k === "all" ? "All" : k === "video" ? "Videos" : "Images"}</button>)}
        {!saved && <button type="button" aria-expanded={tagOpen} aria-label="Filter by hashtag" onClick={() => setTagOpen((o) => !o)} className={`${chip(!!hashtag)} inline-flex items-center gap-1`} data-testid="button-hashtag-filter"><Hash size={11} />{hashtag || "Tag"}</button>}
        {hashtag && <button type="button" onClick={() => switchTo(lane, kind, true, "")} aria-label={`Clear #${hashtag} filter`} className="grid w-7 place-items-center rounded-full text-foreground/80 hover:text-foreground" data-testid="button-clear-hashtag"><X size={13} /></button>}
      </div>
      {tagOpen && <div className="pointer-events-auto w-[min(340px,calc(100vw-1.5rem))] rounded-lg border border-border bg-popover/95 p-3 text-foreground shadow-2xl backdrop-blur-xl" data-testid="panel-hashtag-picker">
        <form onSubmit={(e) => { e.preventDefault(); if (tagPrefix) pickTag(tagPrefix); }} className="flex gap-2">
          <input autoFocus value={tagText} onChange={(e) => setTagText(e.target.value)} maxLength={120} placeholder="Search hashtags" aria-label="Hashtag" className="min-w-0 flex-1 rounded-md border border-border bg-background/30 px-3 py-2 text-sm outline-none focus:border-primary" data-testid="input-hashtag-filter" />
          <button type="submit" disabled={!tagPrefix} className="rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-40" data-testid="button-apply-hashtag">Go</button>
        </form>
        {tagPrefix && <p className="mt-1.5 text-[11px] text-muted-foreground">Filters to #{tagPrefix} — public tags and your private labels.</p>}
        <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {catalog.isLoading ? [0, 1, 2].map((i) => <span key={i} className="h-6 w-16 animate-pulse rounded-full bg-secondary" />)
            : (catalog.data?.items ?? []).slice(0, 20).map((s) => <button type="button" key={s.tag} onClick={() => pickTag(s.tag)} className={`rounded-full px-2.5 py-1 text-xs ${s.tag === hashtag ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground/80 hover:bg-accent"}`} data-testid={`button-hashtag-option-${s.tag}`}>#{s.tag} <span className="opacity-50">{s.count}</span></button>)}
          {!catalog.isLoading && (catalog.data?.items.length ?? 0) === 0 && <span className="text-xs text-muted-foreground">{catalog.isError ? "Suggestions unavailable." : "No matching tags yet."}</span>}
        </div>
      </div>}
    </div>
    <main key={`${uid}|${lane}|${kind}|${hashtag}`} ref={scrollRef} className={`h-[100dvh] snap-y snap-mandatory overscroll-y-contain ${sheetOpen ? "overflow-hidden" : "overflow-y-auto"}`} data-testid="feed-view">
      {feed.isLoading ? <div className="grid h-[100dvh] place-items-center"><div className="w-64 space-y-3"><div className="h-[52dvh] animate-pulse rounded-3xl bg-secondary" /><div className="h-4 w-32 animate-pulse rounded bg-secondary" /><div className="h-3 w-48 animate-pulse rounded bg-secondary" /></div></div>
        : feed.isError ? <div className="grid h-[100dvh] place-items-center px-6 text-center text-foreground"><div><p className="text-4xl">The feed didn’t load.</p><button onClick={() => void feed.refetch()} className="mt-5 rounded-md bg-foreground px-5 py-3 text-sm font-semibold text-primary-foreground" data-testid="button-retry-feed">Try again</button></div></div>
        : items.length === 0 ? <div className="grid h-[100dvh] place-items-center px-6 text-center text-foreground"><div className="max-w-sm">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-lg border border-border bg-foreground/5"><Sparkles size={22} /></span>
          <p className="mt-6 text-4xl leading-tight">{saved ? "No saved posts here yet." : hashtag ? `Nothing tagged #${hashtag}.` : lane === "collection" ? "No uploads here yet." : "Quiet in here."}</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{saved ? "Save posts in Watch or favorite your own items in Library. Only you can see this list. Unavailable posts are hidden." : lane === "collection" ? "Your uploaded photos and videos appear here, including private posts. Try another filter or add files in Library." : "No public posts match yet. Be the first — share something from your Library."}</p>
          <Link href="/library" className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-bold text-primary-foreground" data-testid="link-feed-upload">Open Library <ArrowRight size={16} /></Link>
        </div></div>
        : <>
          {items.map((post, index) => <div key={post.id} data-index={index} className="h-[100dvh] snap-start snap-always">
            {Math.abs(index - active) <= 2 ? <SocialTile post={post} active={index === active} prefetch={index === active + 1} autoplay={autoplayEnabled} dataSaver={dataSaverEnabled} behaviorEnabled={behaviorEnabled} onGone={onGone} uid={uid} onHashtag={saved ? undefined : pickTag} onLabelSheetChange={setSheetOpen} savedOnly={saved} controlsVisible={chrome.visible} onRevealControls={chrome.reveal} onControlsPinnedChange={setMediaControlsPinned} /> : <div className="h-full bg-background" />}
          </div>)}
          {feed.isFetchingNextPage && <div className="grid h-[100dvh] snap-start place-items-center text-sm text-foreground/80">Loading more…</div>}
          {feed.isFetchNextPageError && <div className="grid h-[100dvh] snap-start place-items-center text-center text-foreground"><div><p className="text-3xl">Couldn’t load more.</p><button onClick={() => void fetchMore()} className="mt-4 rounded-md bg-foreground px-5 py-3 text-sm font-semibold text-primary-foreground" data-testid="button-retry-more">Try again</button></div></div>}
          {atEnd && <div data-index={items.length} className="grid h-[100dvh] snap-start place-items-center px-6 text-center text-foreground"><div><p className="text-4xl">{saved ? "You’re all caught up." : "That’s this cycle."}</p><p className="mt-3 text-sm text-muted-foreground">{saved ? "Your saves stay private. Save more posts in Watch." : "Rolling into a fresh one…"}</p>{!saved && <button onClick={() => switchTo(lane, kind, true)} className="mt-5 rounded-md bg-primary px-5 py-3 text-sm font-bold text-primary-foreground" data-testid="button-new-feed-cycle">Start now</button>}</div></div>}
        </>}
    </main>
  </div>;
}
