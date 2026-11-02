import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { Readable } from "node:stream";
import express from "express";
import { createMediaStreamRouter } from "../routes/media-stream";
import { SocialError } from "./social-access";

type Dependencies = NonNullable<Parameters<typeof createMediaStreamRouter>[0]>;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture(overrides: Partial<Dependencies> = {}) {
  const logs: { level: string; fields: unknown }[] = [];
  const closed = deferred<void>(), finished = deferred<void>();
  let finalStatus = 0;
  const app = express();
  app.use((req, res, next) => {
    req.log = {
      warn: (fields: unknown) => logs.push({ level: "warn", fields }),
      debug: (fields: unknown) => { logs.push({ level: "debug", fields }); finished.resolve(); },
    } as unknown as typeof req.log;
    res.once("close", () => { finalStatus = res.statusCode; closed.resolve(); });
    next();
  });
  app.use("/api", createMediaStreamRouter({
    ticket: (_id, token) => token === "fixture" ? "synthetic-viewer" : null,
    authorize: async () => ({ objectKey: "not-for-logs", contentType: "video/mp4" }),
    read: async () => ({ Body: Readable.from(Buffer.from("abcdef")), ContentLength: 6 }),
    ...overrides,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/streams/${randomUUID()}?ticket=fixture`;
  return {
    url, logs, closed: closed.promise, finished: finished.promise,
    status: () => finalStatus,
    stop: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
    cancel: () => { const req = request(url); req.on("error", () => {}); req.end(); return req; },
  };
}

test("cancellation during authorization does not start storage or report 502", { timeout: 5000 }, async () => {
  const entered = deferred<void>(), authorization = deferred<{ objectKey: string; contentType: string }>();
  let reads = 0;
  const f = await fixture({
    authorize: () => { entered.resolve(); return authorization.promise; },
    read: async () => { reads++; return {}; },
  });
  try {
    const req = f.cancel(); await entered.promise; req.destroy(); await f.closed;
    authorization.resolve({ objectKey: "private-key", contentType: "video/mp4" });
    await f.finished;
    assert.equal(reads, 0); assert.notEqual(f.status(), 502);
    assert.equal(f.logs.filter((log) => log.level === "warn").length, 0);
  } finally { await f.stop(); }
});

test("cancellation aborts a pending storage request without a 502", { timeout: 5000 }, async () => {
  const entered = deferred<void>();
  let upstreamSignal: AbortSignal | undefined;
  const f = await fixture({ read: async (_key, _range, signal) => {
    upstreamSignal = signal; entered.resolve();
    return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("AbortError")), { once: true }));
  } });
  try {
    const req = f.cancel(); await entered.promise; req.destroy(); await f.finished;
    assert.equal(upstreamSignal?.aborted, true);
    assert.notEqual(f.status(), 502);
    assert.equal(f.logs.filter((log) => log.level === "warn").length, 0);
  } finally { await f.stop(); }
});

test("late storage responses release the body after the client disconnects", { timeout: 5000 }, async () => {
  const entered = deferred<void>(), response = deferred<{ Body: Readable }>();
  const body = new Readable({ read() {} });
  const f = await fixture({ read: () => { entered.resolve(); return response.promise; } });
  try {
    const req = f.cancel(); await entered.promise; req.destroy(); await f.closed;
    response.resolve({ Body: body }); await f.finished;
    assert.equal(body.destroyed, true);
    assert.equal(f.logs.filter((log) => log.level === "warn").length, 0);
  } finally { await f.stop(); }
});

test("genuine storage failures return 502 with only safe diagnostic fields", async () => {
  const f = await fixture({ read: async () => { throw Object.assign(new Error("secret-ticket private-key account-id"), { $metadata: { httpStatusCode: 503 } }); } });
  try {
    const res = await fetch(f.url);
    assert.equal(res.status, 502);
    assert.equal(await res.text(), "Bad Gateway");
    assert.deepEqual(f.logs, [{ level: "warn", fields: {
      event: "media_stream_failure", phase: "storage", failureStatus: 502, upstreamStatus: 503, responseStarted: false,
    } }]);
    assert.doesNotMatch(JSON.stringify(f.logs), /secret-ticket|private-key|account-id|synthetic-viewer/);
  } finally { await f.stop(); }
});

test("source errors remain observable even when pipeline destroys the response", async () => {
  const f = await fixture({ read: async () => ({
    Body: Readable.from((async function* () { yield Buffer.from("a"); throw new Error("private upstream detail"); })()),
  }) });
  try {
    await fetch(f.url).then((res) => res.text()).catch(() => {});
    await f.closed;
    assert.ok(f.logs.some((log) => log.level === "warn"));
    assert.doesNotMatch(JSON.stringify(f.logs), /private upstream detail/);
  } finally { await f.stop(); }
});

test("range, HEAD, invalid tickets and permission denials retain their behavior", async () => {
  let authorizations = 0, body: Readable | undefined;
  const f = await fixture({
    authorize: async () => { authorizations++; return { objectKey: "key", contentType: "video/mp4" }; },
    read: async (_key, range) => {
      body = Readable.from(Buffer.from(range ? "bc" : "abcdef"));
      return { Body: body, ContentLength: range ? 2 : 6, ContentRange: range ? "bytes 1-2/6" : undefined };
    },
  });
  try {
    const res = await fetch(f.url, { headers: { Range: "bytes=1-2" } });
    assert.equal(res.status, 206); assert.equal(res.headers.get("content-range"), "bytes 1-2/6");
    assert.equal(await res.text(), "bc");
    const head = await fetch(f.url, { method: "HEAD" });
    assert.equal(head.status, 200); assert.equal(await head.text(), ""); assert.equal(body!.destroyed, true);
    assert.equal(authorizations, 2);
    assert.equal((await fetch(f.url.replace("fixture", "invalid"))).status, 404);
    assert.equal((await fetch(f.url, { headers: { Range: "bytes=1-2,4-5" } })).status, 416);
    assert.equal(authorizations, 2);
  } finally { await f.stop(); }
  const denied = await fixture({ authorize: async () => { throw new SocialError(404, "No access"); } });
  try { assert.equal((await fetch(denied.url)).status, 404); assert.equal(denied.logs.length, 0); } finally { await denied.stop(); }
});
