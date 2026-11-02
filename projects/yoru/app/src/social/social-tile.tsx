import { useEffect, useRef, useState } from "react";
import { trackPostAction } from "@/lib/analytics";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Bookmark, Lock, Tag, Flag, Heart, Loader2, MessageCircle, MoreHorizontal, RotateCw, ThumbsDown, Volume2, VolumeX, X } from "lucide-react";
import { getGetMediaViewUrlQueryKey, getGetSocialPostQueryKey, useActOnSocialPost, useGetMediaViewUrl } from "@workspace/api-client-react";
import type { PostActionInput, SocialPost } from "@workspace/api-client-react";
import { WatchGestureLayer } from "@/components/watch-gesture-layer";
import { useWatchChrome, watchChromeAttributes, watchChromeClass } from "@/lib/use-watch-chrome";
import { useWatchPlaybackLifecycle } from "@/lib/use-watch-playback-lifecycle";
import { CommentsSheet } from "./comments-sheet";
import { GalleryStage } from "./gallery-stage";
import { clampSlide, gallerySlides } from "@/lib/gallery-post";
import { DeletePostButton } from "./delete-post-button";
import { PrivateLabelSheet, usePrivateAnnotation } from "./private-label-sheet";
import { useSocialTelemetry } from "./use-social-telemetry";
import { errorText, forgetPost, isGone, refreshSocial, timeAgo } from "./social-lib";

