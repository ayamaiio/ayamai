import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { assertLocalDevAuthConfiguration, createLocalFounderAuth, isLoopbackAddress, requestUserId } from "./local-dev-auth";

const validEnvironment = {
  AYAMAI_DEV_AUTH_MODE: "local-founder", NODE_ENV: "development", HOST: "127.0.0.1",
  DATABASE_URL: "postgresql://local:local@127.0.0.1:5434/ayamai_local",
};

test("local founder mode only starts with the isolated loopback development environment", () => {
  assert.doesNotThrow(() => assertLocalDevAuthConfiguration(validEnvironment));
  assert.throws(() => assertLocalDevAuthConfiguration({ ...validEnvironment, NODE_ENV: "production" }), /unavailable in production/);
  assert.throws(() => assertLocalDevAuthConfiguration({ ...validEnvironment, HOST: "0.0.0.0" }), /bound to 127.0.0.1/);
  assert.throws(() => assertLocalDevAuthConfiguration({ ...validEnvironment, DATABASE_URL: "postgresql://remote/db" }), /127\.0\.0\.1:5434/);
  assert.throws(() => assertLocalDevAuthConfiguration({ ...validEnvironment, AWS_ACCESS_KEY_ID: "present" }), /cloud media credentials/);
});

test("local sessions are signed, subject-bound and expire", () => {
  const auth = createLocalFounderAuth(Buffer.alloc(32, 7));
  const now = 1_800_000_000_000;
  const token = auth.makeSession(now);
  assert.equal(auth.verifySession(token, now), true);
  assert.equal(auth.verifySession(token, now + 13 * 60 * 60 * 1000), false);
  assert.equal(auth.verifySession(`${token}x`, now), false);
  assert.equal(createLocalFounderAuth(Buffer.alloc(32, 8)).verifySession(token, now), false);
});

test("loopback checks accept only local IPv4 and IPv6 addresses", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("127.42.1.9"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.2"), false);
  assert.equal(isLoopbackAddress(undefined), false);
});

test("a client-supplied identity header cannot create a local founder session", () => {
  const previousMode = process.env.AYAMAI_DEV_AUTH_MODE;
  process.env.AYAMAI_DEV_AUTH_MODE = "local-founder";
  try {
    const auth = createLocalFounderAuth(Buffer.alloc(32, 3));
    const request = {
      headers: { "x-dev-user-id": "local-dev-founder" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;
    auth.middleware(request, {} as never, () => undefined);
    assert.equal(requestUserId(request), null);

    request.headers.cookie = "ayamai_local_dev=" + auth.makeSession();
    auth.middleware(request, {} as never, () => undefined);
    assert.equal(requestUserId(request), "local-dev-founder");

    request.headers["x-forwarded-for"] = "203.0.113.5";
    auth.middleware(request, {} as never, () => undefined);
    assert.equal(requestUserId(request), null);
  } finally {
    if (previousMode === undefined) delete process.env.AYAMAI_DEV_AUTH_MODE;
    else process.env.AYAMAI_DEV_AUTH_MODE = previousMode;
  }
});
