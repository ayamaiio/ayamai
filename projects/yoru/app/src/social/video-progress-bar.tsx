import { Progress } from "@workspace/ayamai-design-system/components/ui/progress";

export function VideoProgressBar({ seconds, duration }: { seconds?: number | null; duration?: number | null }) {
  if (!seconds || !Number.isFinite(seconds) || !duration || !Number.isFinite(duration) || duration <= 0) return null;
  const percentage = Math.max(0, Math.min(100, seconds / duration * 100));
  if (percentage === 0) return null;
  return <Progress value={percentage} aria-label="Playback progress" aria-valuenow={Math.round(percentage)}
    aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${Math.round(percentage)}% watched`}
    className="absolute inset-x-0 bottom-0 h-1 rounded-none bg-background/80" />;
}
