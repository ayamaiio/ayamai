import assert from "node:assert/strict";
import test from "node:test";
import { ImportWorkerPoller, type ImportRetryState } from "./worker-poller";

test("persistent database failures increase/cap retry delays without querying on every timer tick", async () => {
  let now = 0, attempts = 0;
  const warnings: ImportRetryState[] = [];
  const poller = new ImportWorkerPoller(async () => {
    attempts++;
    throw new Error("synthetic database interruption");
  }, (retry) => warnings.push(retry), () => now);
  for (const expectedDelay of [6000, 12000, 24000, 48000, 60000, 60000, 60000]) {
    const previous = attempts;
    await poller.tick();
    assert.equal(attempts, previous + 1);
    assert.equal(warnings.at(-1)?.retryInMs, expectedDelay);
    for (let elapsed = 3000; elapsed < expectedDelay; elapsed += 3000) {
      now += 3000;
      await poller.tick();
      assert.equal(attempts, previous + 1, "polls during backoff must not query the database or emit repeated warnings");
    }
    now += 3000;
  }
  assert.equal(warnings.length, attempts);
  assert.equal(warnings.at(-1)?.consecutiveFailures, 7);
});

test("successful work resets the delay and normal polling resumes", async () => {
  let now = 0, fail = true, attempts = 0;
  const warnings: ImportRetryState[] = [];
  const poller = new ImportWorkerPoller(async () => {
    attempts++;
    if (fail) throw new Error("synthetic interruption");
  }, (retry) => warnings.push(retry), () => now);
  await poller.tick();
  now = 6000; await poller.tick();
  assert.equal(warnings.at(-1)?.retryInMs, 12000);
  fail = false;
  now = 18000; await poller.tick();
  now = 21000; await poller.tick();
  assert.equal(attempts, 4);
  fail = true;
  now = 24000; await poller.tick();
  assert.deepEqual(warnings.at(-1), { consecutiveFailures: 1, retryInMs: 6000 });
});

test("overlapping ticks never duplicate work; resources release before retry and warning", async () => {
  let now = 0, attempts = 0;
  let rejectAttempt: (error: Error) => void = () => {};
  const actions: string[] = [];
  const poller = new ImportWorkerPoller(async () => {
    attempts++;
    try {
      await new Promise<void>((_resolve, reject) => { rejectAttempt = reject; });
    } finally { actions.push("release"); }
  }, (retry) => {
    actions.push("warning");
    assert.deepEqual(Object.keys(retry).sort(), ["consecutiveFailures", "retryInMs"]);
    assert.ok(!JSON.stringify(retry).includes("sensitive"));
  }, () => now);
  const running = poller.tick();
  await poller.tick(); now = 3000; await poller.tick();
  assert.equal(attempts, 1);
  rejectAttempt(new Error("sensitive signed source URL must not be retained in warning"));
  await running;
  assert.deepEqual(actions, ["release", "warning"]);
  now = 6000; await poller.tick();
  assert.equal(attempts, 1);
  now = 9000;
  const retrying = poller.tick();
  assert.equal(attempts, 2);
  rejectAttempt(new Error("synthetic retry failure"));
  await retrying;
});