const rail = "[&>svg]:size-5 grid h-12 w-12 place-items-center rounded-full border border-input bg-background/35 text-foreground backdrop-blur-md transition hover:scale-105 disabled:opacity-50";
const fmt = (n: number) => n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export function SocialTile({ post: initial, active, prefetch, autoplay = true, dataSaver = false, behaviorEnabled, onGone, onClose, uid = "anon", onHashtag, onLabelSheetChange, savedOnly = false, controlsVisible, onRevealControls, onControlsPinnedChange }: {
  post: SocialPost; active: boolean; prefetch: boolean; behaviorEnabled: boolean;
  autoplay?: boolean;
  dataSaver?: boolean;
  onGone: (id: string) => void; onClose?: () => void;
  savedOnly?: boolean;
  controlsVisible?: boolean; onRevealControls?: () => void; onControlsPinnedChange?: (pinned: boolean) => void;
  uid?: string; onHashtag?: (tag: string) => void; onLabelSheetChange?: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const [post, setPost] = useState(initial);
  useEffect(() => setPost(initial), [initial]);
  const id = post.id;
  const isVideo = post.mediaType === "video";
  const slides = gallerySlides(post);
  const isGallery = slides.length > 1;
  const [slide, setSlide] = useState(0);
  const slideIndex = isGallery ? clampSlide(slide, slides.length) : 0;
  useEffect(() => { setSlide(0); }, [id]);
  const view = useGetMediaViewUrl(id, { query: { enabled: active || (prefetch && !dataSaver), queryKey: getGetMediaViewUrlQueryKey(id), staleTime: 60_000, retry: (n, err) => !isGone(err) && n < 2 } });
  const act = useActOnSocialPost();
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackLifecycle = useWatchPlaybackLifecycle({ videoRef, active, autoplay, dataSaver });
  const [muted, setMuted] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [paused, setPaused] = useState(isVideo);
  const [mediaFailed, setMediaFailed] = useState(false);
  const urlRetried = useRef(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const labels = usePrivateAnnotation(id, uid, active || labelsOpen);
  const myTags = labels.data?.tags ?? [];
  const sheetCb = useRef(onLabelSheetChange);
  sheetCb.current = onLabelSheetChange;
  useEffect(() => { sheetCb.current?.(labelsOpen); }, [labelsOpen]);
  useEffect(() => () => { if (labelsOpen) sheetCb.current?.(false); }, [labelsOpen]);
  const stopGesture = (e: React.SyntheticEvent) => e.stopPropagation();
  const [menu, setMenu] = useState<null | "menu" | "report" | "block">(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");
  const telemetry = useSocialTelemetry({ postId: id, active, enabled: behaviorEnabled, isVideo, videoRef, fallbackDuration: post.durationSeconds });

  const gone = () => { forgetPost(client, id); onGone(id); };
  const goneRef = useRef(gone);
  goneRef.current = gone;
  const viewGone = view.isError && isGone(view.error);
  useEffect(() => { if (viewGone) goneRef.current(); }, [viewGone]);

  useEffect(() => {
    const video = videoRef.current;
    if (!active || !isVideo || !view.data?.url || !video) return;
    video.muted = muted;
    if (document.hidden) video.pause();
    else if (autoplay && !dataSaver) void playbackLifecycle.play(video).catch(() => undefined);
    else video.pause();
    return () => { video.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isVideo, autoplay, dataSaver, view.data?.url]);

  function run(data: PostActionInput, after?: () => void) {
    setActionError("");
    act.mutate({ id, data }, {
      onSuccess: (res) => {
        trackPostAction(data.action, "scroll");
        if (!res.post) { gone(); void refreshSocial(client); return; }
        setPost(res.post);
        client.setQueryData(getGetSocialPostQueryKey(id), res.post);
        void client.invalidateQueries({ queryKey: ["/api/social/feed"], refetchType: "none" });
        void client.invalidateQueries({ queryKey: ["/api/social/saved"] });
        if (data.action === "save" || data.action === "unsave") {
          void client.invalidateQueries({ queryKey: ["/api/media"] });
          if (savedOnly && !res.post.isSaved) onGone(id);
        }
        after?.();
      },
      onError: (err) => { if (isGone(err)) gone(); else setActionError(errorText(err, "That didn’t save. Try again.")); },
    });
  }
  const like = () => run({ action: post.reaction === "like" ? "clear-reaction" : "like" });
  const likeFromGesture = () => { if (post.reaction !== "like" && !act.isPending) run({ action: "like" }); };
  const dislike = () => run({ action: post.reaction === "dislike" ? "clear-reaction" : "dislike" });
  const save = () => run({ action: post.isSaved ? "unsave" : "save" });
  const report = () => run({ action: "report", reason: reason.trim() }, () => { setMenu(null); setReason(""); setActionError("Reported. A moderator will review it."); });
  const block = () => run({ action: "block" });

  const onVideoError = () => {
    if (!urlRetried.current) { urlRetried.current = true; client.removeQueries({ queryKey: getGetMediaViewUrlQueryKey(id) }); void view.refetch(); return; }
    setMediaFailed(true);
  };
  const retryMedia = () => { urlRetried.current = false; setMediaFailed(false); client.removeQueries({ queryKey: getGetMediaViewUrlQueryKey(id) }); void view.refetch(); };
  const url = view.data?.url;
  const author = post.attribution === "profile" && post.profile ? post.profile : null;
  const pinned = labelsOpen || commentsOpen || deleteOpen || menu !== null || (isVideo && paused) || mediaFailed || view.isError;
  const localChrome = useWatchChrome(id, pinned, active && controlsVisible === undefined);
  const visible = controlsVisible ?? localChrome.visible;
  const reveal = onRevealControls ?? localChrome.reveal;
  useEffect(() => {
    if (!active) return;
    onControlsPinnedChange?.(pinned);
    return () => onControlsPinnedChange?.(false);
  }, [active, pinned, onControlsPinnedChange]);

  return <article className="relative grid h-[100dvh] w-full place-items-center overflow-hidden bg-background" data-testid={`social-post-${id}`} {...(controlsVisible === undefined ? localChrome.handlers : {})}>
    {(view.isLoading || (!url && !view.isError)) && <div className="media-placeholder absolute inset-0 animate-pulse" />}
    {(mediaFailed || (view.isError && !viewGone)) && <div className="relative z-20 text-center text-foreground" role="alert"><p className="text-sm text-foreground/80">This post couldn’t load.</p><button onClick={retryMedia} className="mt-4 inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-sm font-semibold text-primary-foreground" data-testid={`button-retry-media-${id}`}><RotateCw size={14} /> Try again</button></div>}
    {active && url && !mediaFailed && isVideo && <video
      ref={videoRef} src={url} className="pointer-events-none absolute inset-0 h-full w-full object-contain"
      controls={false} disablePictureInPicture disableRemotePlayback playsInline loop muted={muted} preload={dataSaver ? "none" : autoplay ? "auto" : "metadata"}
      onVolumeChange={() => setMuted(videoRef.current?.muted ?? true)}
      onWaiting={() => { setBuffering(true); telemetry.onSeek(); }} onPlaying={() => setBuffering(false)} onCanPlay={() => setBuffering(false)}
      onPlay={() => { playbackLifecycle.onVideoPlay(); setPaused(false); }}
      onTimeUpdate={telemetry.onTimeUpdate} onSeeking={telemetry.onSeek} onSeeked={telemetry.onSeek}
      onError={onVideoError}
      onPause={() => { playbackLifecycle.onVideoPause(); setPaused(true); telemetry.onPause(); }}
      data-testid={`video-social-${id}`}
    />}
    {active && url && !mediaFailed && isGallery && <GalleryStage postId={id} slides={slides} index={slideIndex} onIndexChange={setSlide} coverUrl={url} onCoverError={onVideoError} alt={post.description || "Shared image"} controlsVisible={visible} />}
    {active && url && !mediaFailed && !isVideo && !isGallery && <img src={url} alt={post.description || "Shared image"} draggable={false} onError={onVideoError} className="absolute inset-0 h-full w-full select-none object-contain" data-testid={`img-social-${id}`} />}
    {active && url && !mediaFailed && <WatchGestureLayer videoRef={videoRef} isVideo={isVideo} onLike={likeFromGesture} controlsVisible={visible} onRevealControls={reveal} onManualPause={playbackLifecycle.markManualPause} playVideo={playbackLifecycle.play} onHorizontalSwipe={isGallery ? (d) => setSlide((i) => clampSlide(i + d, slides.length)) : undefined} />}
    {active && buffering && <div className="pointer-events-none absolute inset-0 z-[7] grid place-items-center"><Loader2 size={38} className="animate-spin text-foreground/80" aria-label="Buffering" /></div>}

    {onClose && <button onClick={onClose} className="absolute left-3 top-[calc(12px+env(safe-area-inset-top))] z-30 grid h-11 w-11 place-items-center rounded-full border border-border bg-background/45 text-foreground backdrop-blur-md" aria-label="Close" data-testid="button-close-post"><X size={19} /></button>}

    <div {...watchChromeAttributes(visible)} className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background/85 via-background/25 to-transparent px-5 pb-[calc(28px+env(safe-area-inset-bottom))] pr-20 pt-40 text-foreground md:px-12 md:pb-10 ${watchChromeClass(visible)}`}>
      <div className="pointer-events-auto flex items-center gap-2 text-sm">
        {author ? <Link href={`/profile/${author.id}`} className="font-bold hover:underline" data-testid={`link-author-${id}`}>@{author.handle}</Link> : <span className="font-bold text-foreground/80">Anonymous</span>}
        <span className="text-muted-foreground">·</span><span className="text-xs text-muted-foreground">{timeAgo(post.createdAt)}{isVideo ? ` · ${fmt(post.viewCount ?? 0)} views` : ""}</span>
        {post.isOwner && <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Yours</span>}
      </div>
      {post.description && <p className="mt-2 line-clamp-3 max-w-xl whitespace-pre-wrap text-sm leading-5 text-foreground">{post.description}</p>}
      {post.tags.length > 0 && <div className="pointer-events-auto mt-1.5 flex max-w-xl flex-wrap gap-x-2 gap-y-0.5" onPointerDown={stopGesture}>{post.tags.map((t) => onHashtag
        ? <button type="button" key={t} onClick={(e) => { e.stopPropagation(); onHashtag(t); }} className="text-xs font-semibold text-primary hover:underline" data-testid={`button-hashtag-${id}-${t}`}>#{t}</button>
        : <span key={t} className="text-xs font-semibold text-primary">#{t}</span>)}</div>}
      {myTags.length > 0 && <div className="pointer-events-auto mt-1.5 flex max-w-xl flex-wrap items-center gap-1.5" onPointerDown={stopGesture} data-testid={`private-labels-${id}`}>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-accent-foreground/80"><Lock size={10} /> Only you</span>
        {myTags.slice(0, 8).map((t) => onHashtag
          ? <button type="button" key={t} onClick={(e) => { e.stopPropagation(); onHashtag(t); }} className="rounded-md border border-dashed border-accent-foreground/45 px-2 py-0.5 text-[11px] font-semibold text-accent-foreground" data-testid={`button-my-label-${id}-${t}`}>#{t}</button>
          : <span key={t} className="rounded-md border border-dashed border-accent-foreground/45 px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">#{t}</span>)}
        {myTags.length > 8 && <span className="text-[11px] text-muted-foreground">+{myTags.length - 8}</span>}
      </div>}
    </div>

    <div {...watchChromeAttributes(visible)} className={`absolute bottom-[calc(28px+env(safe-area-inset-bottom))] right-3 z-20 flex flex-col items-center gap-3 md:bottom-10 md:right-8 ${watchChromeClass(visible)}`}>
      <div className="flex flex-col items-center gap-1"><button onClick={like} disabled={act.isPending} aria-pressed={post.reaction === "like"} aria-label={post.reaction === "like" ? "Remove like" : "Like"} className={`${rail} ${post.reaction === "like" ? "!border-primary !bg-primary text-primary-foreground" : ""}`} data-testid={`button-like-${id}`}><Heart size={20} fill={post.reaction === "like" ? "currentColor" : "none"} /></button><span className="text-xs font-semibold tabular-nums drop-shadow" data-testid={`text-like-count-${id}`}>{fmt(post.likeCount)}</span></div>
      <div className="flex flex-col items-center gap-1"><button onClick={() => setCommentsOpen(true)} aria-label="Comments" className={rail} data-testid={`button-comments-${id}`}><MessageCircle size={20} /></button><span className="text-xs font-semibold tabular-nums drop-shadow" data-testid={`text-comment-count-${id}`}>{fmt(post.commentCount)}</span></div>
      <button onClick={save} disabled={act.isPending} aria-pressed={post.isSaved} aria-label={post.isSaved ? "Unsave" : "Save"} className={`${rail} ${post.isSaved ? "!bg-foreground text-primary-foreground" : ""}`} data-testid={`button-save-${id}`}><Bookmark size={19} fill={post.isSaved ? "currentColor" : "none"} /></button>
      <button onClick={dislike} disabled={act.isPending} aria-pressed={post.reaction === "dislike"} aria-label={post.reaction === "dislike" ? "Remove not-for-me" : "Not for me"} className={`${rail} ${post.reaction === "dislike" ? "!bg-foreground/80 text-primary-foreground" : ""}`} data-testid={`button-dislike-${id}`}><ThumbsDown size={18} fill={post.reaction === "dislike" ? "currentColor" : "none"} /></button>
      {isVideo && url && <button onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }} aria-pressed={!muted} aria-label={muted ? "Turn sound on" : "Mute"} className={rail} data-testid={`button-toggle-sound-${id}`}>{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>}
      <button type="button" onPointerDown={stopGesture} onClick={(e) => { e.stopPropagation(); setLabelsOpen(true); }} aria-label="Private labels" aria-haspopup="dialog" className={`${rail} ${myTags.length ? "!border-dashed !border-accent-foreground text-accent-foreground" : ""}`} data-testid={`button-labels-${id}`}><Tag size={18} /></button>
      {post.isOwner
        ? <DeletePostButton id={id} uid={uid} isOwner compact className={rail} onOpenChange={setDeleteOpen} onDeleted={() => { telemetry.stop(); videoRef.current?.pause(); onClose?.(); onGone(id); }} />
        : <button onClick={() => setMenu("menu")} aria-label="More options" className={rail} data-testid={`button-more-${id}`}><MoreHorizontal size={19} /></button>}
    </div>
    {actionError && <p className="absolute right-20 top-[calc(76px+env(safe-area-inset-top))] z-30 max-w-[70vw] rounded-lg bg-background/80 px-3 py-2 text-xs text-warning" role="status" onClick={() => setActionError("")}>{actionError}</p>}

    {commentsOpen && <CommentsSheet postId={id} count={post.commentCount} onClose={() => setCommentsOpen(false)} onGone={gone}
      onCountChange={(d) => { setPost((p) => ({ ...p, commentCount: Math.max(0, p.commentCount + d) })); void refreshSocial(client, id); }} />}

    {labelsOpen && <PrivateLabelSheet mediaId={id} uid={uid} onClose={() => setLabelsOpen(false)} />}

    {menu && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-background/55 md:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) setMenu(null); }}>
      <div role="dialog" aria-modal="true" aria-label="Post options" className="sheet-up w-full max-w-md rounded-t-3xl border border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-foreground md:rounded-3xl">
        {menu === "menu" && <div className="space-y-2">
          <button onClick={() => setMenu("report")} className="flex w-full items-center gap-3 rounded-lg bg-secondary px-4 py-4 text-left text-sm font-semibold" data-testid="button-open-report"><Flag size={17} /> Report this post</button>
          <button onClick={() => setMenu("block")} className="flex w-full items-center gap-3 rounded-lg bg-secondary px-4 py-4 text-left text-sm font-semibold text-destructive" data-testid="button-open-block"><Ban size={17} /> Block this poster</button>
          <button onClick={() => setMenu(null)} className="w-full py-3 text-sm text-muted-foreground">Cancel</button>
        </div>}
        {menu === "report" && <div>
          <h3 className="text-lg font-bold">Why are you reporting this?</h3>
          <p className="mt-1 text-xs text-muted-foreground">Moderators see your reason, not who you are.</p>
          <div className="mt-3 flex flex-wrap gap-1.5">{["Possible minor", "Not consensual", "Stolen / no rights", "Illegal content", "Spam"].map((r) => <button key={r} onClick={() => setReason(r)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${reason === r ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground/80"}`}>{r}</button>)}</div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} placeholder="Describe the problem" className="mt-3 w-full resize-none rounded-md border border-border bg-background/30 px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-report-reason" />
          <div className="mt-3 flex gap-2"><button onClick={() => setMenu("menu")} className="flex-1 rounded-full border border-border py-3 text-sm font-semibold">Back</button><button onClick={report} disabled={!reason.trim() || act.isPending} className="flex-1 rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-40" data-testid="button-submit-report">{act.isPending ? "Sending…" : "Send report"}</button></div>
        </div>}
        {menu === "block" && <div>
          <h3 className="text-lg font-bold">Block this poster?</h3>
          <p className="mt-2 text-sm leading-6 text-foreground/80">You won’t see their posts or comments anywhere, including anonymous ones. They won’t be told.</p>
          <div className="mt-4 flex gap-2"><button onClick={() => setMenu("menu")} className="flex-1 rounded-full border border-border py-3 text-sm font-semibold">Cancel</button><button onClick={block} disabled={act.isPending} className="flex-1 rounded-full bg-destructive py-3 text-sm font-bold text-foreground disabled:opacity-40" data-testid="button-confirm-block">{act.isPending ? "Blocking…" : "Block"}</button></div>
        </div>}
      </div>
    </div>}
  </article>;
}
