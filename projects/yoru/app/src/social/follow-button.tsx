import { trackEvent } from "@/lib/analytics";
import { useQueryClient } from "@tanstack/react-query";
import { UserCheck, UserPlus } from "lucide-react";
import { getGetCreatorFollowQueryKey, useGetCreatorFollow, useSetCreatorFollow } from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";

const fmt = (n: number) => `${n} follower${n === 1 ? "" : "s"}`;

/** Follow/unfollow a named profile with its follower count. Never offered on your own profile. */
export function FollowButton({ profileId, uid, compact = false }: { profileId: string; uid: string; compact?: boolean }) {
  const client = useQueryClient();
  const key = [...getGetCreatorFollowQueryKey(profileId), uid];
  const follow = useGetCreatorFollow(profileId, { query: { queryKey: key, staleTime: 30_000 } });
  const set = useSetCreatorFollow();
  if (follow.isLoading) return <Skeleton className="h-9 w-28" />;
  if (follow.isError || !follow.data) return <Button variant="outline" size="sm" onClick={() => void follow.refetch()} data-testid="button-retry-follow">Retry follow status</Button>;
  const data = follow.data;
  const toggle = () => set.mutate({ id: profileId, data: { following: !data.following } }, {
    onSuccess: (next) => {
      trackEvent("creator_follow_changed", { following: next.following });
      client.setQueryData(key, next);
      void client.invalidateQueries({ queryKey: ["/api/social/following"] });
      void client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes("/reviews") });
    },
  });
  return <div className="flex flex-wrap items-center gap-2">
    {!data.isOwnProfile && <Button variant={data.following ? "secondary" : "default"} size={compact ? "sm" : "default"} onClick={toggle} disabled={set.isPending} aria-pressed={data.following} data-testid="button-follow-creator">
      {data.following ? <UserCheck size={15} /> : <UserPlus size={15} />}{set.isPending ? "Saving…" : data.following ? "Following" : "Follow"}
    </Button>}
    <span className="text-xs text-muted-foreground" data-testid="text-follower-count">{fmt(data.followerCount)}</span>
    {set.isError && <span className="text-xs text-destructive" role="alert">Couldn’t update. Try again.</span>}
  </div>;
}
