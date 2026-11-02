import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { getGetGalleryAttachmentViewUrlQueryKey, useGetGalleryAttachmentViewUrl } from "@workspace/api-client-react";
import type { PostAttachment } from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { cn } from "@workspace/ayamai-design-system/lib/utils";
import { watchChromeAttributes, watchChromeClass } from "@/lib/use-watch-chrome";
import { isGone } from "./social-lib";

const imageClass = "absolute inset-0 h-full w-full select-none object-contain transition-opacity duration-200";

/** One later slide (position > 0). Signed URLs expire, so a load error refetches once before showing retry. */
function AttachmentImage({ postId, attachment, shown, alt, label }: { postId: string; attachment: PostAttachment; shown: boolean; alt: string; label: string }) {
  const client = useQueryClient();
  const queryKey = getGetGalleryAttachmentViewUrlQueryKey(postId, attachment.id);
  const view = useGetGalleryAttachmentViewUrl(postId, attachment.id, { query: { enabled: true, queryKey, staleTime: 4 * 60_000, retry: (n, err) => !isGone(err) && n < 2 } });
  const retried = useRef(false);
  const [failed, setFailed] = useState(false);
  const refresh = () => { client.removeQueries({ queryKey }); void view.refetch(); };
  const onError = () => {
    if (!retried.current) { retried.current = true; refresh(); return; }
    setFailed(true);
  };
  const retry = () => { retried.current = false; setFailed(false); refresh(); };
  const url = view.data?.url;
  if (!shown) return url && !failed ? <img src={url} alt="" aria-hidden="true" draggable={false} className={cn(imageClass, "pointer-events-none opacity-0")} /> : null;
  if (failed || view.isError) return <div className="relative z-20 text-center text-foreground" role="alert">
    <p className="text-sm text-foreground/80">This image couldn’t load.</p>
    <Button type="button" onClick={retry} className="mt-4" data-testid={`button-retry-slide-${attachment.id}`}><RotateCw size={14} /> Try again</Button>
  </div>;
  if (!url) return <div className="media-placeholder absolute inset-0 animate-pulse" aria-label="Loading image" />;
  return <img src={url} alt={alt} aria-label={label} draggable={false} onError={onError} className={imageClass} data-testid={`img-slide-${attachment.id}`} />;
}

/**
 * Horizontal image gallery inside one vertical post. Every slide belongs to the
 * parent post; there are no per-image reactions, comments or events.
 */
export function GalleryStage({ postId, slides, index, onIndexChange, coverUrl, onCoverError, alt, controlsVisible }: {
  postId: string;
  slides: PostAttachment[];
  index: number;
  onIndexChange: (index: number) => void;
  coverUrl: string;
  onCoverError: () => void;
  alt: string;
  controlsVisible: boolean;
}) {
  const total = slides.length;
  const label = (i: number) => `Image ${i + 1} of ${total}`;
  const go = (delta: number) => { const next = index + delta; if (next >= 0 && next < total) onIndexChange(next); };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return <>
    {slides.map((slide, i) => {
      const near = Math.abs(i - index) <= 1;
      if (!near) return null;
      if (i === 0) return <img key={slide.id} src={coverUrl} alt={i === index ? alt : ""} aria-hidden={i !== index} aria-label={i === index ? label(0) : undefined} draggable={false} onError={i === index ? onCoverError : undefined} className={cn(imageClass, i !== index && "pointer-events-none opacity-0")} data-testid={i === index ? `img-social-${postId}` : undefined} />;
      return <AttachmentImage key={slide.id} postId={postId} attachment={slide} shown={i === index} alt={alt} label={label(i)} />;
    })}
    <div {...watchChromeAttributes(controlsVisible)} className={cn("pointer-events-none absolute inset-x-0 top-[calc(64px+env(safe-area-inset-top))] z-20 flex flex-col items-center gap-1.5", watchChromeClass(controlsVisible))} data-testid={`gallery-indicator-${postId}`}>
      <span className="rounded-md bg-background/60 px-2 py-0.5 font-mono text-[11px] tabular-nums text-foreground backdrop-blur-md" aria-live="polite" data-testid={`text-gallery-position-${postId}`}>{index + 1} / {total}</span>
      <div className="flex gap-1" aria-hidden="true">{slides.map((s, i) => <span key={s.id} className={cn("h-1 rounded-full transition-all", i === index ? "w-4 bg-foreground" : "w-1 bg-foreground/40")} />)}</div>
    </div>
    <div {...watchChromeAttributes(controlsVisible)} className={cn("pointer-events-none absolute inset-y-0 left-0 right-0 z-20 flex items-center justify-between px-3", watchChromeClass(controlsVisible))}>
      <Button type="button" variant="secondary" size="icon" className="pointer-events-auto rounded-full" onPointerDown={stop} onClick={(e) => { e.stopPropagation(); go(-1); }} disabled={index === 0} aria-label="Previous image" data-testid={`button-gallery-prev-${postId}`}><ChevronLeft size={18} /></Button>
      <Button type="button" variant="secondary" size="icon" className="pointer-events-auto mr-16 rounded-full md:mr-20" onPointerDown={stop} onClick={(e) => { e.stopPropagation(); go(1); }} disabled={index === total - 1} aria-label="Next image" data-testid={`button-gallery-next-${postId}`}><ChevronRight size={18} /></Button>
    </div>
  </>;
}
