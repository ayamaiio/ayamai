// The front door. One port, every surface.
//
//   node scripts/gehirn.mjs       → http://ayamai.local/gehirn
//
// It is a router, not a framework: a table of path prefixes, a pipe in each
// direction, and websockets passed through. Every service is configured with
// the prefix it lives under, so the path is forwarded exactly as it arrived.
import { execFile, spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";

import { loadRegistry, projectRoutes } from "../core/registry.mjs";
import { dataRoot } from "../core/registry.mjs";
import { readMode, targetFor } from "../core/mode.mjs";
import { renderWelcome } from "./welcome.mjs";
import { UI_ASSETS, serveUiAsset } from "./ui-assets.mjs";
import { publicOrigin } from "../core/origin.mjs";
import { hostname as osHostname } from "node:os";

const PORT = Number(process.env.GATEWAY_PORT ?? 25222);
const HOST = process.env.GATEWAY_HOST ?? "127.0.0.1";
const APPS = process.env.GATEWAY_LOOPBACK ?? "127.0.0.1";

const REPO = process.env.AYAMAI_REPO ?? path.resolve(import.meta.dirname, "../..");

/** Pure: the platform's version, or null when the catalog is unreadable. */
export function platformVersion(repo = REPO) {
  try {
    const catalog = JSON.parse(readFileSync(path.join(repo, "catalog.json"), "utf8"));
    return (catalog.entries ?? []).find((entry) => entry.kind === "platform")?.version ?? null;
  } catch {
    return null;
  }
}
const registry = loadRegistry(REPO);

/**
 * Surfaces the platform itself hosts. Projects are added from their manifests
 * below — the door does not know any project by name.
 */
const PLATFORM_ROUTES = [
  { path: "/api", port: 8081, name: "api", ws: true, start: "python3 scripts/local-dev.py start --service api" },
  { path: "/gehirn", port: 4490, name: "gehirn", ws: false, start: "node scripts/gehirn.mjs" },
  { path: "/play", port: 4680, name: "play", ws: false, start: "env BASE_PREFIX=/play node packages/play/index.mjs" },
  { path: "/agent", port: 4491, name: "agent", ws: false, start: "node packages/agent/index.mjs" },
  { path: "/curator", port: 4319, name: "curator", ws: false, start: "python3 scripts/local-dev.py start --service curator" },
  { path: "/storybook", port: 6006, name: "storybook", ws: true, external: "http://localhost:6006/", start: "python3 scripts/local-dev.py start --service magi" },
];

/** Longest prefix wins. Each app is told its prefix, so nothing is rewritten. */
export const ROUTES = [...PLATFORM_ROUTES, ...projectRoutes(registry.projects)];

/** Anything without a prefix belongs to the panel. */
export const DEFAULT_ROUTE = { path: "", port: 4490, name: "gehirn-root", ws: false };

/** Old links and the phone's `/feed` keep working. */
export const REDIRECTS = new Map([
  ["/feed", "/yoru/feed"],
  ["/library", "/yoru/library"],
  ["/manga", "/yoru/manga"],
  ["/videos", "/yoru/videos"],
  ["/albums", "/yoru/albums"],
  ["/saved", "/yoru/saved"],
  ["/labels", "/yoru/labels"],
  ["/capture", "/yoru/capture"],
  ["/after-hours", "/yoru/after-hours"],
]);

/** The media project used to live at /app; the old address still resolves. */
export const MOVED_PREFIXES = new Map([["/app", "/yoru"], ["/cockpit", "/gehirn"], ["/board", "/seiri"], ["/arcade", "/gemu"], ["/gb", "/gemu/handheld"]]);

/** Pure: the app that owns a path. Segment boundaries only — `/apifoo` is not `/api`. */
export function routeFor(pathname) {
  let best = null;
  for (const route of ROUTES) {
    if (pathname === route.path || pathname.startsWith(`${route.path}/`)) {
      if (!best || route.path.length > best.path.length) best = route;
    }
  }
  return best ?? DEFAULT_ROUTE;
}

/** Pure: only a loopback caller who came from our own page may start a service. */
export function startAllowed({ remoteAddress = "", headers = {} } = {}) {
  const loopback = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  return loopback && String(headers["x-door"] ?? "") === "1";
}

/** Pure: a route can be started when it knows how, and is not the door itself. */
export function canStart(route) {
  return Boolean(route && (route.startSpec || route.start) && route.port && route.name !== "gateway");
}

/**
 * Pure: the 502 page. It carries the command, and a button that runs it — the
 * whole point of the page is that you are one click from the fix.
 */
export function errorPage({ route, detail = "not answering" }) {
  const starts = canStart(route);
  return `<!doctype html><meta charset="utf-8" /><title>${route.name} · down</title>
<style>
  /* the platform's face, never the browser's */
  button{appearance:none;-webkit-appearance:none}

  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0b0d14; color:#e6ecff;
         font:13px/1.7 "IBM Plex Mono", ui-monospace, monospace; }
  .box { max-width:520px; padding:28px; border:1px solid #202a5a; border-radius:12px;
         background:linear-gradient(180deg,rgba(32,42,90,.28),rgba(21,29,46,.35)); }
  .label { letter-spacing:.28em; text-transform:uppercase; font-size:9px; color:#e53935; }
  h1 { font-family:"Cormorant Garamond",Georgia,serif; font-weight:400; font-size:24px; margin:12px 0 6px; }
  .muted { color:#a3adc3; } code { color:#a9b7e8; }
  .row { display:flex; gap:10px; align-items:center; margin-top:18px; flex-wrap:wrap; }
  button { padding:9px 16px; border:1px solid #202a5a; border-radius:4px; background:none; color:#e6ecff;
           font:500 10px "IBM Plex Mono", monospace; letter-spacing:.2em; text-transform:uppercase; cursor:pointer; }
  button:hover:not(:disabled) { border-color:#a9b7e8; }
  button:disabled { opacity:.6; cursor:default; }
  .note { font-size:11px; color:#7f89a3; min-height:1.6em; }
  a { color:#a9b7e8; }
</style>
<div class="box">
  <div class="label">502 · upstream silent</div>
  <h1>${route.name} is not answering</h1>
  <div class="muted">${route.name} on <code>127.0.0.1:${route.port}</code> — ${detail}</div>
  <div class="muted" style="margin-top:14px">start it: <code>${route.start ?? "—"}</code></div>
  <div class="row">
    ${starts
      ? `<button id="start" data-name="${route.name}">start it</button><span class="note" id="note"></span>`
      : `<span class="note">no start command on record</span>`}
  </div>
  <div class="muted" style="margin-top:14px"><a href="${route.path ?? "/"}">try again</a> · <a href="/">back to the door</a></div>
</div>
${starts ? `<script>
(function () {
  var button = document.getElementById("start");
  var note = document.getElementById("note");
  var name = button.dataset.name;
  var tries = 0;

  function ping() {
    return fetch("/_door/ping?name=" + encodeURIComponent(name), { cache: "no-store" })
      .then(function (response) { return response.json(); })
      .then(function (data) { return Boolean(data.up); })
      .catch(function () { return false; });
  }

  button.addEventListener("click", function () {
    button.disabled = true;
    note.textContent = "starting…";
    fetch("/_door/start", {
      method: "POST",
      headers: { "content-type": "application/json", "x-door": "1" },
      body: JSON.stringify({ name: name })
    })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result.ok) { throw new Error(result.message || "could not start it"); }
        note.textContent = "waiting for it to answer…";
        (function wait() {
          tries += 1;
          ping().then(function (up) {
            if (up) { location.href = "${route.path ?? "/"}"; return; }
            if (tries > 40) { note.textContent = "still not up — the command ran, check its log"; button.disabled = false; return; }
            setTimeout(wait, 500);
          });
        })();
      })
      .catch(function (error) { note.textContent = String(error.message); button.disabled = false; });
  });
})();
</script>` : ""}`;
}

