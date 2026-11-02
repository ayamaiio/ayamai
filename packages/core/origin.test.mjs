// Where the door is, and who may knock.
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ORIGIN, publicOrigin, publicPort, allowedOrigins, isAllowedOrigin, publicUrl, isLocalhostName,
} from "./origin.mjs";

test("the default is ayamai.local on port 80", () => {
  assert.equal(publicOrigin({}), DEFAULT_ORIGIN);
  assert.equal(publicPort({}), 80);
  assert.equal(publicUrl("/yoru/", {}), "http://ayamai.local/yoru/");
});

test("an explicit origin and port win", () => {
  const env = { AYAMAI_PUBLIC_ORIGIN: "https://example.test/", AYAMAI_PORT: "8443" };
  assert.equal(publicOrigin(env), "https://example.test");
  assert.equal(publicPort(env), 8443);
});

test("the loopback names keep working, on both ports", () => {
  const origins = allowedOrigins({});
  assert.ok(origins.has("http://ayamai.local"));
  assert.ok(origins.has("http://localhost"));
  assert.ok(origins.has("http://127.0.0.1"));
  assert.ok(origins.has("http://localhost:25222"));
});

test("*.localhost is trusted by specification", () => {
  assert.equal(isLocalhostName("localhost"), true);
  assert.equal(isLocalhostName("ayamai.localhost"), true);
  assert.equal(isLocalhostName("ayamai.local"), false);
  assert.equal(isAllowedOrigin("http://whatever.localhost:25222", {}), true);
});

test("foreign origins are refused", () => {
  assert.equal(isAllowedOrigin("https://evil.example", {}), false);
  assert.equal(isAllowedOrigin("http://ayamai.local.evil.example", {}), false);
  assert.equal(isAllowedOrigin(undefined, {}), true); // curl and local tools
});

test("the configured origin is accepted with and without a port", () => {
  assert.equal(isAllowedOrigin("http://ayamai.local", {}), true);
  const withPort = { AYAMAI_PORT: "25222" };
  assert.equal(isAllowedOrigin("http://ayamai.local:25222", withPort), true);
  assert.equal(isAllowedOrigin("http://localhost:25222", withPort), true);
});
