// The front door's decisions, without starting anything.
import test from "node:test";
import assert from "node:assert/strict";

import { ROUTES, DEFAULT_ROUTE, REDIRECTS, MOVED_PREFIXES, routeFor } from "./index.mjs";
import { formatStatus, renderWelcome } from "./welcome.mjs";
import { canStart, errorPage, startAllowed } from "./index.mjs";

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

test("the door speaks the page's language", () => {
  const html = renderWelcome({ origin: "http://ayamai.local", hostname: "machine", version: "2026.11.02.8" });

  // the lockup is the word and its kana — the mark comes later
  assert.ok(!html.includes('src="/ui/brand/mark.png"'), "no image above the word");
  assert.ok(html.indexOf("<h1>AYAMAI</h1>") < html.indexOf("アヤマイ"), "the kana sits below it");
  assert.ok(html.includes("A quiet place to run things."), "the door keeps its own voice");

  // one action, and nothing competing with it
  assert.equal((html.match(/class="enter"/g) ?? []).length, 1, "exactly one way in");
  assert.ok(!html.includes('class="also"'), "the old links row is gone from the hero");

  // the footer carries what the hero used to
  assert.ok(html.includes("ayamaiio &middot; ikari"), "who made it");
  assert.ok(html.includes("v2026.11.02.8"), "and which release");
  assert.ok(html.includes('href="/yoru/"') && html.includes('href="/healthz"'), "the links moved, they did not vanish");
  assert.ok(html.includes('id="status"'), "the health line is still honest");

  // one arrival, and none of it under reduced motion
  assert.equal((html.match(/@keyframes arrive/g) ?? []).length, 1, "one animation, not a sequence");
  assert.ok(/prefers-reduced-motion: no-preference/.test(html), "the hidden state is scoped to motion");
});

test("only the door's own page may start a service", () => {
  const local = { remoteAddress: "127.0.0.1", headers: { "x-door": "1" } };
  assert.equal(startAllowed(local), true);
  assert.equal(startAllowed({ remoteAddress: "::1", headers: { "x-door": "1" } }), true);
  assert.equal(startAllowed({ remoteAddress: "127.0.0.1", headers: {} }), false, "no header, no run");
  assert.equal(startAllowed({ remoteAddress: "192.168.1.9", headers: { "x-door": "1" } }), false, "not loopback");
});

test("a route is startable only when it says how", () => {
  assert.equal(canStart({ name: "gehirn", port: 4490, start: "node scripts/gehirn.mjs" }), true);
  assert.equal(canStart({ name: "hisho:app", port: 4650, startSpec: { command: "node", args: [] } }), true);
  assert.equal(canStart({ name: "studio", port: 5173 }), false, "no command on record");
  assert.equal(canStart({ name: "gateway", port: 25222, start: "node scripts/gateway.mjs" }), false, "never itself");
  assert.equal(canStart(null), false);
});

test("the 502 page offers the fix as a button", () => {
  const route = { name: "gehirn", port: 4490, path: "/gehirn/", start: "node scripts/gehirn.mjs" };
  const html = errorPage({ route, detail: "ECONNREFUSED" });
  assert.ok(html.includes("gehirn is not answering"));
  assert.ok(html.includes("ECONNREFUSED"));
  assert.ok(html.includes("node scripts/gehirn.mjs"), "the command is shown");
  assert.ok(html.includes('id="start"'), "and so is the button");
  assert.ok(html.includes('data-name="gehirn"'), "which names a route, never a command");
  assert.ok(html.includes("/_door/start"), "and calls the door, not the shell");

  const silent = errorPage({ route: { name: "studio", port: 5173, path: "/studio/" } });
  assert.ok(!silent.includes('id="start"'), "nothing to press when there is nothing to run");
  assert.ok(silent.includes("no start command"), "and it says so");
});


test("the door's enter button follows the mode", () => {
  assert.ok(renderWelcome({ mode: "play" }).includes('href="/play/"'));
  assert.ok(renderWelcome({ mode: "dev" }).includes('href="/gehirn/"'));
  assert.ok(renderWelcome({ enterHref: "/gehirn/" }).includes('href="/gehirn/"'), "an explicit target wins");
});
