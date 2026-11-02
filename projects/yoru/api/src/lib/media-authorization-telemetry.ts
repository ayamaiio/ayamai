import { logger } from "./logger";

const bounds = [10, 25, 50, 100, 250, 500, 1000, 2000];
type Outcome = "allowed" | "denied" | "viewer_limited" | "service_limited" | "unavailable" | "ingress_limited";
// Fixed-size, aggregate-only operational counters. Never accept request objects,
// viewer/media IDs, tickets, credentials, URLs, errors or storage grant objects.
export class MediaAuthorizationTelemetry {
  private counts: Record<Outcome, number> = { allowed: 0, denied: 0, viewer_limited: 0, service_limited: 0, unavailable: 0, ingress_limited: 0 };
  private latency = Array<number>(bounds.length + 1).fill(0);
  record(outcome: Outcome, ms?: number) {
    this.counts[outcome]++;
    if (ms !== undefined) this.latency[bounds.findIndex(b => ms <= b) < 0 ? bounds.length : bounds.findIndex(b => ms <= b)]++;
  }
  flush() {
    const counts = { ...this.counts }, histogram = [...this.latency];
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!total) return null;
    const measured = histogram.reduce((a, b) => a + b, 0);
    let cumulative = 0, p95UpperMs = 0;
    for (let i = 0; i < histogram.length; i++) {
      cumulative += histogram[i];
      if (measured && cumulative >= measured * .95) { p95UpperMs = bounds[i] ?? 5000; break; }
    }
    const limited = counts.viewer_limited + counts.service_limited + counts.ingress_limited;
    const alert = counts.unavailable > 0 || (total >= 20 && (limited / total >= .1 || counts.denied / total >= .2)) || p95UpperMs > 500;
    for (const key of Object.keys(this.counts) as Outcome[]) this.counts[key] = 0;
    this.latency.fill(0);
    return { event: "media_authorization_window", windowSeconds: 60, counts, measured, p95UpperMs, alert };
  }
}
export const mediaAuthorizationTelemetry = new MediaAuthorizationTelemetry();
setInterval(() => {
  const window = mediaAuthorizationTelemetry.flush();
  if (window) {
    if (window.alert) logger.warn(window, "Media authorization capacity alert");
    else logger.info(window, "Media authorization capacity");
  }
}, 60_000).unref();