function brandedError(res, route, error) {
  const detail = error ? String(error.code ?? error.message ?? error) : "not answering";
  res.writeHead(502, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(errorPage({ route, detail }));
}

function readJson(req, limit = 4096) {
  return new Promise((resolve) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; if (body.length > limit) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}

function proxy(req, res, route) {
  const upstream = httpRequest(
    {
      host: APPS,
      port: route.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: req.headers.host ?? `localhost:${PORT}` },
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on("error", (error) => {
    if (res.headersSent) { res.destroy(); return; }
    brandedError(res, route, error);
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") { healthz(res); return; }

  // The 502 page's button. Loopback only, and only for a route that is known to
  // be startable — the caller names a route, never a command.
  if (url.pathname === "/_door/start" && req.method === "POST") {
    if (!startAllowed({ remoteAddress: req.socket.remoteAddress, headers: req.headers })) {
      res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, message: "not allowed" }));
      return;
    }
    const body = await readJson(req);
    const route = ROUTES.find((candidate) => candidate.name === String(body?.name ?? ""));
    if (!route || !canStart(route)) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, message: "no start command for that service" }));
      return;
    }
    const child = route.startSpec
      ? spawn(route.startSpec.command, route.startSpec.args, {
          cwd: REPO, detached: true, stdio: "ignore",
          env: { ...process.env, ...route.startSpec.env },
        })
      : spawn("/bin/sh", ["-c", route.start], { cwd: REPO, detached: true, stdio: "ignore", env: process.env });
    child.unref();
    console.log(`gateway: started ${route.name} — ${route.start}`);
    res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, message: "starting", command: route.start }));
    return;
  }

  if (url.pathname === "/_door/ping") {
    const route = ROUTES.find((candidate) => candidate.name === String(url.searchParams.get("name") ?? ""));
    const up = route ? (await probe(route.port)).up : false;
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ up, name: route?.name ?? null }));
    return;
  }

  if (url.pathname === "/health.json") { await healthJson(res); return; }

  // The design kit: one copy of the logo, the stylesheet and the icon, so no
  // project keeps its own. Everything is served from the door's root.
  if (req.method === "GET" && url.pathname.startsWith("/ui/")) {
    serveUiAsset(req, res, url.pathname, REPO);
    return;
  }

  // The front page. One composition, one job: get you into the cockpit.
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const mode = readMode(dataRoot()).mode;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(renderWelcome({
      origin: publicOrigin(), hostname: osHostname(), version: platformVersion(),
      mode, enterHref: targetFor(mode),
    }));
    return;
  }

  const redirect = REDIRECTS.get(url.pathname);
  if (redirect) {
    res.writeHead(302, { location: redirect + url.search });
    res.end();
    return;
  }
  for (const [from, to] of MOVED_PREFIXES) {
    if (url.pathname === from || url.pathname.startsWith(`${from}/`)) {
      res.writeHead(308, { location: to + url.pathname.slice(from.length) + url.search });
      res.end();
      return;
    }
  }

  // A surface that insists on living at the root gets a redirect, not a lie.
  const route = routeFor(url.pathname);
  if (route.external) {
    res.writeHead(302, { location: route.external + url.search.slice(1) });
    res.end();
    return;
  }
  // A bare prefix without its slash confuses the app's own asset base.
  for (const route of ROUTES) {
    if (url.pathname === route.path) {
      res.writeHead(308, { location: `${route.path}/${url.search}` });
      res.end();
      return;
    }
  }

  proxy(req, res, route);
});

