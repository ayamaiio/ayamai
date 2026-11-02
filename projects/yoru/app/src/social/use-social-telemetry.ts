import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { withVideoViewCount } from "@/lib/video-view-cache";
import { useRecordSocialEvent } from "@workspace/api-client-react";
import type { SocialEventInput } from "@workspace/api-client-react";

type EventName = SocialEventInput["event"];
const FLUSH_EVERY = 10;
const QUICK_SKIP_S = 1.5;

/**
 * Foreground-only behavioral telemetry for one feed impression.
 * Only counts elapsed time while the item is active, the tab is visible, and
 * (for video) the element is actually playing — never paused, seeking, or buffering.
 * Each delivery gets its own UUID; mutation retries resend the same variables, so the id is stable.
 */
export function useSocialTelemetry({ postId, active, enabled, isVideo, videoRef, fallbackDuration }: {
  postId: string;
  active: boolean;
  enabled: boolean;
  isVideo: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  fallbackDuration: number | null;
}) {
  const client = useQueryClient();
  const record = useRecordSocialEvent({ mutation: {
    retry: 3, retryDelay: (n) => Math.min(8000, 1000 * 2 ** n),
    onSuccess: (result, variables) => {
      if (typeof result.viewCount !== "number" || !result.viewCountVisibility) return;
      client.setQueriesData({
        predicate: query => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/social"),
      }, data => withVideoViewCount(data, variables.id, result.viewCount!, result.viewCountVisibility!));
    },
  } });
  const sendRef = useRef(record.mutate);
  sendRef.current = record.mutate;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const stopped = useRef(false);

  const st = useRef({ pending: 0, total: 0, foreground: 0, completed: false, lastPos: 0, replayArmed: false, last: 0, lastWall: 0 });

  const duration = () => {
    const d = videoRef.current?.duration;
    const value = d && Number.isFinite(d) ? d : fallbackDuration ?? undefined;
    return value && value >= 0.1 && value <= 43200 ? value : undefined;
  };
  const send = (event: EventName, watchSeconds: number) => {
    if (!enabledRef.current || stopped.current) return;
    const data: SocialEventInput = { eventId: crypto.randomUUID(), event, watchSeconds: Math.max(0, Math.min(30, Math.round(watchSeconds * 10) / 10)) };
    const d = duration();
    if (d) data.durationSeconds = d;
    sendRef.current({ id: postId, data });
  };
  const flush = () => {
    const s = st.current;
    while (s.pending >= 0.5) {
      const chunk = Math.min(30, s.pending);
      s.pending -= chunk;
      send(isVideo ? "progress" : "dwell", chunk);
    }
  };
  const credit = (seconds: number) => {
    const s = st.current;
    s.pending += seconds;
    s.total += seconds;
    s.foreground += seconds;
    if (isVideo && s.total >= 3 && s.total - seconds < 3) flush();
    if (s.pending >= FLUSH_EVERY) flush();
    const d = duration();
    if (isVideo && d && !s.completed && s.total >= d * 0.8) {
      s.completed = true;
      flush();
      send("complete", Math.min(30, d));
    }
  };

  // Impression lifecycle.
  useEffect(() => {
    if (!active) return;
    const s = st.current;
    Object.assign(s, { pending: 0, total: 0, foreground: 0, completed: false, lastPos: videoRef.current?.currentTime ?? 0, replayArmed: false, last: performance.now(), lastWall: 0 });
    const onHide = () => { if (document.visibilityState !== "visible") flush(); };
    document.addEventListener("visibilitychange", onHide);
    let timer: ReturnType<typeof setInterval> | undefined;
    if (!isVideo) {
      timer = setInterval(() => {
        const now = performance.now();
        const dt = (now - s.last) / 1000;
        s.last = now;
        if (document.visibilityState === "visible" && dt > 0 && dt < 2) credit(dt);
      }, 500);
    }
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      flush();
      if (s.foreground > 0.2 && s.foreground < QUICK_SKIP_S) send("quick-skip", s.foreground);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, postId, isVideo]);

  /** Wire to the <video> onTimeUpdate. */
  const onTimeUpdate = () => {
    const video = videoRef.current;
    const s = st.current;
    if (!video || !active) return;
    const pos = video.currentTime;
    const now = performance.now();
    const delta = pos - s.lastPos;
    const playing = !video.paused && !video.seeking && video.readyState >= 3 && document.visibilityState === "visible";
    if (!playing) {
      // Hidden, paused, seeking or buffering: drop the baseline so no gap is ever credited.
      s.lastWall = 0;
      s.lastPos = pos;
      return;
    }
    const wall = s.lastWall ? (now - s.lastWall) / 1000 : 0;
    s.lastWall = now;
    // Credit real foreground wall time, capped by actual media advance (fast-play/seek can't inflate).
    if (wall > 0 && wall <= 2 && delta > 0 && delta <= 2) credit(Math.min(wall, delta));
    // A natural loop: position wraps from near the end to near the start without a seek.
    const d = video.duration;
    if (playing && delta < 0 && Number.isFinite(d) && s.lastPos >= d - 1 && pos < 1) {
      if (!s.replayArmed) { s.replayArmed = true; send("replay", 0); }
    } else if (delta > 0 && pos > 1) s.replayArmed = false;
    s.lastPos = pos;
  };
  const onSeek = () => { st.current.lastPos = videoRef.current?.currentTime ?? 0; st.current.lastWall = 0; };
  const onPause = () => { st.current.lastWall = 0; flush(); };
  const stop = () => { stopped.current = true; st.current.pending = 0; };
  return { onTimeUpdate, onSeek, onPause, stop };
}
