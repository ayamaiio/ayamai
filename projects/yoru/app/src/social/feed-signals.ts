// What the feed reports about how it was used.
//
// The API already stores these (watch_signals: watchedSeconds, quickSkips,
// completions, replays) and validates them; this module is the client half, kept
// pure where it can be so the rules are testable without a browser.

/** Under this long on a slide counts as a skip, not attention. */
export const QUICK_SKIP_MS = 1200;

const EVENT_PATH = (id: string) => `/api/watch/media/${encodeURIComponent(id)}/event`;

/**
 * Pure: a visit becomes one of two events. Everything under QUICK_SKIP_MS is a
 * skip — the API caps those at three a day, so a fast scroller cannot poison the
 * signal.
 */
export function classifyDwell(ms: number): "quick-skip" | "dwell" {
  return Math.max(0, Number(ms) || 0) < QUICK_SKIP_MS ? "quick-skip" : "dwell";
}

/**
 * Pure: the next page inside a collection, or null when the collection is done
 * and the click should move to the next post instead.
 */
export function nextPage(page: number, pageCount: number): number | null {
  const total = Math.max(1, Number(pageCount) || 1);
  const current = Math.max(0, Math.min(total - 1, Number(page) || 0));
  return current + 1 < total ? current + 1 : null;
}

export type SignalEvent = "dwell" | "quick-skip" | "progress" | "complete" | "replay";

/**
 * One event, fire and forget. `keepalive` lets it survive the page being hidden,
 * which is exactly when the last slide's dwell is reported. Telemetry must never
 * break the feed, so every failure is swallowed.
 */
export function sendSignal(id: string, event: SignalEvent, watchSeconds = 0): void {
  try {
    void fetch(EVENT_PATH(id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, watchSeconds: Math.max(0, Math.round(watchSeconds)) }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* nothing to do: the feed is more important than the count */
  }
}

/**
 * Pure: is the feed in consumption mode? `?play=1` and a bare `?play` both mean
 * yes; anything else — including `?play=0` — means no.
 */
export function isConsumeView(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search : "?" + String(search ?? ""));
  if (!params.has("play")) return false;
  const value = params.get("play");
  return value === "" || value === "1" || value === "true";
}

/** Pure: the querystring a mode should leave behind. */
export function consumeParam(play: boolean): string {
  return play ? "play=1" : "";
}
