import { useEffect, useRef, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getPlaybackBookmark, setPlaybackBookmark } from "@workspace/api-client-react";
import { toast } from "@workspace/ayamai-design-system/hooks/use-toast";
import { restorePlaybackProgress } from "./playback-progress";
import { rememberVideoProgress } from "./video-progress";

/** One fresh, authorized read per player session. Never restore from a previous account's cache. */
export function usePlaybackBookmark(videoRef: RefObject<HTMLVideoElement | null>, uid: string, id: string, url?: string, deleted?: RefObject<boolean>) {
  const client = useQueryClient();
  const identity = useRef({ uid, id });
  identity.current = { uid, id };
  const [attempt, retry] = useState(0);
  const [status, setStatus] = useState({ loading: true, error: "" });
  const flush = useRef<() => void>(() => {});
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    const controller = new AbortController();
    let disposed = false, loaded = false, restored = false, played = false;
    let saved: number | null = null, lastConfirmed: number | null = null;
    let lastAttempt = -Infinity, inFlight = false;
    let pending: number | null = null;
    const sameAccount = () => identity.current.uid === uid;
    const active = () => !disposed && sameAccount() && identity.current.id === id;
    setStatus({ loading: true, error: "" });
    const error = (message: string) => {
      if (active()) setStatus({ loading: false, error: message });
      else if (sameAccount()) toast({ title: message, variant: "destructive" });
    };
    const restore = () => {
      if (!loaded || restored || video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) return;
      // Playback cannot start via native controls until this authorized read finishes.
      restorePlaybackProgress(video, saved);
      restored = true;
      if (saved !== null) rememberVideoProgress(client, uid, id, saved, video.duration);
      if (active()) setStatus({ loading: false, error: "" });
    };
    void getPlaybackBookmark(id, uid, { signal: controller.signal }).then((bookmark) => {
      if (!active()) return;
      saved = bookmark.seconds;
      lastConfirmed = saved;
      loaded = true;
      restore();
    }).catch(() => {
      if (active()) error("Your saved position couldn’t load. Retry before playing to resume.");
    });
    const send = (seconds: number) => {
      if (!sameAccount() || deleted?.current) return;
      inFlight = true;
      lastAttempt = Date.now();
      void setPlaybackBookmark(id, uid, { seconds }, { keepalive: true }).then(() => {
        lastConfirmed = seconds;
        if (sameAccount()) rememberVideoProgress(client, uid, id, seconds, video.duration);
        if (active()) setStatus({ loading: false, error: "" });
      }).catch(() => {
        error("Your playback position didn’t sync. Retry to save it across devices.");
      }).finally(() => {
        inFlight = false;
        const next = pending;
        pending = null;
        if (next !== null && next !== lastConfirmed && sameAccount()) send(next);
      });
    };
    const persist = (force: boolean, completed = false) => {
      if (!sameAccount() || deleted?.current || !restored || !played || !Number.isFinite(video.duration) || video.duration <= 0) return;
      const seconds = completed || video.ended ? 0 : Math.min(Math.max(0, video.currentTime), video.duration);
      if (!Number.isFinite(seconds)) return;
      if (!force && (Date.now() - lastAttempt < 10_000 || Math.abs(seconds - (lastConfirmed ?? 0)) < 5)) return;
      if (inFlight) { pending = seconds; return; }
      if (seconds !== lastConfirmed) send(seconds);
    };
    flush.current = () => persist(true);
    const onPlay = () => { if (restored) played = true; };
    const onTime = () => persist(false);
    const onPause = () => persist(true);
    const onEnded = () => persist(true, true);
    const onHide = () => { if (document.hidden) { persist(true); video.pause(); } };
    const onExit = () => { persist(true); video.pause(); };
    video.addEventListener("loadedmetadata", restore);
    video.addEventListener("durationchange", restore);
    video.addEventListener("play", onPlay);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onExit);
    return () => {
      persist(true);
      disposed = true;
      controller.abort();
      video.removeEventListener("loadedmetadata", restore);
      video.removeEventListener("durationchange", restore);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onExit);
      video.pause();
    };
  }, [videoRef, uid, id, url, client, attempt, deleted]);
  return { ...status, retry: () => {
    if (status.error.includes("didn’t sync")) flush.current();
    else retry((n) => n + 1);
  } };
}