// Websockets: Vite's hot reload and Storybook's channel.
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const route = routeFor(url.pathname);
  if (!route.ws) { socket.destroy(); return; }
  const upstream = connect(route.port, APPS, () => {
    const headers = Object.entries(req.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

function probe(port, timeout = 1500) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = httpRequest({ host: APPS, port, path: "/", method: "GET", timeout }, (res) => {
      res.resume();
      resolve({ up: true, ms: Date.now() - started, code: res.statusCode ?? 0 });
    });
    req.on("timeout", () => { req.destroy(); resolve({ up: false }); });
    req.on("error", () => resolve({ up: false }));
    req.end();
  });
}

// A route whose machine cannot run it is not "down": it is not installed here.
const requirementCache = new Map();
function requirementMet(requirement, memo) {
  if (memo.has(requirement)) return memo.get(requirement);
  const promise = new Promise((resolve) => {
    const [binary, version] = String(requirement).split(">=");
    if (version) {
      execFile(binary, ["--version"], { timeout: 4000 }, (error, stdout) => {
        if (error) return resolve(false);
        const found = Number(String(stdout).match(/(\d+)\./)?.[1] ?? 0);
        resolve(found >= Number(String(version).split(".")[0]));
      });
      return;
    }
    execFile(binary, ["--version"], { timeout: 4000 }, (error) => resolve(!error));
  });
  memo.set(requirement, promise);
  return promise;
}

async function healthJson(res) {
  const projectOf = (route) => registry.projects.find((project) => project.id === route.project);
  const results = await Promise.all(ROUTES.map(async (route) => {
    const probeResult = await probe(route.port);
    const project = projectOf(route);
    const requirements = project?.requires ?? [];
    const met = await Promise.all(requirements.map((requirement) => requirementMet(requirement, requirementCache)));
    // "kata:app" is precise but reads badly on the front page.
    return {
      name: route.name.split(":")[0],
      path: route.path,
      port: route.port,
      up: probeResult.up,
      ms: probeResult.ms ?? null,
      kind: route.project ? "project" : route.name === "gehirn" || route.name === "agent" ? "core" : "toy",
      // A running service is never "absent"; the requirement probe can lie about
      // a PATH it cannot see. Absent means: cannot run here *and* is not running.
      absent: !probeResult.up && requirements.length > 0 && met.some((value) => !value),
    };
  }));
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify({ at: Date.now(), version: platformVersion(), ok: results.every((route) => route.up), services: results }));
}

async function healthz(res) {
  const results = await Promise.all(ROUTES.map(async (route) => ({ ...route, ...(await probe(route.port)) })));
  const lines = results.map((route) =>
    `${route.up ? "up  " : "DOWN"}  /${route.name.padEnd(10)} 127.0.0.1:${route.port}${route.up ? `  ${route.ms} ms` : ""}`);
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  const version = platformVersion();
  res.end(`ayamai front door ${HOST}:${PORT}${version ? `  v${version}` : ""}\n\n${lines.join("\n")}\n`);
}

/** Open the door. Called by a direct run, or by the shim in scripts/. */
export function start() {
  server.listen(PORT, HOST, () => {
    console.log(`gateway: http://localhost:${PORT}  (${ROUTES.length} paths)`);
    for (const project of registry.projects) console.log(`  project ${project.id}: ${project.routes.map((route) => route.prefix).join(", ")}`);
    for (const bad of registry.invalid) console.log(`  invalid manifest ${bad.file}: ${bad.errors.join("; ")}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
  return server;
}

// Tests import routeFor; only a direct run opens the door.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) start();
