import { createHash } from "node:crypto";

export class MediaAuthorizationBusy extends Error {
  constructor(public readonly status: 429 | 503) { super("Media authorization temporarily unavailable."); }
}

type Bucket = { tokens: number; at: number; active: number };
// All limits are PER PROCESS. No queue, timers per viewer, DB writes or grants.
export class MediaAuthorizationBudget {
  private viewers = new Map<string, Bucket>();
  private service: Bucket;
  private active = 0;
  private prunedAt = 0;
  constructor(
    private readonly now = () => performance.now(),
    // Defaults bound the shared edge. A local single-owner library on loopback
    // renders grids of thumbnails and is not that surface, so it gets a larger
    // budget rather than a client that has to trickle images one at a time.
    private readonly limits = { serviceBurst: 128, serviceRate: 64, serviceActive: 4,
                                burst: 24, rate: 8, active: 2 },
  ) {
    this.service = { tokens: limits.serviceBurst, at: now(), active: 0 };
  }
  private take(bucket: Bucket, burst: number, perSecond: number, now: number) {
    bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) * perSecond / 1000);
    bucket.at = now;
    if (bucket.tokens < 1) return false;
    bucket.tokens--; return true;
  }
  acquire(viewer: string): () => void {
    const now = this.now();
    if (!this.take(this.service, this.limits.serviceBurst, this.limits.serviceRate, now)) throw new MediaAuthorizationBusy(503);
    const key = createHash("sha256").update(viewer).digest("hex");
    let bucket = this.viewers.get(key);
    if (!bucket) {
      if (now - this.prunedAt >= 1000) {
        for (const [id, b] of this.viewers) if (!b.active && now - b.at >= 60_000) this.viewers.delete(id);
        this.prunedAt = now;
      }
      // Fail closed rather than evicting a live viewer's rate debt.
      if (this.viewers.size >= 4096) throw new MediaAuthorizationBusy(503);
      bucket = { tokens: 24, at: now, active: 0 }; this.viewers.set(key, bucket);
    }
    if (!this.take(bucket, this.limits.burst, this.limits.rate, now) || bucket.active >= this.limits.active) throw new MediaAuthorizationBusy(429);
    if (this.active >= this.limits.serviceActive) throw new MediaAuthorizationBusy(503);
    this.active++; bucket.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; bucket.active--; } };
  }
}

// Cheap ingress brake before ticket decryption (including invalid credentials).
export class MediaAuthorizationIngress {
  private tokens = 256;
  private at: number;
  constructor(private readonly now = () => performance.now()) { this.at = now(); }
  take() {
    const now = this.now();
    this.tokens = Math.min(256, this.tokens + (now - this.at) * 128 / 1000); this.at = now;
    if (this.tokens < 1) return false;
    this.tokens--; return true;
  }
}
const localLibrary = Boolean(process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim());
export const mediaAuthorizationBudget = new MediaAuthorizationBudget(
  undefined,
  localLibrary
    ? { serviceBurst: 256, serviceRate: 128, serviceActive: 16, burst: 128, rate: 64, active: 8 }
    : undefined,
);
export const mediaAuthorizationIngress = new MediaAuthorizationIngress();
