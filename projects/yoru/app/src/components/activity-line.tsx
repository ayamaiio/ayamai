import { useEffect, useState } from "react";

type Activity = { label: string; done: number; total: number; updatedAt: string };

/**
 * The library's own status line: what the box is doing, in its own voice.
 * Renders nothing when the box is idle, so a quiet library stays quiet.
 */
export function ActivityLine() {
  const [activity, setActivity] = useState<Activity | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/activity", { headers: { Accept: "application/json" } });
        if (!response.ok) return;
        const body = (await response.json()) as { activity?: Activity | null };
        if (!cancelled) setActivity(body.activity ?? null);
      } catch {
        // Reading status is never required for the library to work.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!activity) return null;
  const pct = activity.total > 0 ? Math.min(100, (activity.done / activity.total) * 100) : 0;

  return (
    <div className="mt-5" role="status" aria-live="polite" data-testid="activity-line">
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {activity.label} · {activity.done.toLocaleString()} of {activity.total.toLocaleString()}
      </p>
      <div className="mt-2 h-px w-full overflow-hidden bg-border">
        <div className="h-px bg-primary transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
