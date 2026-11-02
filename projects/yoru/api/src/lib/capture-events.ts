// A capture is an event, not a log line. Anything that wants to watch one can
// subscribe here; the SSE route turns it into a stream the app can paint.
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

const listeners = new Set<(event: CaptureEvent) => void>();
const recent: CaptureEvent[] = [];

export function emitCapture(event: Omit<CaptureEvent, "at">) {
  const full: CaptureEvent = { ...event, at: Date.now() };
  recent.push(full);
  if (recent.length > 50) recent.shift();
  for (const listener of listeners) {
    try { listener(full); } catch { /* a dead client must not stop a capture */ }
  }
}

export function onCapture(listener: (event: CaptureEvent) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recentCaptures() {
  return recent.slice(-10);
}
