import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";

const PRE_HIDE_PAUSE_WINDOW_MS = 750;

type PlaybackLifecycleOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  active: boolean;
  autoplay: boolean;
  dataSaver: boolean;
};

export function useWatchPlaybackLifecycle({
  videoRef,
  active,
  autoplay,
  dataSaver,
}: PlaybackLifecycleOptions) {
  const playbackOptions = useRef({ active, autoplay, dataSaver });
  playbackOptions.current = { active, autoplay, dataSaver };
  const resumeAfterVisibility = useRef(false);
  const wasPlaying = useRef(false);
  const pauseBeforeHide = useRef<{ video: HTMLVideoElement; at: number } | null>(null);
  const pauseExpiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualPausePending = useRef(false);
  const manualPauseExpiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playGeneration = useRef(0);

  const play = useCallback((video: HTMLVideoElement) => {
    const generation = ++playGeneration.current;
    return video.play().then(() => {
      // A play promise can settle after pause(), including across another
      // hide/show cycle. Never let an obsolete request restart the clip.
      if (document.hidden || generation !== playGeneration.current || videoRef.current !== video) {
        wasPlaying.current = false;
        video.pause();
        // A late play event is not new playback intent for the next hide.
        pauseBeforeHide.current = null;
      }
    });
  }, [videoRef]);

  const clearPauseExpiry = useCallback(() => {
    if (pauseExpiry.current) clearTimeout(pauseExpiry.current);
    pauseExpiry.current = null;
  }, []);

  const clearManualPauseExpiry = useCallback(() => {
    if (manualPauseExpiry.current) clearTimeout(manualPauseExpiry.current);
    manualPauseExpiry.current = null;
  }, []);

  const markManualPause = useCallback(() => {
    playGeneration.current++;
    manualPausePending.current = true;
    wasPlaying.current = false;
    resumeAfterVisibility.current = false;
    pauseBeforeHide.current = null;
    clearPauseExpiry();
    clearManualPauseExpiry();
    manualPauseExpiry.current = setTimeout(() => {
      manualPausePending.current = false;
      manualPauseExpiry.current = null;
    }, PRE_HIDE_PAUSE_WINDOW_MS);
  }, [clearManualPauseExpiry, clearPauseExpiry]);

  const onVideoPlay = useCallback(() => {
    wasPlaying.current = true;
    manualPausePending.current = false;
    clearManualPauseExpiry();
    pauseBeforeHide.current = null;
    clearPauseExpiry();
  }, [clearManualPauseExpiry, clearPauseExpiry]);

  const onVideoPause = useCallback(() => {
    const video = videoRef.current;
    const options = playbackOptions.current;

    if (manualPausePending.current) {
      manualPausePending.current = false;
      clearManualPauseExpiry();
      pauseBeforeHide.current = null;
      clearPauseExpiry();
      wasPlaying.current = false;
      return;
    }

    if (
      !document.hidden &&
      video &&
      wasPlaying.current &&
      options.active &&
      options.autoplay &&
      !options.dataSaver
    ) {
      pauseBeforeHide.current = { video, at: performance.now() };
      clearPauseExpiry();
      pauseExpiry.current = setTimeout(() => {
        if (pauseBeforeHide.current?.video === video) pauseBeforeHide.current = null;
        pauseExpiry.current = null;
      }, PRE_HIDE_PAUSE_WINDOW_MS);
    }
    wasPlaying.current = false;
  }, [clearManualPauseExpiry, clearPauseExpiry, videoRef]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const video = videoRef.current;
      const options = playbackOptions.current;
      if (document.hidden) {
        playGeneration.current++;
        const priorPause = pauseBeforeHide.current;
        const pausedJustBeforeHide = Boolean(
          video &&
            priorPause?.video === video &&
            performance.now() - priorPause.at <= PRE_HIDE_PAUSE_WINDOW_MS,
        );
        resumeAfterVisibility.current = Boolean(
          !manualPausePending.current &&
            options.active &&
            options.autoplay &&
            !options.dataSaver &&
            video &&
            (!video.paused || pausedJustBeforeHide),
        );
        pauseBeforeHide.current = null;
        clearPauseExpiry();
        wasPlaying.current = false;
        if (options.active) video?.pause();
        return;
      }

      const shouldResume = resumeAfterVisibility.current;
      resumeAfterVisibility.current = false;
      if (shouldResume && options.active && options.autoplay && !options.dataSaver && video) {
        void play(video).catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [clearPauseExpiry, play, videoRef]);

  useEffect(() => {
    if (!active || !autoplay || dataSaver) {
      playGeneration.current++;
      resumeAfterVisibility.current = false;
      pauseBeforeHide.current = null;
      wasPlaying.current = false;
      clearPauseExpiry();
    }
  }, [active, autoplay, dataSaver, clearPauseExpiry]);

  useEffect(
    () => () => {
      playGeneration.current++;
      clearPauseExpiry();
      clearManualPauseExpiry();
    },
    [clearManualPauseExpiry, clearPauseExpiry],
  );

  return { markManualPause, onVideoPlay, onVideoPause, play };
}
