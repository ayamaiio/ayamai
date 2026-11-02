import { useEffect, useRef, useState } from "react";
import { trackPostAction } from "@/lib/analytics";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, Heart, Maximize, MessageCircle } from "lucide-react";
import { getGetMediaViewUrlQueryKey, getGetSocialPostQueryKey, getGetWatchSettingsQueryKey, useGetWatchSettings, useActOnSocialPost, useGetMediaViewUrl } from "@workspace/api-client-react";
import type { SocialPost } from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ayamai-design-system/components/ui/select";
import { usePlaybackBookmark } from "@/lib/use-playback-bookmark";
import { CommentsSheet } from "./comments-sheet";
import { DeletePostButton } from "./delete-post-button";
import { FollowButton } from "./follow-button";
import { isGone, refreshSocial, timeAgo } from "./social-lib";
import { useSocialTelemetry } from "./use-social-telemetry";

const SPEEDS = ["0.5", "0.75", "1", "1.25", "1.5", "2"];

export function VideoPlayer({ post, uid, onDeleted }: { post: SocialPost; uid: string; onDeleted?: () => void }) {
  const client = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const view = useGetMediaViewUrl(post.id, { query: { queryKey: [...getGetMediaViewUrlQueryKey(post.id), uid], staleTime: 60_000, retry: (n, err) => !isGone(err) && n < 2 } });
  const act = useActOnSocialPost();
  const [speed, setSpeed] = useState("1");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState(post.commentCount);
  const [actionError, setActionError] = useState("");
  const [playbackError, setPlaybackError] = useState("");
  const deleted = useRef(false);
  const url = view.data?.url;
  const bookmark = usePlaybackBookmark(videoRef, uid, post.id, url, deleted);
  const settings = useGetWatchSettings({ query: { queryKey: [...getGetWatchSettingsQueryKey(), uid] } });
  const telemetry = useSocialTelemetry({
    postId: post.id, active: !!url && settings.data?.behaviorEnabled === true,
    enabled: settings.data?.behaviorEnabled === true, isVideo: true, videoRef, fallbackDuration: post.durationSeconds,
  });
  useEffect(() => setComments(post.commentCount), [post.id, post.commentCount]);

  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = Number(speed); }, [speed, url]);

  const perform = (action: "like" | "clear-reaction" | "save" | "unsave") => act.mutate({ id: post.id, data: { action } }, {
    onSuccess: (res) => {
      trackPostAction(action, "player");
      if (res.post) client.setQueryData([...getGetSocialPostQueryKey(post.id), uid], res.post);
      void refreshSocial(client);
      void client.invalidateQueries({ queryKey: ["/api/social/videos"] });
    },
    onError: () => setActionError("That didn’t save. Try again."),
  });
  const liked = post.reaction === "like";
  const author = post.attribution === "profile" ? post.profile : null;

  return <div className="space-y-3">
    <div className="overflow-hidden rounded-lg bg-muted">
      {url ? <video ref={videoRef} key={`${uid}:${post.id}:${url}`} src={url} controls={!bookmark.loading && !bookmark.error.includes("couldn’t load")} playsInline preload="metadata" className="aspect-video w-full bg-background" data-testid="video-player"
        onTimeUpdate={telemetry.onTimeUpdate} onPause={telemetry.onPause}
        onSeeking={telemetry.onSeek} onSeeked={telemetry.onSeek} onWaiting={telemetry.onSeek} onEnded={telemetry.onPause}
        onLoadedMetadata={() => setPlaybackError("")}
        onError={(event) => {
          const code = event.currentTarget.error?.code;
          setPlaybackError(code === 3 || code === 4
            ? "This browser couldn’t decode this video. Try a browser that supports its format."
            : "The video couldn’t load. Check your connection and try again.");
        }} />
        : view.isError ? <div className="grid aspect-video place-items-center p-6 text-center text-sm text-muted-foreground"><div>{isGone(view.error) ? "This video isn’t available anymore." : "Video didn’t load."}{!isGone(view.error) && <Button variant="outline" size="sm" className="ml-2" onClick={() => void view.refetch()} data-testid="button-retry-video">Try again</Button>}</div></div>
        : <Skeleton className="aspect-video w-full rounded-none" />}
    </div>
    {url && bookmark.loading && <p role="status" className="text-xs text-muted-foreground">Loading your saved position…</p>}
    {bookmark.error && <div role="alert" className="flex items-center gap-2 text-sm text-destructive" data-testid="error-playback-bookmark">
      <span>{bookmark.error}</span><Button variant="outline" size="sm" onClick={bookmark.retry}>Retry position</Button>
    </div>}
    {playbackError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive" data-testid="error-player-playback">
      <span>{playbackError}</span>
      <Button variant="outline" size="sm" disabled={view.isFetching} onClick={async () => {
        const result = await view.refetch();
        if (!result.isError) videoRef.current?.load();
      }} data-testid="button-retry-player-playback">Retry video</Button>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      <Button variant={liked ? "secondary" : "outline"} size="sm" aria-pressed={liked} onClick={() => perform(liked ? "clear-reaction" : "like")} disabled={act.isPending} data-testid="button-player-like"><Heart size={14} fill={liked ? "currentColor" : "none"} /> {post.likeCount}</Button>
      <Button variant={post.isSaved ? "secondary" : "outline"} size="sm" aria-pressed={post.isSaved} onClick={() => perform(post.isSaved ? "unsave" : "save")} disabled={act.isPending} data-testid="button-player-save"><Bookmark size={14} fill={post.isSaved ? "currentColor" : "none"} /> {post.isSaved ? "Saved" : "Save"}</Button>
      <Button variant="outline" size="sm" onClick={() => setCommentsOpen(true)} data-testid="button-player-comments"><MessageCircle size={14} /> {comments}</Button>
      <DeletePostButton id={post.id} uid={uid} isOwner={post.isOwner} onDeleted={() => {
        deleted.current = true; telemetry.stop(); videoRef.current?.pause(); onDeleted?.();
      }} />
      <Button variant="ghost" size="icon" aria-label="Fullscreen" disabled={!url} onClick={() => void videoRef.current?.requestFullscreen?.()} data-testid="button-player-fullscreen"><Maximize size={16} /></Button>
      <Select value={speed} onValueChange={setSpeed}>
        <SelectTrigger className="ml-auto w-24" aria-label="Playback speed" data-testid="select-playback-speed"><SelectValue /></SelectTrigger>
        <SelectContent>{SPEEDS.map((s) => <SelectItem key={s} value={s}>{s}×</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {actionError && <p className="text-xs text-destructive" role="alert">{actionError}</p>}
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {author ? <Link href={`/profile/${author.id}`} className="text-sm font-semibold text-foreground hover:underline" data-testid="link-player-profile">{author.displayName} <span className="text-muted-foreground">@{author.handle}</span></Link>
          : <span className="text-sm text-muted-foreground">{post.isOwner ? "Your upload" : "Anonymous"}</span>}
        {author && <FollowButton profileId={author.id} uid={uid} compact />}
      </div>
      {post.description && <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/80" data-testid="text-player-description">{post.description}</p>}
      <p className="text-xs text-muted-foreground"><span data-testid="text-player-view-count">{(post.viewCount ?? 0).toLocaleString()} views</span> · {timeAgo(post.createdAt)}{post.visibility === "private" ? " · Private" : ""}{post.tags.length ? ` · ${post.tags.map((t) => `#${t}`).join(" ")}` : ""}</p>
    </div>
    {commentsOpen && <CommentsSheet postId={post.id} count={comments} onClose={() => setCommentsOpen(false)} onCountChange={(d) => setComments((c) => c + d)} onGone={() => setCommentsOpen(false)} />}
  </div>;
}
