import { useUser } from "@clerk/react";
import { Link } from "wouter";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getFollowedCreators, getGetFollowedCreatorsQueryKey } from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";

export function FollowedCreators() {
  const { user } = useUser();
  const q = useInfiniteQuery({
    queryKey: [...getGetFollowedCreatorsQueryKey(), user?.id ?? "anon", "infinite"],
    queryFn: ({ pageParam }) => getFollowedCreators(pageParam ? { cursor: pageParam } : undefined),
    initialPageParam: "",
    getNextPageParam: (last) => last.hasMore ? last.nextCursor ?? undefined : undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="following-heading" data-testid="section-followed-creators">
    <p className="font-mono text-xs uppercase tracking-widest text-primary">Following</p>
    <h2 id="following-heading" className="mt-1 text-xl font-semibold">Creators you follow</h2>
    <p className="mt-1 text-sm text-muted-foreground">Only named profiles can be followed. Following lets you read reviews on their public named posts you can already view.</p>
    {q.isLoading ? <div className="mt-3 space-y-2">{[0, 1].map((n) => <Skeleton key={n} className="h-10 w-full" />)}</div>
      : q.isError ? <p className="mt-3 text-sm text-destructive" role="alert">Couldn’t load. <Button size="sm" variant="outline" onClick={() => void q.refetch()} data-testid="button-retry-following">Try again</Button></p>
      : items.length === 0 ? <p className="mt-3 text-sm text-muted-foreground" data-testid="empty-following">You aren’t following anyone yet. Follow creators from their profile.</p>
      : <ul className="mt-3 divide-y divide-border">{items.map((p) => <li key={p.id}>
        <Link href={`/profile/${p.id}`} className="flex items-center gap-3 py-2 hover:text-primary" data-testid={`link-followed-${p.id}`}>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{p.displayName.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.displayName}</span><span className="text-xs text-muted-foreground">@{p.handle}</span></span>
        </Link>
      </li>)}</ul>}
    {q.hasNextPage && <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} data-testid="button-more-following">{q.isFetchingNextPage ? "Loading…" : "Load more"}</Button>}
  </section>;
}
