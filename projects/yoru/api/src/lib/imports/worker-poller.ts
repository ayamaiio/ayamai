export interface ImportRetryState {
  consecutiveFailures: number;
  retryInMs: number;
}

/**
 * Gate the worker's normal poll interval after interruptions. The attempt must
 * release its resources in finally before rejecting; no DB lock is held while
 * waiting for the next attempt. Never retain/log the raw exception.
 */
export class ImportWorkerPoller {
  private busy = false;
  private failures = 0;
  private retryAt = 0;

  constructor(
    private readonly attempt: () => Promise<void>,
    private readonly onFailure: (state: ImportRetryState) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async tick(): Promise<void> {
    if (this.busy || this.now() < this.retryAt) return;
    this.busy = true;
    try {
      await this.attempt();
      this.failures = 0;
      this.retryAt = 0;
    } catch {
      this.failures = Math.min(this.failures + 1, 1000);
      // 6s, 12s, 24s, 48s, then at most one failed attempt per minute.
      const retryInMs = Math.min(60_000, 3000 * 2 ** Math.min(this.failures, 5));
      this.retryAt = this.now() + retryInMs;
      this.onFailure({ consecutiveFailures: this.failures, retryInMs });
    } finally {
      this.busy = false;
    }
  }
}
