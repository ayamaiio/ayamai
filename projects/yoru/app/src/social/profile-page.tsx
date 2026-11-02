import { usePageTitle } from "@/lib/page-title";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getGetMediaViewUrlQueryKey, getGetSocialProfileQueryKey, getGetWatchSettingsQueryKey, getSocialProfile, useGetMediaViewUrl, useGetWatchSettings } from "@workspace/api-client-react";
import type { SocialPost } from "@workspace/api-client-react";
import { Heart, Play } from "lucide-react";
import { AppNav } from "./app-nav";
import { SocialTile } from "./social-tile";
import { isGone } from "./social-lib";
import { FollowButton } from "./follow-button";
import { useUser } from "@clerk/react";

function ProfileCell({ post, onOpen, onGone }: { post: SocialPost; onOpen: () => void; onGone: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const o = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "400px" });
    o.observe(node);
    return () => o.disconnect();
  }, []);
  const view = useGetMediaViewUrl(post.id, { query: { enabled: near, queryKey: getGetMediaViewUrlQueryKey(post.id), staleTime: 60_000, retry: (n, err) => !isGone(err) && n < 2 } });
  const gone = view.isError && isGone(view.error);
  const goneRef = useRef(onGone); goneRef.current = onGone;
  useEffect(() => { if (gone) goneRef.current(); }, [gone]);
  const url = view.data?.url;
  return <button ref={ref} onClick={onOpen} className="relative block aspect-[4/5] w-full overflow-hidden rounded-[6px] bg-card outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Open post" data-testid={`button-profile-post-${post.id}`}>
    {url && post.mediaType === "image" && <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />}
    {url && post.mediaType === "video" && <video src={`${url.split("#")[0]}#t=0.001`} aria-hidden="true" className="pointer-events-none h-full w-full object-cover" muted playsInline preload="metadata" />}
    {!url && <div className={`media-placeholder h-full w-full ${view.isError ? "" : "animate-pulse"}`} />}
    <span className="absolute bottom-1.5 left-2 flex items-center gap-2 text-[11px] font-semibold text-foreground drop-shadow">{post.mediaType === "video" && <Play size={11} fill="currentColor" />}<Heart size={11} /> {post.likeCount}</span>
  </button>;
}

export function ProfilePage() {
  usePageTitle("Profile");
  const { id = "" } = useParams<{ id: string }>();
  const { user } = useUser();
  const [open, setOpen] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const settings = useGetWatchSettings({ query: { queryKey: getGetWatchSettingsQueryKey(), staleTime: 30_000 } });
  const q = useInfiniteQuery({
    queryKey: [...getGetSocialProfileQueryKey(id), "infinite"],
    queryFn: ({ pageParam }) => getSocialProfile(id, { offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => last.hasMore ? pages.reduce((n, p) => n + p.posts.length, 0) : undefined,
    retry: (n, err) => !isGone(err) && n < 2,
  });
  const profile = q.data?.pages[0]?.profile;
  const posts = (q.data?.pages.flatMap((p) => p.posts) ?? []).filter((p) => !removed.has(p.id));
  const openPost = posts.find((p) => p.id === open);
  const drop = (pid: string) => { setRemoved((c) => new Set(c).add(pid)); if (open === pid) setOpen(null); };

  return <div className="library-shell min-h-[100dvh] pb-10 text-foreground">
    <AppNav />
    <main className="mx-auto max-w-[1100px] px-3 pt-[84px] sm:px-6">
      {q.isLoading ? <div className="space-y-3"><div className="h-20 w-20 animate-pulse rounded-full bg-secondary" /><div className="h-6 w-48 animate-pulse rounded bg-secondary" /></div>
        : q.isError ? <div className="py-24 text-center"><p className="text-4xl">{isGone(q.error) ? "This profile isn’t available." : "Profile didn’t load."}</p>{!isGone(q.error) && <button onClick={() => void q.refetch()} className="mt-5 rounded-md bg-foreground px-5 py-3 text-sm font-semibold text-primary-foreground">Try again</button>}<Link href="/feed" className="mt-4 block text-sm text-muted-foreground underline">Back to Watch</Link></div>
        : profile && <>
          <section className="flex items-start gap-4 sm:gap-6">
            <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-3xl font-bold text-primary-foreground sm:h-24 sm:w-24">{profile.displayName.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 pt-1">
              <h1 className="truncate text-3xl leading-tight sm:text-5xl" data-testid="text-profile-name">{profile.displayName}</h1>
              <p className="text-sm font-semibold text-accent-foreground">@{profile.handle}</p>
              <div className="mt-2"><FollowButton profileId={profile.id} uid={user?.id ?? "anon"} /></div>
              {profile.bio && <p className="mt-2 max-w-lg whitespace-pre-wrap text-sm leading-6 text-foreground/80">{profile.bio}</p>}
            </div>
          </section>
          <p className="mt-6 border-b border-border pb-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">Named posts</p>
          {posts.length === 0 ? <p className="py-16 text-center text-sm text-muted-foreground">No named public posts yet.</p>
            : <div className="mt-3 grid grid-cols-2 gap-1.5 md:grid-cols-3 md:gap-2 lg:grid-cols-4" data-testid="grid-profile">{posts.map((p) => <ProfileCell key={p.id} post={p} onOpen={() => setOpen(p.id)} onGone={() => drop(p.id)} />)}</div>}
          {q.hasNextPage && <div className="mt-6 text-center"><button onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="rounded-md border border-border bg-secondary px-5 py-3 text-sm font-semibold text-foreground/80" data-testid="button-profile-more">{q.isFetchingNextPage ? "Loading…" : "Load more"}</button></div>}
        </>}
    </main>
    {openPost && <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Post viewer"><SocialTile post={openPost} active prefetch={false} behaviorEnabled={settings.data?.behaviorEnabled ?? false} onGone={drop} onClose={() => setOpen(null)} /></div>}
  </div>;
}
