import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { Heart, Play } from "lucide-react";
import { DOUBLE_TAP_MS, HOLD_MS, horizontalSwipeDirection, isDoubleTap, isVerticalSwipe, seekPosition } from "../lib/watch-gestures";
function timeLabel(value: number) {
  const seconds = Math.max(0, Math.floor(value || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function spokenTimeLabel(value: number) {
  // Use the same whole-second position as the visible seek preview.
  const [minutes, seconds] = timeLabel(value).split(":").map(Number);
  return `${minutes ? `${minutes} minute${minutes === 1 ? "" : "s"} ` : ""}${seconds} second${seconds === 1 ? "" : "s"}`;
}
type Gesture = {
  id: number; x: number; y: number; moved: boolean;
  seeking: boolean; resume: boolean; start: number; target: number; width: number;
  video: HTMLVideoElement | null;
  revealOnly: boolean;
};

/** Own horizontal gestures without preventing the browser's vertical scroll. */
export function WatchGestureLayer({ videoRef, onLike, isVideo, inDialog = false, controlsVisible = true, onRevealControls, onHorizontalSwipe, onManualPause, playVideo }: {
  /** Image galleries only: called with +1 (next) or -1 (previous) for a deliberate sideways swipe. */
  onHorizontalSwipe?: (direction: 1 | -1) => void;
  inDialog?: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onLike: () => void;
  isVideo: boolean;
  controlsVisible?: boolean;
  onRevealControls?: () => void;
  onManualPause?: () => void;
  playVideo?: (video: HTMLVideoElement) => Promise<void>;
}) {
  const gesture = useRef<Gesture | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekAnnouncementTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ x: number; y: number; at: number } | null>(null);
  const [seeking, setSeeking] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [seekAnnouncement, setSeekAnnouncement] = useState("");
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [heart, setHeart] = useState(false);
  const clearHold = () => { if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = null; };
  const clearTap = () => { if (tapTimer.current) clearTimeout(tapTimer.current); tapTimer.current = null; };
  const clearSeekAnnouncement = () => {
    if (seekAnnouncementTimer.current) clearTimeout(seekAnnouncementTimer.current);
    seekAnnouncementTimer.current = null;
  };
  const play = () => {
    const video = videoRef.current;
    if (video) void (playVideo ? playVideo(video) : video.play()).catch(() => setPaused(true));
  };
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) play();
    else {
      onManualPause?.();
      video.pause();
    }
  };
  const like = () => {
    onLike();
    setHeart(true);
    if (heartTimer.current) clearTimeout(heartTimer.current);
    heartTimer.current = setTimeout(() => setHeart(false), 650);
  };
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setPosition(video.currentTime || 0);
      setPaused(video.paused);
      setReady(video.readyState >= 2);
    };
    const events = ["play", "pause", "ended", "loadeddata", "durationchange", "timeupdate"];
    events.forEach((event) => video.addEventListener(event, sync));
    sync();
    return () => events.forEach((event) => video.removeEventListener(event, sync));
  }, [videoRef, isVideo]);
  useEffect(() => () => {
    clearHold();
    clearTap();
    clearSeekAnnouncement();
    if (heartTimer.current) clearTimeout(heartTimer.current);
    // Do not resume on unmount: a swipe has made this item inactive.
  }, []);

  function down(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    clearHold();
    clearTap();
    const video = videoRef.current;
    const current: Gesture = {
      id: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
      seeking: false, resume: false, start: video?.currentTime ?? 0,
      target: video?.currentTime ?? 0, width: event.currentTarget.clientWidth, video,
      revealOnly: !controlsVisible,
    };
    gesture.current = current;
    const inSeekZone = (event.target as HTMLElement).closest("[data-watch-seek-zone]");
    if (!inSeekZone || !video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    const surface = event.currentTarget;
    holdTimer.current = setTimeout(() => {
      if (gesture.current !== current || current.moved || videoRef.current !== video) return;
      current.seeking = true;
      current.resume = !video.paused;
      current.start = current.target = video.currentTime;
      lastTap.current = null;
      if (current.resume) onManualPause?.();
      video.pause();
      setSeeking(current.target);
      try { surface.setPointerCapture(current.id); } catch { /* Pointer already cancelled by native scrolling. */ }
    }, HOLD_MS);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.seeking) {
      if (Math.hypot(dx, dy) > 10) {
        current.moved = true;
        clearHold();
        lastTap.current = null;
      }
      return;
    }
    // A primarily vertical motion still belongs to the feed, even after a hold.
    if (isVerticalSwipe(dx, dy)) {
      finish(event, true);
      return;
    }
    current.target = seekPosition(current.start, dx, current.width, videoRef.current?.duration ?? 0);
    setSeeking(current.target);
  }
  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    clearHold();
    if (event.currentTarget.hasPointerCapture(current.id)) event.currentTarget.releasePointerCapture(current.id);
    if (videoRef.current !== current.video) {
      lastTap.current = null;
      setSeeking(null);
      return;
    }
    if (current.seeking) {
      const video = current.video;
      const stillActive = video !== null && videoRef.current === video;
      if (stillActive && !cancelled) {
        video.currentTime = current.target;
        setPosition(current.target);
      }
      setSeeking(null);
      if (stillActive && !cancelled && current.resume) play();
      return;
    }
    if (!cancelled && current.moved && onHorizontalSwipe && !isVideo) {
      const direction = horizontalSwipeDirection(event.clientX - current.x, event.clientY - current.y);
      lastTap.current = null;
      if (direction) onHorizontalSwipe(direction);
      return;
    }
    if (cancelled || current.moved) { lastTap.current = null; return; }
    const now = performance.now();
    const previous = lastTap.current;
    if (isDoubleTap(previous, { at: now, x: event.clientX, y: event.clientY })) {
      lastTap.current = null;
      clearTap();
      like();
    } else {
      lastTap.current = { at: now, x: event.clientX, y: event.clientY };
      tapTimer.current = setTimeout(() => {
        lastTap.current = null;
        if (current.revealOnly) onRevealControls?.(); else togglePlayback();
      }, DOUBLE_TAP_MS);
    }
  }
  return <>
    <div
      className="absolute inset-0 z-[5] select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      style={{ touchAction: "pan-y", WebkitTouchCallout: "none" }}
      role="group" tabIndex={0}
      aria-label={isVideo ? `${controlsVisible ? "Tap to pause or play." : "Tap to show controls."} Double tap to like. Hold near the bottom and drag sideways to seek.` : `${controlsVisible ? "" : "Tap to show controls. "}Double tap to like this ${onHorizontalSwipe ? "post. Swipe sideways or use arrow keys to change image." : "image."}`}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={down} onPointerMove={move}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
      onPointerLeave={(event) => { if (!gesture.current?.seeking) finish(event, true); }}
      onClick={(event) => {
        if (event.detail === 0 && event.target === event.currentTarget) {
          if (!controlsVisible) onRevealControls?.(); else togglePlayback();
        }
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === " " || event.key === "Enter") { event.preventDefault(); togglePlayback(); }
        if (event.key.toLowerCase() === "l") { event.preventDefault(); like(); }
        if (onHorizontalSwipe && !isVideo && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          onHorizontalSwipe(event.key === "ArrowRight" ? 1 : -1);
        }
      }}
      data-testid="watch-gesture-surface"
    >
      {isVideo && <div
        data-watch-seek-zone data-testid="watch-seek-zone"
        className={`absolute inset-x-0 ${inDialog ? "bottom-0 h-20" : "bottom-[calc(84px+env(safe-area-inset-bottom))] h-16"} outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:bottom-0 md:h-20`}
        role="slider" tabIndex={0} aria-label="Video position. Hold and drag horizontally, or use arrow keys."
        aria-valuemin={0} aria-valuemax={duration} aria-valuenow={seeking ?? position}
        aria-valuetext={`${timeLabel(seeking ?? position)} of ${timeLabel(duration)}`}
        onBlur={() => { clearSeekAnnouncement(); setSeekAnnouncement(""); }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const video = videoRef.current;
          if (!video || !duration) return;
          const target = event.key === "Home" ? 0 : event.key === "End" ? duration : video.currentTime + (event.key === "ArrowLeft" ? -5 : 5);
          video.currentTime = seekPosition(target, 0, 1, duration);
          // Publish the accepted position in this key event, not a later media
          // timeupdate, so assistive technology receives the new slider value.
          setPosition(video.currentTime);
          // Some screen-reader/browser pairs speak only a slider percentage.
          // Announce explicit time for keyboard seeks, never on playback ticks.
          clearSeekAnnouncement();
          setSeekAnnouncement("");
          const announcement = `Video position: ${spokenTimeLabel(video.currentTime)} of ${spokenTimeLabel(duration)}.`;
          // Let the native slider value event finish first; coalesce held keys
          // into the latest position rather than queueing every intermediate seek.
          seekAnnouncementTimer.current = setTimeout(() => {
            seekAnnouncementTimer.current = null;
            setSeekAnnouncement(announcement);
          }, 250);
        }}
      />}
    </div>
    {isVideo && <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{seekAnnouncement}</span>}
    {paused && ready && seeking === null && isVideo && <div className="pointer-events-none absolute inset-0 z-[6] grid place-items-center"><Play size={64} fill="currentColor" className="text-foreground/80 drop-shadow-lg" aria-hidden="true" /></div>}
    {heart && <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center" aria-hidden="true"><Heart size={90} fill="currentColor" className="text-primary drop-shadow-lg motion-safe:animate-bounce" /></div>}
    {seeking !== null && <div className={`pointer-events-none absolute inset-x-5 z-30 text-center ${inDialog ? "bottom-24" : "bottom-[calc(152px+env(safe-area-inset-bottom))] md:bottom-24"}`}>
      <span data-testid="watch-seek-preview" className="rounded-md bg-background/75 px-4 py-2 text-sm font-semibold tabular-nums text-foreground">{timeLabel(seeking)} / {timeLabel(duration)}</span>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-foreground/30"><div className="h-full bg-primary" style={{ width: `${duration ? seeking / duration * 100 : 0}%` }} /></div>
    </div>}
  </>;
}
