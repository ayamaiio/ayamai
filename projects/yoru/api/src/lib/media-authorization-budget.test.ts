import assert from "node:assert/strict";
import test from "node:test";
import { MediaAuthorizationBudget, MediaAuthorizationBusy, MediaAuthorizationIngress } from "./media-authorization-budget";
import { MediaAuthorizationTelemetry } from "./media-authorization-telemetry";

function busy(fn: () => unknown, status: number) {
  assert.throws(fn, error => error instanceof MediaAuthorizationBusy && error.status === status);
}
test("global and viewer concurrency is bounded; releases are idempotent", () => {
  const budget = new MediaAuthorizationBudget();
  const a = budget.acquire("a"), b = budget.acquire("a");
  busy(() => budget.acquire("a"), 429);
  const c = budget.acquire("b"), d = budget.acquire("c");
  busy(() => budget.acquire("d"), 503);
  a(); a(); b(); c(); d();
  budget.acquire("d")();
});
test("viewer rate debt survives completion, refills and has a bounded map", () => {
  let now = 0;
  const budget = new MediaAuthorizationBudget(() => now);
  for (let i = 0; i < 24; i++) budget.acquire("viewer")();
  busy(() => budget.acquire("viewer"), 429);
  now += 125; budget.acquire("viewer")();
  busy(() => budget.acquire("viewer"), 429);
  const many = new MediaAuthorizationBudget(() => now);
  for (let i = 0; i < 4096; i++) { now += 16; many.acquire(`viewer-${i}`)(); }
  const entries = (many as unknown as { viewers: Map<string, unknown> }).viewers;
  assert.ok(entries.size <= 4096);
  now += 60_000; many.acquire("new-viewer")();
  assert.equal(entries.size, 1);
});
test("service rate limits and ingress reject without an unbounded queue and recover", () => {
  let now = 0;
  const budget = new MediaAuthorizationBudget(() => now);
  for (let i = 0; i < 128; i++) budget.acquire(`v-${i}`)();
  busy(() => budget.acquire("next"), 503);
  now += 1000; budget.acquire("next")();
  const ingress = new MediaAuthorizationIngress(() => now);
  for (let i = 0; i < 256; i++) assert.equal(ingress.take(), true);
  assert.equal(ingress.take(), false);
  now += 1000; assert.equal(ingress.take(), true);
});
test("operational windows contain only bounded aggregates and reset after alerts", () => {
  const metrics = new MediaAuthorizationTelemetry();
  assert.equal(metrics.flush(), null);
  for (let i = 0; i < 20; i++) metrics.record("allowed", 12);
  const healthy = metrics.flush()!;
  assert.equal(healthy.alert, false); assert.equal(healthy.p95UpperMs, 25);
  metrics.record("unavailable", 1001);
  const failure = metrics.flush()!;
  assert.equal(failure.alert, true); assert.equal(failure.counts.unavailable, 1);
  assert.equal(metrics.flush(), null);
  for (let i = 0; i < 20; i++) metrics.record("denied");
  assert.equal(metrics.flush()!.alert, true);
  assert.deepEqual(Object.keys(failure), ["event", "windowSeconds", "counts", "measured", "p95UpperMs", "alert"]);
});
