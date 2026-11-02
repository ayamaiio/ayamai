import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMediaViewUrl,
  getGetMediaViewUrlQueryKey,
  useGetSocialPost,
  getGetSocialPostQueryKey,
  useActOnSocialPost,
  useUpdateMedia,
  useRegenerateMediaPreview,
  useGetGalleryAttachmentViewUrl,
  getGetGalleryAttachmentViewUrlQueryKey,
} from "@workspace/api-client-react";
import { clampSlide, gallerySlides } from "@/lib/gallery-post";
import type { MediaAsset } from "@workspace/api-client-react";
import { Link } from "wouter";
import { CommentsSheet } from "@/social/comments-sheet";
import { refreshSocial } from "@/social/social-lib";
import { Bookmark, ChevronLeft, ChevronRight, Globe2, Heart, MessageCircle, Minus, Pencil, Plus, RotateCcw, RefreshCw, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { Dialog, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from "@workspace/ayamai-design-system/components/ui/dialog";
import { WatchGestureLayer } from "@/components/watch-gesture-layer";
import { PostEditorDialog } from "@/social/post-editor-dialog";
import { playbackProgressToSave, restorePlaybackProgress } from "@/lib/playback-progress";

type MediaViewerDialogProps = {
  asset: MediaAsset;
  onClose: () => void;
  onToggleFavorite: () => void;
  favoritePending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deletePending: boolean;
};

const railButton =
  "grid h-12 w-12 place-items-center rounded-full border border-input bg-background/45 text-foreground backdrop-blur-md transition hover:scale-105 hover:bg-background/65 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100";

export function MediaViewerDialog({ asset, onClose, onToggleFavorite, favoritePending, onEdit, onDelete, deletePending }: MediaViewerDialogProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [muted, setMuted] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [previewNotice, setPreviewNotice] = useState("");
  const regeneratePreview = useRegenerateMediaPreview();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedProgress = useRef(asset.progressSeconds ?? 0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const client = useQueryClient();
  const updateMedia = useUpdateMedia();

  const { data: view, isLoading, isError, refetch: refetchView } = useGetMediaViewUrl(asset.id, {
    query: { enabled: true, queryKey: getGetMediaViewUrlQueryKey(asset.id), staleTime: 120_000 },
  });
  const [commentsOpen, setCommentsOpen] = useState(false);
  const reactionQuery = useGetSocialPost(asset.id, {
    query: { queryKey: getGetSocialPostQueryKey(asset.id), staleTime: 0, refetchOnMount: "always", refetchInterval: 15_000 },
  });
  const setReaction = useActOnSocialPost({
    mutation: {
      onMutate: async () => {
        // A pre-mutation refresh must not overwrite the confirmed saved result.
        await client.cancelQueries({ queryKey: getGetSocialPostQueryKey(asset.id) });
      },
    },
  });
  const reaction = reactionQuery.data;
  const liked = reaction?.reaction === "like";
  const reactionReady = Boolean(reaction) && !setReaction.isPending;
  // Gallery: all slides belong to this one post; likes/comments stay on asset.id.
  const slides = reaction ? gallerySlides(reaction) : [];
  const isGallery = slides.length > 1;
  const [slideRaw, setSlideRaw] = useState(0);
  const slide = isGallery ? clampSlide(slideRaw, slides.length) : 0;
  const attachment = slide > 0 ? slides[slide] : undefined;
  const attachmentKey = getGetGalleryAttachmentViewUrlQueryKey(asset.id, attachment?.id ?? "");
  const attachmentView = useGetGalleryAttachmentViewUrl(asset.id, attachment?.id ?? "", {
    query: { enabled: Boolean(attachment), queryKey: attachmentKey, staleTime: 4 * 60_000 },
  });
  const attachmentRetried = useRef(false);
  const goSlide = (next: number) => {
    if (!isGallery) return;
    setSlideRaw(clampSlide(next, slides.length));
    setZoom(1); setPan({ x: 0, y: 0 });
    attachmentRetried.current = false;
  };
  const refreshAttachment = () => { client.removeQueries({ queryKey: attachmentKey }); void attachmentView.refetch(); };
  const onAttachmentError = () => { if (!attachmentRetried.current) { attachmentRetried.current = true; refreshAttachment(); } };
  const author = reaction?.attribution === "profile" && reaction.profile ? reaction.profile : null;

  useEffect(() => {
    lastSavedProgress.current = asset.progressSeconds ?? 0;
  }, [asset.id, asset.progressSeconds]);

  function saveProgress(force = false, video = videoRef.current) {
    if (!video) return;
    const next = playbackProgressToSave(video.currentTime, lastSavedProgress.current, force);
    if (next === null) return;
    lastSavedProgress.current = next;
    updateMedia.mutate(
      { id: asset.id, data: { progressSeconds: next } },
      {
        onSuccess: (updated) => {
          client.setQueriesData({ queryKey: ["/api/media"] }, (cached: unknown) => {
            if (!cached || typeof cached !== "object" || !("pages" in cached)) return cached;
            const result = cached as { pages: Array<{ items: MediaAsset[]; [key: string]: unknown }>; [key: string]: unknown };
            return {
              ...result,
              pages: result.pages.map((page) => ({
                ...page,
                items: page.items.map((item) => item.id === updated.id
                  ? { ...item, progressSeconds: updated.progressSeconds }
                  : item),
              })),
            };
          });
        },
      },
    );
  }

  function restoreProgress(video: HTMLVideoElement) {
    if (restorePlaybackProgress(video, asset.progressSeconds)) {
      lastSavedProgress.current = video.currentTime;
    }
  }

  // Restore saved progress after metadata loads, autoplay muted, and save progress as playback advances.
  useEffect(() => {
    const video = videoRef.current;
    if (asset.mediaType !== "video" || !view?.url || !video) return;
    video.muted = true;
    setMuted(true);
    if (video.readyState >= 1) restoreProgress(video);
    void video.play().catch(() => undefined);
    return () => {
      saveProgress(true, video);
      video.pause();
    };
  }, [asset.id, asset.mediaType, view?.url]);

  function writeReaction(next: "like" | null) {
    if (!reactionReady) return;
    setReaction.mutate({ id: asset.id, data: { action: next ?? "clear-reaction" } }, {
      onSuccess: (response) => {
        if (response.post) client.setQueryData(getGetSocialPostQueryKey(asset.id), response.post);
        void refreshSocial(client);
      },
    });
  }
  const likeFromGesture = () => { if (!liked) writeReaction("like"); };
  const toggleLike = () => writeReaction(liked ? null : "like");

  function setZoomLevel(next: number) {
    const clamped = Math.max(1, Math.min(4, Math.round(next * 100) / 100));
    setZoom(clamped);
    if (clamped === 1) setPan({ x: 0, y: 0 });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (zoom <= 1 || event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !viewport) return;
    const maxX = (viewport.clientWidth * (zoom - 1)) / 2;
    const maxY = (viewport.clientHeight * (zoom - 1)) / 2;
    setPan({
      x: Math.max(-maxX, Math.min(maxX, drag.panX + event.clientX - drag.startX)),
      y: Math.max(-maxY, Math.min(maxY, drag.panY + event.clientY - drag.startY)),
    });
  }
  function endPointerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) { dragRef.current = null; setDragging(false); }
  }
  function toggleMuted() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }
  function closeViewer() {
    saveProgress(true);
    videoRef.current?.pause();
    onClose();
  }

  const mediaStyle = { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center" };
  const mediaClass = `h-full w-full select-none object-contain ${dragging ? "transition-none" : "transition-transform duration-150"}`;
  const label = asset.title || asset.originalName;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) closeViewer(); }}>
      <DialogPortal>
        <DialogOverlay className="bg-background" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 h-[100dvh] w-screen overflow-hidden bg-background text-foreground outline-none"
          data-testid="dialog-media-viewer"
        >
          <DialogTitle className="sr-only">{label}</DialogTitle>
          <DialogDescription className="sr-only">
            Full screen viewer. Tap to play or pause, double tap to like, hold near the bottom and drag to seek. Use the zoom controls to magnify.
          </DialogDescription>

          <div
            ref={viewportRef}
            className={`absolute inset-0 grid place-items-center overflow-hidden ${zoom > 1 ? "touch-none cursor-grab" : ""} ${dragging ? "cursor-grabbing" : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endPointerDrag}
            onPointerCancel={endPointerDrag}
            data-testid="viewer-media-viewport"
          >
            {isLoading ? (
              <div className="absolute inset-0 animate-pulse bg-card" role="status" aria-label="Loading media" data-testid="status-viewer-loading" />
            ) : isError || !view?.url ? (
              <div className="max-w-sm px-6 text-center" role="alert" data-testid="status-viewer-media">
                <p className="text-sm text-foreground/80">This file couldn’t load.</p>
                <button type="button" onClick={() => void refetchView()} className="mt-4 rounded-md bg-foreground px-5 py-2.5 text-sm font-semibold text-primary-foreground" data-testid="button-retry-viewer-media">Try again</button>
              </div>
            ) : asset.mediaType === "video" ? (
              <video
                ref={videoRef}
                src={view.url}
                className={`pointer-events-none ${mediaClass}`}
                style={mediaStyle}
                controls={false}
                disablePictureInPicture
                disableRemotePlayback
                playsInline
                autoPlay
                loop
                muted={muted}
                onLoadedMetadata={() => {
                  if (videoRef.current) restoreProgress(videoRef.current);
                }}
                preload="auto"
                onTimeUpdate={() => saveProgress()}
                onVolumeChange={() => setMuted(videoRef.current?.muted ?? true)}
                aria-label={label}
                data-testid={`video-viewer-${asset.id}`}
              />
            ) : attachment ? (
              attachmentView.isError ? <div className="max-w-sm px-6 text-center" role="alert"><p className="text-sm text-foreground/80">This image couldn’t load.</p><button type="button" onClick={() => { attachmentRetried.current = false; refreshAttachment(); }} className="mt-4 rounded-md bg-foreground px-5 py-2.5 text-sm font-semibold text-primary-foreground" data-testid="button-retry-viewer-slide">Try again</button></div>
              : attachmentView.data?.url ? <img key={attachment.id} src={attachmentView.data.url} alt={`${label}, image ${slide + 1} of ${slides.length}`} draggable={false} onError={onAttachmentError} className={mediaClass} style={mediaStyle} data-testid={`img-viewer-slide-${attachment.id}`} />
              : <div className="absolute inset-0 animate-pulse bg-card" role="status" aria-label="Loading image" />
            ) : (
              <img src={view.url} alt={isGallery ? `${label}, image 1 of ${slides.length}` : label} draggable={false} className={mediaClass} style={mediaStyle} data-testid={`img-viewer-${asset.id}`} />
            )}
            {zoom === 1 && view?.url && !isError && (
              <WatchGestureLayer videoRef={videoRef} isVideo={asset.mediaType === "video"} onLike={likeFromGesture} inDialog onHorizontalSwipe={isGallery ? (d) => goSlide(slide + d) : undefined} />
            )}
          </div>

          {isGallery && <>
            <span className="pointer-events-none absolute left-1/2 top-[calc(72px+env(safe-area-inset-top))] z-30 -translate-x-1/2 rounded-md bg-background/60 px-2 py-0.5 font-mono text-[11px] tabular-nums text-foreground backdrop-blur-md" aria-live="polite" data-testid="text-viewer-gallery-position">{slide + 1} / {slides.length}</span>
            <button type="button" onClick={() => goSlide(slide - 1)} disabled={slide === 0} aria-label="Previous image" className={`absolute left-3 top-1/2 z-30 -translate-y-1/2 ${railButton}`} data-testid="button-viewer-prev"><ChevronLeft size={20} /></button>
            <button type="button" onClick={() => goSlide(slide + 1)} disabled={slide === slides.length - 1} aria-label="Next image" className={`absolute right-20 top-1/2 z-30 -translate-y-1/2 md:right-24 ${railButton}`} data-testid="button-viewer-next"><ChevronRight size={20} /></button>
          </>}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-28 bg-gradient-to-b from-background/60 to-transparent" />
          <div className="absolute left-3 right-3 top-[calc(12px+env(safe-area-inset-top))] z-30 flex items-center justify-between gap-2">
            <div className="flex items-center rounded-full border border-border bg-background/45 p-1 backdrop-blur-md" aria-label="Zoom controls">
              <button type="button" onClick={() => setZoomLevel(zoom - 0.5)} disabled={zoom <= 1} className="grid h-9 w-9 place-items-center rounded-full text-foreground/80 hover:bg-accent disabled:opacity-35" aria-label="Zoom out" data-testid="button-zoom-out"><Minus size={16} /></button>
              <button type="button" onClick={() => setZoomLevel(1)} className="min-w-[52px] rounded-md px-2 py-2 text-xs font-semibold tabular-nums text-foreground/80" aria-label="Reset zoom" data-testid="button-reset-zoom">{Math.round(zoom * 100)}%</button>
              <button type="button" onClick={() => setZoomLevel(zoom + 0.5)} disabled={zoom >= 4} className="grid h-9 w-9 place-items-center rounded-full text-foreground/80 hover:bg-accent disabled:opacity-35" aria-label="Zoom in" data-testid="button-zoom-in"><Plus size={16} /></button>
              {zoom > 1 && <button type="button" onClick={() => setZoomLevel(1)} className="ml-1 inline-flex h-9 items-center gap-1 rounded-md px-3 text-xs font-semibold text-foreground/80 hover:bg-accent" aria-label="Fit media to screen" data-testid="button-fit-media"><RotateCcw size={13} /> Fit</button>}
            </div>
            <DialogPrimitive.Close asChild>
              <button type="button" className="grid h-11 w-11 place-items-center rounded-full border border-border bg-background/45 text-foreground backdrop-blur-md hover:bg-background/65" aria-label="Close viewer" data-testid="button-close-media-viewer"><X size={19} /></button>
            </DialogPrimitive.Close>
          </div>

          <div className="absolute bottom-[calc(104px+env(safe-area-inset-bottom))] right-3 z-30 flex flex-col items-center gap-3 md:right-6">
            {reactionQuery.isError ? (
              <button type="button" onClick={() => void reactionQuery.refetch()} className="rounded-md border border-primary/50 bg-background/65 px-3 py-2 text-[11px] font-semibold text-warning backdrop-blur-md" role="alert" data-testid="button-retry-reaction">Like unavailable. Retry</button>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <button type="button" onClick={toggleLike} disabled={!reactionReady} aria-pressed={liked} aria-label={liked ? "Remove like" : "Like"} className={`${railButton} ${liked ? "!border-primary !bg-primary text-primary-foreground" : ""}`} data-testid="button-viewer-like"><Heart size={20} fill={liked ? "currentColor" : "none"} /></button>
                <span className="min-h-4 text-xs font-semibold tabular-nums text-foreground drop-shadow" data-testid="text-viewer-like-count">{reaction ? reaction.likeCount : reactionQuery.isLoading ? <span className="inline-block h-3 w-4 animate-pulse rounded bg-foreground/30" /> : null}</span>
              </div>
            )}
            {reaction && (
              <div className="flex flex-col items-center gap-1">
                <button type="button" onClick={() => { videoRef.current?.pause(); setCommentsOpen(true); }} aria-label="Comments" className={railButton} data-testid="button-viewer-comments"><MessageCircle size={19} /></button>
                <span className="text-xs font-semibold tabular-nums text-foreground drop-shadow" data-testid="text-viewer-comment-count">{reaction.commentCount}</span>
              </div>
            )}
            {asset.mediaType === "video" && view?.url && (
              <button type="button" onClick={toggleMuted} aria-pressed={!muted} aria-label={muted ? "Turn sound on" : "Mute video"} className={railButton} data-testid="button-toggle-viewer-mute">{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
            )}
            <button type="button" onClick={onToggleFavorite} disabled={favoritePending} aria-pressed={asset.isFavorite} aria-label={asset.isFavorite ? "Remove from Saved" : "Save"} className={railButton} data-testid="button-viewer-favorite"><Bookmark size={19} fill={asset.isFavorite ? "currentColor" : "none"} /></button>
            <button type="button" onClick={() => { videoRef.current?.pause(); setSharing(true); }} aria-label="Sharing and publish" className={railButton} data-testid="button-viewer-share"><Globe2 size={18} /></button>
            <button type="button" onClick={onEdit} aria-label="Edit details" className={railButton} data-testid="button-viewer-edit"><Pencil size={17} /></button>
            <button type="button" disabled={regeneratePreview.isPending} aria-label="Rebuild library preview" title="Rebuild library preview" className={railButton} data-testid="button-rebuild-preview"
              onClick={() => regeneratePreview.mutate({ id: asset.id }, {
                onSuccess: () => {
                  setPreviewNotice("Library preview queued for rebuilding. The original is unchanged.");
                  void client.invalidateQueries({ queryKey: ["library-preview"] });
                },
                onError: () => setPreviewNotice("Preview could not be queued. Please try again shortly."),
              })}><RefreshCw size={17} /></button>
            <button type="button" onClick={onDelete} disabled={deletePending} aria-label="Delete media" className={railButton} data-testid="button-viewer-delete"><Trash2 size={17} /></button>
          </div>
          {setReaction.isError && <p className="absolute right-3 top-20 z-30 rounded-lg bg-background/75 px-3 py-2 text-xs text-warning md:right-6" role="alert" data-testid="status-reaction-error">Couldn’t save that like. Try again.</p>}
          {reaction && zoom === 1 && (reaction.description || reaction.tags.length > 0 || reaction.visibility === "public") && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-background/80 via-background/25 to-transparent px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pr-20 pt-28 md:px-10" data-testid="viewer-post-meta">
              <div className="pointer-events-auto flex items-center gap-2 text-sm">
                {reaction.visibility === "public"
                  ? (author ? <Link href={`/profile/${author.id}`} className="font-bold hover:underline" data-testid="link-viewer-author">@{author.handle}</Link> : <span className="font-bold text-foreground/80">Anonymous</span>)
                  : <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Private</span>}
              </div>
              {reaction.description && <p className="mt-1.5 line-clamp-3 max-w-xl whitespace-pre-wrap text-sm leading-5 text-foreground">{reaction.description}</p>}
              {reaction.tags.length > 0 && <p className="mt-1 max-w-xl truncate text-xs font-semibold text-warning">{reaction.tags.map((t) => `#${t}`).join(" ")}</p>}
            </div>
          )}
          {commentsOpen && reaction && <CommentsSheet postId={asset.id} count={reaction.commentCount} onClose={() => setCommentsOpen(false)} onGone={() => setCommentsOpen(false)}
            onCountChange={(d) => { client.setQueryData(getGetSocialPostQueryKey(asset.id), (old: typeof reaction | undefined) => old ? { ...old, commentCount: Math.max(0, old.commentCount + d) } : old); void refreshSocial(client); }} />}
          {sharing && <PostEditorDialog mediaId={asset.id} onClose={() => setSharing(false)} />}
          <span className="sr-only" aria-live="polite" data-testid="status-viewer-zoom">Zoom {Math.round(zoom * 100)} percent</span>
          {previewNotice && <p role="status" className="pointer-events-none absolute left-4 top-20 max-w-[70%] rounded-lg bg-background/80 px-3 py-2 text-xs text-foreground">{previewNotice}</p>}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
