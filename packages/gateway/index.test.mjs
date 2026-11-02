// The front door's decisions, without starting anything.
import test from "node:test";
import assert from "node:assert/strict";

import { ROUTES, DEFAULT_ROUTE, REDIRECTS, MOVED_PREFIXES, routeFor } from "./index.mjs";
import { formatStatus, renderWelcome } from "./welcome.mjs";

test("each prefix owns itself and its children", () => {
  for (const route of ROUTES) {
    assert.equal(routeFor(route.path).name, route.name, route.path);
    assert.equal(routeFor(`${route.path}/x/y`).name, route.name, `${route.path}/x/y`);
  }
});

test("segment boundaries are respected", () => {
  assert.equal(routeFor("/apifoo").name, DEFAULT_ROUTE.name);
  assert.equal(routeFor("/appetite/x").name, DEFAULT_ROUTE.name);
  assert.equal(routeFor("/boards").name, DEFAULT_ROUTE.name);
  assert.equal(routeFor("/api").name, "api");
  assert.equal(routeFor("/api/healthz").name, "api");
});

test("the root and its assets belong to the panel", () => {
  assert.equal(routeFor("/").name, DEFAULT_ROUTE.name);
  assert.equal(routeFor("/gehirn/api/status").name, "gehirn");
  assert.equal(routeFor("/gehirn/ui/ui.css").name, "gehirn");
});

test("nested prefixes take the longest match", () => {
  // /gehirn is longer than nothing; /api must not capture /gehirn/api.
  assert.equal(routeFor("/gehirn/api/status").port, 4490);
  assert.equal(routeFor("/api/status").port, 8081);
});

test("every route names a port; platform routes also name how to start", () => {
  for (const route of ROUTES) {
    assert.ok(Number.isInteger(route.port) && route.port > 0, route.name);
    // Project routes come from a manifest, where the start command lives on the service.
    if (route.project) assert.ok(route.name.includes(":"), route.name);
    else assert.ok(typeof route.start === "string" && route.start.length, route.name);
  }
});

test("the media project moved from /app to /yoru", () => {
  assert.equal(MOVED_PREFIXES.get("/app"), "/yoru");
  assert.equal(routeFor("/yoru/feed").name, "yoru:app");
});

test("old links, the phone, and the retired paths", () => {
  assert.equal(MOVED_PREFIXES.get("/cockpit"), "/gehirn");
  assert.equal(REDIRECTS.get("/feed"), "/yoru/feed");
  assert.equal(REDIRECTS.get("/library"), "/yoru/library");
});

test("the status line tells the truth in every state", () => {
  assert.deepEqual(formatStatus([]), { tone: "dim", text: "checking…" });
  assert.deepEqual(formatStatus(null), { tone: "dim", text: "checking…" });
  assert.deepEqual(formatStatus([{ name: "a", up: true }, { name: "b", up: true }]), { tone: "ok", text: "2 of 2 up" });
  assert.deepEqual(formatStatus([{ name: "a", up: true }, { name: "yoru", up: false }]), { tone: "warn", text: "1 of 2 up · yoru down" });
  assert.deepEqual(formatStatus([{ name: "a", up: false }]), { tone: "red", text: "none of 1 up" });
});

test("the front page invites you in without naming the room", () => {
  const html = renderWelcome({ origin: "http://ayamai.local", hostname: "machine" });
  assert.ok(html.includes('href="/gehirn/"'), "the button still goes to the panel");
  assert.ok(html.includes(">enter <span"), "the button says enter");
  assert.ok(!html.includes("enter gehirn"), "and does not name it");
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(html.includes("checking…"));
});

test("the design kit is served once, from the door", async () => {
  const { assetMeta } = await import("./ui-assets.mjs");
  const path = await import("node:path");
  const repo = path.resolve(import.meta.dirname, "../..");
  assert.equal(assetMeta("/ui/brand/mark.png", repo)?.type, "image/png");
  assert.equal(assetMeta("/ui/brand.css", repo)?.type, "text/css; charset=utf-8");
  assert.equal(assetMeta("/ui/brand/favicon.svg", repo)?.type, "image/svg+xml");
});

test("the design kit refuses anything not on the list", async () => {
  const { assetMeta } = await import("./ui-assets.mjs");
  const path = await import("node:path");
  const repo = path.resolve(import.meta.dirname, "../..");
  for (const unsafe of ["/ui/../package.json", "/ui/brand/../../../etc/passwd", "/ui/nope.css", "/ui/"]) {
    assert.equal(assetMeta(unsafe, repo), null, unsafe);
  }
});
