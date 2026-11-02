import { useEffect, useRef, useState } from "react";

/**
 * Intake, live.
 *
 * A capture is an event stream, not a background job: pages tick in one at a
 * time while the post is being assembled, and the panel says so. It appears
 * bottom-left, gets out of the way on its own, and never blocks the feed.
 */
type CaptureEvent = {
  job: string;
  stage: "start" | "page" | "done" | "error";
  title?: string;
  index?: number;
  total?: number;
  imported?: number;
  failed?: number;
  at: number;
};

export function CaptureWatcher() {
  const [event, setEvent] = useState<CaptureEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const doneTimer = useRef<number | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/capture/events");
    source.onmessage = (message) => {
      let next: CaptureEvent;
      try { next = JSON.parse(message.data) as CaptureEvent; } catch { return; }
      // Replays of old events on connect should not flash the panel.
      if (Date.now() - next.at > 15_000) return;
      setEvent(next);
      setVisible(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (doneTimer.current) window.clearTimeout(doneTimer.current);
      if (next.stage === "done" || next.stage === "error") {
        doneTimer.current = window.setTimeout(() => setVisible(false), 4500);
      }
    };
    return () => {
      source.close();
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (doneTimer.current) window.clearTimeout(doneTimer.current);
    };
  }, []);

  if (!event) return null;
  const total = event.total ?? 0;
  const done = event.stage === "done" ? (event.imported ?? 0) : (event.index ?? 0);
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 8;

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed bottom-6 left-6 z-[60] w-[320px] rounded-xl border bg-[#0b0d14]/95 p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,.8)] backdrop-blur transition-all duration-500 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      } ${event.stage === "done" ? "border-[#91b7b3]/60" : "border-[#A9B7E8]/40"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-[#A9B7E8]">
          {event.stage === "done" ? "post added" : "collecting"}
        </p>
        <span className="font-mono text-[10px] tabular-nums text-white/40">
          {total ? `${Math.min(done, total)}/${total}` : ""}
        </span>
      </div>

      <p className="mt-1.5 truncate text-[13px] font-medium text-[#E6ECFF]">{event.title ?? "untitled post"}</p>

      <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${event.stage === "done" ? "bg-[#91b7b3]" : "bg-[#A9B7E8]"}`}
          style={{ width: `${event.stage === "done" ? 100 : percent}%` }}
        />
      </div>

      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-white/35">
        {event.stage === "done"
          ? `${event.imported ?? 0} pages → 1 post${event.failed ? ` · ${event.failed} refused` : ""}`
          : `page ${Math.max(1, event.index ?? 0)} of ${total}`}
      </p>
    </div>
  );
}
