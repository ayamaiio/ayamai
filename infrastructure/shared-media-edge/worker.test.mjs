import assert from "node:assert/strict";
import test from "node:test";
import worker, { handleMedia, byteRange } from "./worker.mjs";

const id = "12e45678-e89b-12d3-a456-426614174000";
const url = `https://edge.example/streams/${id}?ticket=opaque-ticket`;
const bytes = new TextEncoder().encode("0123456789");
function setup() {
  const calls = [];
  const env = {
    AUTH_API_ORIGIN: "https://api.example", EDGE_SERVICE_SECRET: "x".repeat(32),
    MEDIA: {
      head: async key => { calls.push(["head", key]); return { size: bytes.length }; },
      get: async (key, opts) => {
        calls.push(["get", key, opts]);
        return { body: bytes.slice(opts?.range.offset ?? 0, opts ? opts.range.offset + opts.range.length : undefined) };
      },
    },
  };
  const auth = async (target, init) => {
    calls.push(["auth", target, init]);
    return Response.json({ objectKey: "media/PRIVATE-UPLOADER/hidden-name", contentType: "video/mp4" });
  };
  return { calls, env, auth };
}

test("ranges include suffix, open end, clamping and reject invalid/multiple/unsafe integers", () => {
  assert.deepEqual(byteRange(null, 10), null);
  for (const [value, offset, length] of [["bytes=2-4", 2, 3], ["bytes=8-", 8, 2], ["bytes=-3", 7, 3], ["bytes=-20", 0, 10], ["bytes=3-99", 3, 7]]) {
    assert.deepEqual(byteRange(value, 10), { offset, length });
  }
  for (const value of ["bytes=10-", "bytes=6-2", "bytes=-0", "bytes=1-2,4-5", "bytes=9007199254740992-", "bytes=a-b", "units=0-1", "bytes=0-9007199254740992"]) {
    assert.throws(() => byteRange(value, 10), value);
  }
  assert.throws(() => byteRange("bytes=0-0", 0));
});

test("GET, HEAD and single ranges only reveal safe metadata; each request reauthorizes", async () => {
  const { env, calls, auth } = setup();
  for (const [method, range, status, expected] of [
    ["GET", null, 200, "0123456789"], ["GET", "bytes=3-5", 206, "345"],
    ["GET", "bytes=-2", 206, "89"], ["HEAD", "bytes=0-1", 206, ""], ["HEAD", null, 200, ""],
  ]) {
    const res = await handleMedia(new Request(url, { method, headers: range ? { Range: range } : {} }), env, auth);
    assert.equal(res.status, status); assert.equal(await res.text(), expected);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    assert.equal(res.headers.get("Content-Disposition"), 'inline; filename="media"');
    assert.equal(res.headers.get("Accept-Ranges"), "bytes");
    assert.ok(!JSON.stringify([...res.headers]).includes("PRIVATE"));
    assert.equal(res.headers.get("Location"), null); assert.equal(res.headers.get("ETag"), null);
    if (range) assert.ok(res.headers.get("Content-Range")?.endsWith("/10"));
  }
  assert.equal(calls.filter(c => c[0] === "auth").length, 5);
  assert.equal(calls.filter(c => c[0] === "get").length, 3);
  const init = calls[0][2];
  assert.deepEqual(JSON.parse(init.body), { id, ticket: "opaque-ticket" });
  assert.equal(init.redirect, "error");
  assert.equal(init.headers["X-Edge-Authorization"], `Bearer ${env.EDGE_SERVICE_SECRET}`);
});

test("invalid tickets, revoked access and auth outages cannot read R2 or return identifying errors", async () => {
  for (const status of [404, 403, 500, 503]) {
    const { env, calls } = setup();
    const res = await handleMedia(new Request(url), env, async () => new Response("PRIVATE-UPLOADER", { status }));
    assert.equal(res.status, status === 404 ? 404 : 503);
    assert.equal(await res.text(), ""); assert.deepEqual(calls, []);
  }
  const { env, calls } = setup();
  const res = await handleMedia(new Request(url), env, async () => { throw new Error("secret"); });
  assert.equal(res.status, 503); assert.deepEqual(calls, []);
});

test("missing object, invalid range, method and configuration fail closed", async () => {
  const { env, auth, calls } = setup();
  const invalid = await handleMedia(new Request(url, { headers: { Range: "bytes=20-" } }), env, auth);
  assert.equal(invalid.status, 416); assert.equal(invalid.headers.get("Content-Range"), "bytes */10");
  assert.equal(calls.filter(c => c[0] === "get").length, 0);
  env.MEDIA.head = async () => null;
  assert.equal((await handleMedia(new Request(url), env, auth)).status, 404);
  assert.equal((await handleMedia(new Request(url, { method: "POST" }), env, auth)).status, 405);
  assert.equal((await handleMedia(new Request(url + "&key=other"), env, auth)).status, 404);
  assert.equal((await handleMedia(new Request(url + "&ticket=other"), env, auth)).status, 404);
  assert.equal((await handleMedia(new Request(url.replace(id, "storage-key")), env, auth)).status, 404);
  env.AUTH_API_ORIGIN = "http://api.example";
  assert.equal((await handleMedia(new Request(url), env, auth)).status, 503);
});

test("default Worker entry ignores execution context instead of treating it as a fetcher", async () => {
  const { env } = setup();
  env.AUTH_API_ORIGIN = "http://invalid.example";
  const res = await worker.fetch(new Request(url), env, { waitUntil() {} });
  assert.equal(res.status, 503);
});

test("authority saturation has a safe retry hint and never reads storage", async () => {
  for (const status of [429, 503]) {
    const { env, calls } = setup();
    const res = await handleMedia(new Request(url), env, async () => new Response("PRIVATE-GRANT", {
      status, headers: { "Retry-After": "PRIVATE-SECRET", Location: "https://private.invalid" },
    }));
    assert.equal(res.status, status); assert.equal(res.headers.get("Retry-After"), "1");
    assert.equal(res.headers.get("Location"), null);
    assert.equal(await res.text(), ""); assert.deepEqual(calls, []);
  }
});
