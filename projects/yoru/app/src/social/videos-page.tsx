import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/react";
import { Link, useLocation, useSearch } from "wouter";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Film, Play } from "lucide-react";
import { getGetSocialPostQueryKey, getGetVideoCollectionQueryKey, getVideoCollection, useGetSocialPost } from "@workspace/api-client-react";
import type { GetVideoCollectionSource } from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ayamai-design-system/components/ui/tabs";
import { cn } from "@workspace/ayamai-design-system/lib/utils";
import { LibraryPreview } from "@/components/library-preview";
import { usePageTitle } from "@/lib/page-title";
import { AppNav } from "./app-nav";
import { VideoPlayer } from "./video-player";
import { VideoProgressBar } from "./video-progress-bar";
import { useVideoProgress } from "@/lib/video-progress";
import { VideoReviews } from "./video-reviews";
import { isGone } from "./social-lib";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const duration = (s: number | null) => s === null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const DISCARD = "You have an unsaved review. Discard it?";

export function VideosPage() {
  usePageTitle("Videos");
  const { user } = useUser();
  const uid = user?.id ?? "anon";
  const progress = useVideoProgress(uid);
  const search = useSearch();
  const [, setLocation] = useLocation();
  const raw = new URLSearchParams(search).get("id") ?? "";
  const selectedId = UUID.test(raw) ? raw : "";
  const [source, setSource] = useState<GetVideoCollectionSource>("all");
  const dirty = useRef(false);
  const guard = () => !dirty.current || window.confirm(DISCARD);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ""; } };
    const onLink = (e: MouseEvent) => {
      if (!dirty.current || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (anchor.href !== window.location.href && !window.confirm(DISCARD)) {
        e.preventDefault(); e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onLink, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onLink, true);
    };
  }, []);

  const list = useInfiniteQuery({
    queryKey: [...getGetVideoCollectionQueryKey({ source }), uid, "infinite"],
    queryFn: ({ pageParam }) => getVideoCollection({ source, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: "",
    getNextPageParam: (last) => last.hasMore ? last.nextCursor ?? undefined : undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const selected = useGetSocialPost(selectedId, { query: { enabled: !!selectedId, queryKey: [...getGetSocialPostQueryKey(selectedId), uid], retry: (n, err) => !isGone(err) && n < 2 } });
  const post = selected.data;

  const choose = (id: string) => { if (id !== selectedId && guard()) { dirty.current = false; setLocation(`/videos?id=${id}`); } };
  const switchSource = (next: string) => { if (next !== source && guard()) { dirty.current = false; setSource(next as GetVideoCollectionSource); setLocation("/videos"); } };

  return <div className="library-shell min-h-[100dvh] pb-10 text-foreground">
    <AppNav />
    <main className="mx-auto grid max-w-[1800px] gap-6 px-3 pt-[76px] sm:px-4 md:px-6 md:pt-20 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-label="Player" className="min-w-0 space-y-4">
        {!selectedId ? <div className="grid aspect-video place-items-center rounded-lg border border-border bg-secondary p-6 text-center" data-testid="empty-player">
          <div><span className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-accent text-accent-foreground"><Film size={22} /></span><p className="mt-4 text-lg font-semibold">Pick a video</p><p className="mt-1 text-sm text-muted-foreground">Browse All videos, My videos or Saved. Nothing plays until you press play.</p></div>
        </div>
          : selected.isLoading ? <Skeleton className="aspect-video w-full" />
          : selected.isError || !post ? <div className="rounded-lg border border-border bg-secondary p-8 text-center"><p className="text-lg font-semibold">{isGone(selected.error) ? "This video isn’t available." : "Video didn’t load."}</p>{!isGone(selected.error) && <Button className="mt-4" onClick={() => void selected.refetch()} data-testid="button-retry-post">Try again</Button>}</div>
          : post.mediaType !== "video" ? <p className="rounded-lg border border-border bg-secondary p-8 text-center text-sm text-muted-foreground">That post is not a video. <Link href="/library" className="text-primary underline">Open Library</Link></p>
          : <>
            <VideoPlayer key={post.id} post={post} uid={uid} onDeleted={() => { dirty.current = false; setLocation("/videos"); }} />
            <VideoReviews key={`${uid}:${post.id}`} post={post} uid={uid} onDirtyChange={(d) => { dirty.current = d; }} />
          </>}
      </section>
      <aside aria-label="Video collection" className="min-w-0">
        <Tabs value={source} onValueChange={switchSource}>
          <TabsList className="w-full"><TabsTrigger value="all" className="flex-1" data-testid="tab-videos-all">All videos</TabsTrigger><TabsTrigger value="mine" className="flex-1" data-testid="tab-videos-mine">My videos</TabsTrigger><TabsTrigger value="saved" className="flex-1" data-testid="tab-videos-saved">Saved</TabsTrigger></TabsList>
        </Tabs>
        <p className="mt-2 text-xs text-muted-foreground">Longest first.</p>
        {list.isLoading ? <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">{[0, 1, 2, 3].map((n) => <Skeleton key={n} className="aspect-video" />)}</div>
          : list.isError ? <div className="mt-3 text-sm text-destructive" role="alert">Videos didn’t load. <Button size="sm" variant="outline" onClick={() => void list.refetch()} data-testid="button-retry-videos">Try again</Button></div>
          : items.length === 0 ? <div className="mt-3 rounded-lg border border-border bg-secondary p-6 text-center text-sm text-muted-foreground" data-testid="empty-videos">{source === "all" ? "No videos available yet." : source === "mine" ? "No videos uploaded yet." : "No saved videos yet."}<Link href={source === "mine" ? "/library" : "/feed"} className="mt-2 block text-primary underline">{source === "mine" ? "Add files in Library" : "Find videos in Watch"}</Link></div>
          : <ul className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1" data-testid="list-videos">{items.map((v) => <li key={v.id}>
            <button type="button" onClick={() => choose(v.id)} aria-current={v.id === selectedId ? "true" : undefined} className={cn("flex w-full gap-3 rounded-md p-1 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring", v.id === selectedId && "bg-accent text-accent-foreground")} data-testid={`button-select-video-${v.id}`}>
              <span className="relative block aspect-video w-full shrink-0 overflow-hidden rounded-md bg-muted lg:w-36"><LibraryPreview id={v.id} visible />
                <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded-sm bg-background/80 px-1 text-xs"><Play size={10} fill="currentColor" />{duration(v.durationSeconds)}</span>
                <VideoProgressBar seconds={progress[v.id]?.seconds ?? v.progressSeconds} duration={progress[v.id]?.duration ?? v.durationSeconds} />
              </span>
              <span className="hidden min-w-0 text-xs lg:block"><span className="line-clamp-2 font-medium">{v.description || (v.profile ? v.profile.displayName : "Untitled video")}</span><span className="mt-1 block text-muted-foreground">{(v.viewCount ?? 0).toLocaleString()} views · {v.likeCount} likes</span></span>
            </button>
          </li>)}</ul>}
        {list.hasNextPage && <Button variant="outline" className="mt-3 w-full" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} data-testid="button-more-videos">{list.isFetchingNextPage ? "Loading…" : "Load more"}</Button>}
        {list.isFetchNextPageError && <p className="mt-2 text-xs text-destructive" role="alert">Couldn’t load more. Try again.</p>}
      </aside>
    </main>
  </div>;
}
