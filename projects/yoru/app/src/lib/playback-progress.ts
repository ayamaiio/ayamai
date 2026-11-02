type PlaybackVideo = Pick<HTMLVideoElement, "currentTime" | "duration">;

export function restorePlaybackProgress(video: PlaybackVideo, savedSeconds: number | null) {
  if (savedSeconds === null || !Number.isFinite(savedSeconds) || savedSeconds <= 0) return false;

  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const position = Math.min(savedSeconds, Math.max(0, duration - 0.1));
  video.currentTime = position;
  return true;
}

export function playbackProgressToSave(
  currentSeconds: number,
  savedSeconds: number,
  force = false,
  minimumDelta = 5,
) {
  if (!Number.isFinite(currentSeconds) || currentSeconds <= 0) return null;
  const delta = Math.abs(currentSeconds - savedSeconds);
  if (delta < 0.05 || (!force && delta < minimumDelta)) return null;
  return currentSeconds;
}
