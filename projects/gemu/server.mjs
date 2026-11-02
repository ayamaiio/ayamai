#!/usr/bin/env node
// gēmu — ゲーム. One page for playing: every emulator, every installed game, and a
// button that starts it.
//
//   node projects/gemu/server.mjs        → http://127.0.0.1:4660/gemu/
import { createServer, request as httpRequest } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dataRoot } from "../../packages/core/registry.mjs";
import { spawn } from "node:child_process";
import path from "node:path";

import { createLibrary, search } from "./library.mjs";
import { effectiveView } from "./views.mjs";
import { readMode } from "../../packages/core/mode.mjs";
import { launch, toWindows } from "./launch.mjs";
import { listRomDir } from "./sources/emulators.mjs";
import { brand, brandLinks } from "../../ui/brand.mjs";
import { inspectFolder, resolveInside, scanAll } from "./itch/catalog.mjs";
import { installZip, listZip } from "./itch/install.mjs";
import { serveGameFile } from "./itch/serve.mjs";
import { defaults as defaultSources, inboxOf, readSources, SOURCES_FILE } from "./itch/sources.mjs";

const HERE = import.meta.dirname;
const PORT = Number(process.env.GEMU_PORT ?? 4660);
const BASE = (process.env.BASE_PREFIX ?? "").replace(/\/$/, "");

const WIN = "/mnt/c";
const ROOTS = {
  rom: "/mnt/z/Roms",
  steamDefaults: [path.join(WIN, "Program Files (x86)/Steam"), path.join(WIN, "Program Files/Steam"),
                  "/mnt/z/SteamLibrary", "/mnt/y/SteamLibrary"],
  epicFile: path.join(WIN, "ProgramData/Epic/UnrealEngineLauncher/LauncherInstalled.dat"),
  gogDir: path.join(WIN, "Program Files (x86)/GOG Galaxy/Games"),
  itchDir: path.join("/mnt/c/Users", process.env.WIN_USER ?? "admin", "AppData/Local/itch/apps"),
  emulatorsFile: "/mnt/y/ayamai/state/emulators.json",
  indexFile: "/mnt/y/ayamai/state/arcade-index.json",
};

const toUnix = (windowsPath) => String(windowsPath ?? "")
  .replace(/^([A-Za-z]):[\\/]?/, (_, drive) => `/mnt/${drive.toLowerCase()}/`)
  .replace(/\\/g, "/")
  .replace(/\/{2,}/g, "/");

const HANDHELD = { host: "127.0.0.1", port: Number(process.env.HANDHELD_PORT ?? 4488) };

/** The catalog is cached: scanning twelve game folders on every request is how
 *  a page stops answering. */
let itchCache = { at: 0, value: null };
const ITCH_TTL = 60_000;

export function itchCatalog({ force = false } = {}) {
  const data = dataRoot();
  const now = Date.now();
  if (!force && itchCache.value && now - itchCache.at < ITCH_TTL) return itchCache.value;
  const roots = itchRoots(data);
  const value = { ...scanAll(roots), roots, inbox: inboxOf(roots), at: now };
  itchCache = { at: now, value };
  return value;
}

/** itch: the client's installs, the vault, the zip inbox, and whatever is configured. */
export function itchRoots(data) {
  const fallback = defaultSources({ itchApps: ROOTS.itchDir, vault: VAULT });
  return readSources(SOURCES_FILE(data), fallback);
}

/** The page that plays one game: an iframe for a build, Ruffle for a swf. */
export function playerPage(game) {
  const entry = game.kind === "flash"
    ? { ...game, swfFile: path.relative(game.root, game.swf) }
    : game;
  let template = "";
  try { template = readFileSync(path.join(HERE, "public/itch/player.html"), "utf8"); }
  catch { return "<!doctype html><title>missing</title><p>the itch player is missing"; }
  const payload = JSON.stringify(entry).replace(/</g, "\\u003c");
  return template.replace("<script src=", "<script>window.__GAME__ = " + payload + ";</script>\n<script src=");
}

/** Pure: a game folder's start command, so a test can read it. */
export function itchLaunch(game) {
  if (!game || game.kind !== "native" || !game.exe) return { error: "not a native game" };
  const windows = toWindows(game.exe);
  // /d sets the working directory: a Ren'Py game looks for game/ beside its exe
  return { command: "cmd.exe", args: ["/c", "start", "", "/d", toWindows(path.dirname(game.exe)), windows] };
}

// Systems: operating systems that need a real machine. TempleOS is 64-bit only
// and Windows XP predates any emulator small enough to be fun in a tab, so both
// run under QEMU as native windows.
const VAULT = process.env.AYAMAI_VAULT ?? "/mnt/y/ayamai";

/** Pure data: one entry per system. The page reads its copy from here. */
export const SYSTEMS = {
  templeos: {
    label: "templeos",
    title: "templeos 5.03",
    jp: "\u795e\u306eOS",
    blurb: "An operating system written alone, in its own language, for the joy of it.",
    iso: "TempleOS.ISO",
    memory: 512,
    vga: "std",
    disk: null,
    note: "TempleOS has no idea it is being looked at, so it wants the real keyboard.",
  },
  windowsxp: {
    label: "windows xp",
    title: "windows xp",
    jp: "",
    blurb: "Professional, service pack 3. A machine from 2001 that still expects to be a machine.",
    iso: "windows-xp-sp3.iso",
    memory: 512,
    vga: "std",
    disk: "windows-xp.qcow2",
    diskGb: 8,
    note: "Boots the installer. Installing needs a licence key and about half an hour; the disk is kept in the vault.",
  },
};

export const QEMU = process.env.QEMU_EXE ?? "C:\\Program Files\\qemu\\qemu-system-x86_64.exe";
const QEMU_IMG = process.env.QEMU_IMG ?? "C:\\Program Files\\qemu\\qemu-img.exe";

/** Pure: the argv that boots one system, so a test can read it. */
export function systemCommand(system, isoWindowsPath, diskWindowsPath = null, qemu = QEMU) {
  const args = ["-cdrom", isoWindowsPath, "-m", String(system.memory ?? 512), "-vga", system.vga ?? "std", "-boot", "d"];
  if (diskWindowsPath) args.push("-drive", "file=" + diskWindowsPath + ",format=qcow2,if=ide,index=0");
  return { command: qemu, args };
}

/** Pure: the ISO path for a system id, or null when the id is unknown. */
export function systemIso(id) {
  const system = SYSTEMS[String(id ?? "")];
  return system ? path.join(VAULT, "system", system.iso) : null;
}

export const TEMPLE = {
  iso: path.join(VAULT, "system", "TempleOS.ISO"),
  page: path.join(HERE, "public/templeos/index.html"),
  qemu: process.env.QEMU_EXE ?? "C:\\Program Files\\qemu\\qemu-system-x86_64.exe",
};

/** Pure: the argv that boots it, so a test can read it. */
export function templeCommand(isoWindowsPath, qemu = TEMPLE.qemu) {
  return { command: qemu, args: ["-cdrom", isoWindowsPath, "-m", "512", "-vga", "std"] };
}

/** The Game Boy keeps its own process; it is mounted under this one. */
function proxyHandheld(req, res, pathname) {
  const upstream = httpRequest({ host: HANDHELD.host, port: HANDHELD.port, path: pathname, method: req.method, headers: { ...req.headers, host: `${HANDHELD.host}:${HANDHELD.port}` } }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(res);
  });
  upstream.on("error", () => {
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("the handheld is not running");
  });
  req.pipe(upstream);
}

/** The Game Boy plays one ROM per process, so the page starts one on demand. */
let handheld = null;
function startHandheld(romPath) {
  if (handheld) { try { handheld.kill("SIGTERM"); } catch { /* already gone */ } handheld = null; }
  handheld = spawn(process.execPath, [path.join(HERE, "handheld/play.mjs"), romPath, String(HANDHELD.port)], { detached: false, stdio: "ignore" });
  handheld.on("exit", () => { handheld = null; });
}

/** Our emulator projects: one folder each, under emulators/. */
function children() {
  const dir = path.join(HERE, "emulators");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try { return { ...JSON.parse(readFileSync(path.join(dir, entry.name, "project.json"), "utf8")), dir: path.join(dir, entry.name) }; }
      catch { return null; }
    })
    .filter(Boolean);
}

function patchesFor(child) {
  try {
    return readdirSync(path.join(child.dir, "patches")).filter((name) => name.endsWith(".patch")).sort();
  } catch { return []; }
}

const COVERS = path.join(dataRoot(), "gemu/covers");
const COVER_LIMIT = 2 * 1024 * 1024;
const misses = new Set();

/** Steam's own catalogue image, fetched once and kept beside the other data. */
async function cover(res, appid, { refresh = false } = {}) {
  if (!/^\d{1,9}$/.test(appid)) { send(res, 400, { error: "appid must be numeric" }); return; }
  const file = path.join(COVERS, `${appid}.jpg`);
  if (!refresh && existsSync(file)) { sendBytes(res, readFileSync(file)); return; }
  if (misses.has(appid)) { send(res, 204, ""); return; }

  const url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    const answer = await fetch(url, { signal: abort.signal });
    if (!answer.ok) { misses.add(appid); send(res, 204, ""); return; }
    const type = answer.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) { misses.add(appid); send(res, 204, ""); return; }
    const bytes = Buffer.from(await answer.arrayBuffer());
    if (bytes.length > COVER_LIMIT) { misses.add(appid); send(res, 204, ""); return; }
    try { mkdirSync(COVERS, { recursive: true }); writeFileSync(file, bytes); } catch { /* serve it anyway */ }
    sendBytes(res, bytes, type);
  } catch {
    misses.add(appid);
    send(res, 204, "");
  } finally {
    clearTimeout(timer);
  }
}

function sendBytes(res, bytes, type = "image/jpeg") {
  res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=31536000, immutable", "content-length": bytes.length });
  res.end(bytes);
}

const library = createLibrary({ paths: ROOTS, toUnix });
const recent = [];

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readJson(req, limit = 8192) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; if (raw.length > limit) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve(null); } });
  });
}

const CSS = `<style>
  /* the platform's face, never the browser's: background none does not hide a
     native button in WebKit, or in forced colours */
  button{appearance:none;-webkit-appearance:none;font:inherit;color:inherit}

  /* the palette and the control face come from /ui/ui.css */
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--void);color:var(--pale);font:13px/1.55 Inter,ui-sans-serif,system-ui,sans-serif}
  body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
    background:radial-gradient(1100px 620px at 78% -10%,color-mix(in srgb, var(--rei) 10%, transparent),transparent 60%),
               radial-gradient(900px 520px at 8% 108%,color-mix(in srgb, var(--violet) 7%, transparent),transparent 62%)}
  body>*{position:relative;z-index:1}
  .bar{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:16px 22px;border-bottom:1px solid var(--line)}
  .clock{font-family:var(--mono);font-size:11px;color:var(--dim)}
  .grid{display:grid;grid-template-columns:1.25fr 1fr .9fr;min-height:calc(100vh - 57px - 34px)}
  .panel{padding:18px 20px 26px;border-right:1px solid var(--line);min-width:0}
  .panel:last-child{border-right:0}
  .label{font-family:var(--mono);font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--dim);margin:0 0 10px}
  .label.after{margin-top:26px}
  .sec{display:flex;justify-content:space-between;align-items:baseline;margin:16px 0 6px;
    font:10px var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--dim)}
  .search{font:12px var(--mono);margin-bottom:12px}
  .game{display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--line-soft)}
  .game .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .game .meta{font:10px var(--mono);color:var(--dim);flex:none}
  .game .btn{padding:3px 9px;font-size:9px}
  .game .btn:disabled{opacity:.4;cursor:default}
  .crumb{font:10px var(--mono);color:var(--dim);margin-bottom:10px}
  .crumb a{color:var(--rei);text-decoration:none}
  .recent{font:10px/1.7 var(--mono);color:var(--dim)}
  .recent .ok{color:var(--ok)}.recent .bad{color:var(--red)}
  .hint{color:var(--dim);font:11px var(--mono)}
  .hidden{display:none !important}
  .bar.foot{border-top:1px solid var(--line);border-bottom:0;padding:8px 22px;font:11px var(--mono);color:var(--dim)}
  .shelf{padding:22px 24px 70px}
  .shelf .sec{display:flex;justify-content:space-between;align-items:baseline;margin:26px 0 12px;
              font:10px var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--dim)}
  .shelf .sec:first-child{margin-top:0}
  .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:16px}
  .tile{display:flex;flex-direction:column;gap:8px;text-align:left;background:none;border:0;padding:0;cursor:pointer;color:inherit}
  .tile .art{position:relative;aspect-ratio:460/215;border-radius:8px;border:1px solid var(--line);overflow:hidden;
             background:linear-gradient(145deg,var(--card),var(--void));background-size:cover;background-position:center;
             display:grid;place-items:center;transition:border-color .18s, transform .18s}
  .tile:hover .art{border-color:var(--rei);transform:translateY(-2px)}
  .tile .art .word{font:400 15px/1.2 var(--serif);letter-spacing:.08em;color:var(--muted);text-align:center;padding:0 12px}
  .tile .nm{font:400 12.5px/1.35 Inter,sans-serif;color:var(--pale);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tile .cap{font:9px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}
  .tile.dead{cursor:default;opacity:.55}
  .toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:color-mix(in srgb, var(--void) 96%, transparent);
         border:1px solid var(--line);border-radius:8px;padding:9px 14px;font:11px var(--mono);color:var(--dim);
         opacity:0;pointer-events:none;transition:opacity .2s}
  .toast.on{opacity:1}
</style>`;

export const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>ayamai — gemu</title>
<link rel="icon" href="/gehirn/favicon.ico"/>
<link rel="stylesheet" href="/ui/ui.css"/>
${brandLinks()}
${CSS}</head><body>
<header class="bar">
  ${brand({ tool: "gemu", jp: "ゲーム" })}
  <span class="clock"><button class="btn ghost sm" id="view-toggle">play</button>
      <span id="view-source" style="color:var(--dim);font-size:10px;letter-spacing:.1em"></span>
      <button class="btn ghost sm" id="view-reset" style="display:none">follow mode</button> · <a href="/gemu/handheld/" style="color:var(--dim);text-decoration:none">handheld</a> · <a href="/gemu/system/templeos/" style="color:var(--dim);text-decoration:none">templeos</a> · <a href="/gemu/system/windowsxp/" style="color:var(--dim);text-decoration:none">windows xp</a> · <a href="/gemu/itch/" style="color:var(--dim);text-decoration:none">itch</a> · <a href="/gehirn/" style="color:var(--dim);text-decoration:none">gehirn</a> · <span id="clock">--:--:--</span></span>
</header>
<main class="shelf hidden" id="shelf"><div id="shelf-grid"></div></main>
<main class="grid" id="develop">
  <section class="panel">
    <p class="label">library <span class="hint" id="totals"></span></p>
    <input class="input search" id="search" placeholder="search a game, an emulator, a system"/>
    <div id="library"><span class="hint">scanning…</span></div>
  </section>
  <section class="panel">
    <p class="label">roms</p>
    <div class="crumb" id="crumb"></div>
    <div id="roms"><span class="hint">pick a system on the left</span></div>
  </section>
  <section class="panel">
    <p class="label">recent</p>
    <div class="recent" id="recent"><span class="hint">nothing launched yet</span></div>
    <p class="label after">sources</p>
    <div class="recent" id="sources"></div>
    <div><button class="btn sm" id="rescan" style="margin-top:14px">rescan</button></div>
  </section>
</main>
  <div class="toast" id="toast"></div>
<footer class="bar foot"><span id="foot">reads steam · epic · gog · itch · emulators · roms</span><span>ayamai · ikari</span></footer>
<script>
(function(){
  var state = null, query = "", recent = [], system = "";
  var MODE = ${JSON.stringify(readMode(dataRoot()).mode)};
  var fromMode = ${JSON.stringify(effectiveView({ mode: readMode(dataRoot()).mode }).view)};
  var view = (function () {
    var picked = ${JSON.stringify(effectiveView({ param: null, stored: null, mode: readMode(dataRoot()).mode }).view)};
    var asked = new URLSearchParams(location.search).get("view");
    if (asked === "play" || asked === "develop") return asked;
    var stored = localStorage.getItem("ayamai.view.gemu");
    if (stored === "play" || stored === "develop") return stored;
    return picked;
  })();
  var $ = function(id){ return document.getElementById(id); };
  // the mode seeds the view; the toggle overrides it; this says which is in force
  var READY = function(){ paintSource(); bindReset(); };
  function el(tag, cls, text){ var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function play(entry){
    return fetch("${BASE}/api/launch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cockpit": "1" },
      body: JSON.stringify(entry)
    }).then(function(r){ return r.json(); }).then(function(result){
      recent.unshift(result);
      renderRecent();
    });
  }

  function bindReset() {
    var reset = $("view-reset");
    if (!reset) return;
    reset.onclick = function () {
      localStorage.removeItem("ayamai.view.gemu");
      location.href = location.pathname;
    };
  }

  function paintSource() {
    var stored = localStorage.getItem("ayamai.view.gemu");
    var node = $("view-source");
    var reset = $("view-reset");
    if (!node) return;
    if (stored) {
      node.textContent = "override";
      if (reset) reset.style.display = "";
    } else {
      node.textContent = MODE === "play" ? "from play mode" : "from dev mode";
      if (reset) reset.style.display = "none";
    }
  }

  function find(id){
    var all = [];
    (state.sections || []).forEach(function(section){ section.games.forEach(function(game){ all.push(game); }); });
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  var SECTION_PAGE = 60;
  var shown = {};

  function renderLibrary(){
    var host = $("library"); host.innerHTML = "";
    if (!query) shown = {};
    var sections = state.sections || [];
    if (query) {
      var flat = [];
      sections.forEach(function(section){ search(section.games).forEach(function(game){ flat.push(game); }); });
      sections = flat.length ? [{ id: "matches", label: "matches", games: flat }] : [];
    }
    if (!sections.length) { host.appendChild(el("span", "hint", query ? "nothing matches" : "nothing installed")); return; }
    sections.forEach(function(section){
      var head = el("div", "sec");
      head.appendChild(el("span", null, section.label));
      head.appendChild(el("span", null, String(section.games.length)));
      host.appendChild(head);
      var limit = query ? section.games.length : (shown[section.id] || SECTION_PAGE);
      section.games.slice(0, limit).forEach(function(game){
        var row = el("div", "game");
        var ours = (state.children || []).find(function (child) { return child.name === game.name || child.id === game.id; });
        if (ours) {
          var nm = el("a", "nm", game.name);
          nm.href = "${BASE}/" + ours.id + "/";
          nm.style.color = "inherit"; nm.style.textDecoration = "none";
          nm.title = "open " + ours.displayId;
          row.appendChild(nm);
        } else {
          row.appendChild(el("span", "nm", game.name));
        }
        var meta = game.system ? (game.playable === false ? "no emulator" : (game.files + " files")) : (game.systems ? game.systems.length + " systems" : "");
        if (ours) meta = (ours.fork ? "ours" : "installed") + (meta ? " · " + meta : "");
        row.appendChild(el("span", "meta", meta));
        if (game.kind === "system") {
          var browse = el("button", "btn ghost sm", "browse");
          browse.onclick = function(){ openSystem(game.name); };
          row.appendChild(browse);
          var folder = el("button", "btn ghost sm", "folder");
          folder.title = "open this system's folder in Explorer";
          folder.onclick = function(){ play({ kind: "folder", id: game.name }); };
          row.appendChild(folder);
        } else if (game.kind === "emulator") {
          var run = el("button", "btn ghost sm", "launch");
          run.onclick = function(){ play({ kind: "emulator", id: game.id }); };
          row.appendChild(run);
        } else {
          var go = el("button", "btn ghost sm", "play");
          go.onclick = function(){ play({ kind: game.kind, id: game.id, exe: game.exe, rom: game.rom }); };
          row.appendChild(go);
        }
        host.appendChild(row);
      });

      // the rest of the section, one press at a time
      var left = section.games.length - limit;
      if (!query && left > 0) {
        var more = el("button", "btn ghost sm", "show " + Math.min(SECTION_PAGE, left) + " more of " + left);
        more.style.cssText = "margin:8px 0 0;padding:5px 10px;width:auto;cursor:pointer;font-size:9px";
        more.onclick = function () {
          shown[section.id] = Math.min(section.games.length, limit + SECTION_PAGE);
          renderLibrary();
        };
        host.appendChild(more);
      }
    });
  }

  READY();

  function toast(text) {
    var node = $("toast");
    node.textContent = text;
    node.classList.add("on");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { node.classList.remove("on"); }, 2600);
  }

  function tileFor(game, section) {
    var tile = el("button", "tile");
    var art = el("div", "art");
    if (game.kind === "steam" && /^[0-9]+$/.test(String(game.id))) {
      art.style.backgroundImage = 'url("' + "${BASE}" + '/cover/' + game.id + '")';
    } else {
      art.appendChild(el("span", "word", game.name));
    }
    tile.appendChild(art);
    tile.appendChild(el("span", "nm", game.name));
    var caption = game.kind === "steam" ? "steam"
      : game.kind === "emulator" ? (game.systems || []).slice(0, 2).join(" · ")
      : game.kind === "system" ? (game.files + " files" + (game.playable ? "" : " · no emulator"))
      : (game.source || "");
    tile.appendChild(el("span", "cap", caption));

    if (game.kind === "system") {
      tile.onclick = function () { openSystem(game.name); switchView("develop"); };
    } else if (game.playable === false) {
      tile.className = "tile dead";
    } else {
      tile.onclick = function () {
        play({ kind: game.kind, id: game.id, exe: game.exe, rom: game.rom, system: game.system })
          .then(function (result) { toast(game.name + " · " + (result && result.ok ? "ok" : "failed")); });
      };
    }
    return tile;
  }

  function renderShelf() {
    var host = $("shelf-grid");
    host.innerHTML = "";
    var sections = (state && state.sections) || [];
    if (!sections.length) { host.appendChild(el("p", "hint", "nothing installed")); return; }
    sections.forEach(function (section) {
      var games = search(section.games);
      if (!games.length) return;
      var head = el("div", "sec");
      head.appendChild(el("span", null, section.label));
      head.appendChild(el("span", null, String(games.length)));
      host.appendChild(head);
      var grid = el("div", "tiles");
      games.slice(0, 400).forEach(function (game) { grid.appendChild(tileFor(game, section)); });
      host.appendChild(grid);
    });
    if (!host.children.length) host.appendChild(el("p", "hint", "nothing matches"));
  }

  function applyView() {
    $("develop").classList.toggle("hidden", view === "play");
    $("shelf").classList.toggle("hidden", view !== "play");
    $("view-toggle").textContent = view === "play" ? "develop" : "play";
    if (view === "play") renderShelf();
  }

  function switchView(next) {
    view = next;
    localStorage.setItem("ayamai.view.gemu", next);
    paintSource();
    try {
      var url = next === "play" ? location.pathname + "?view=play" : location.pathname;
      history.replaceState(null, "", url);
    } catch (error) { /* replaceState can be blocked; the state still applies */ }
    applyView();
  }

  function search(games){
    var needle = query.toLowerCase();
    return games.filter(function(game){ return (game.name + " " + (game.system || "") + " " + game.kind).toLowerCase().indexOf(needle) >= 0; });
  }

  function openSystem(name){
    system = name;
    $("crumb").textContent = name;
    $("roms").innerHTML = '<span class="hint">reading…</span>';
    fetch("${BASE}/api/roms?system=" + encodeURIComponent(name)).then(function(r){ return r.json(); }).then(function(data){
      var host = $("roms"); host.innerHTML = "";
      if (!data.ok) { host.appendChild(el("span", "hint", data.error || "unreadable")); return; }
      if (!data.entries.length) { host.appendChild(el("span", "hint", "empty")); return; }
      data.entries.slice(0, 300).forEach(function(entry){
        var row = el("div", "game");
        row.appendChild(el("span", "nm", entry.name));
        row.appendChild(el("span", "meta", entry.dir ? "dir" : Math.max(1, Math.round(entry.size / 1048576)) + " MB"));
        if (entry.dir) {
          var open = el("button", "btn ghost sm", "open");
          open.onclick = function(){ openPath(entry.path); };
          row.appendChild(open);
        } else {
          var run = el("button", "btn ghost sm", "play");
          run.onclick = function(){ play({ kind: "rom", id: entry.path, rom: entry.path, system: name }); };
          row.appendChild(run);
        }
        host.appendChild(row);
      });
    });
  }

  function openPath(relative){
    fetch("${BASE}/api/roms?system=" + encodeURIComponent(system) + "&path=" + encodeURIComponent(relative))
      .then(function(r){ return r.json(); })
      .then(function(data){
        var host = $("roms"); host.innerHTML = "";
        $("crumb").innerHTML = '<a href="#" id="back">' + system + '</a> / ' + relative;
        document.getElementById("back").onclick = function(event){ event.preventDefault(); openSystem(system); };
        (data.entries || []).forEach(function(entry){
          var row = el("div", "game");
          row.appendChild(el("span", "nm", entry.name));
          row.appendChild(el("span", "meta", entry.dir ? "dir" : Math.max(1, Math.round(entry.size / 1048576)) + " MB"));
          if (entry.dir) {
            var open = el("button", "btn ghost sm", "open");
            open.onclick = function(){ openPath(entry.path); };
            row.appendChild(open);
          } else {
            var run = el("button", "btn ghost sm", "play");
            run.onclick = function(){ play({ kind: "rom", id: entry.path, rom: entry.path, system: system }); };
            row.appendChild(run);
          }
          host.appendChild(row);
        });
      });
  }

  function renderRecent(){
    var host = $("recent"); host.innerHTML = "";
    if (!recent.length) { host.appendChild(el("span", "hint", "nothing launched yet")); return; }
    recent.slice(0, 8).forEach(function(result){
      var line = el("div");
      var mark = el("span", result.ok ? "ok" : "bad", result.ok ? "ok  " : "fail");
      line.appendChild(mark);
      line.appendChild(document.createTextNode(" " + (result.name || result.id || "") + " · " + (result.ran || result.error || "")));
      host.appendChild(line);
    });
  }

  function renderSources(){
    var host = $("sources"); host.innerHTML = "";
    var counts = state.counts || {};
    Object.keys(counts).forEach(function(key){
      var line = el("div");
      line.appendChild(el("span", "ok", String(counts[key]).padStart(3, " ")));
      line.appendChild(document.createTextNode("  " + key));
      host.appendChild(line);
    });
    if (!Object.keys(counts).length) host.appendChild(el("span", "hint", "nothing found"));
  }

  function refresh(){
    return fetch("${BASE}/api/state", { cache: "no-store" }).then(function(r){ return r.json(); }).then(function(data){
      state = data;
      $("totals").textContent = data.total + " entries";
      renderLibrary(); renderSources(); applyView();
      $("foot").textContent = "read " + new Date(data.at).toLocaleTimeString() + " · steam · epic · gog · itch · emulators · roms";
    });
  }

  $("search").addEventListener("input", function(event){ query = event.target.value; renderLibrary(); if (view === "play") renderShelf(); });
  $("view-toggle").addEventListener("click", function(){ switchView(view === "play" ? "develop" : "play"); });
  $("rescan").addEventListener("click", function(){ fetch("${BASE}/api/rescan", { method: "POST", headers: { "x-cockpit": "1" } }).then(refresh); });

  setInterval(function(){ $("clock").textContent = new Date().toLocaleTimeString(); }, 1000);
  $("clock").textContent = new Date().toLocaleTimeString();
  refresh(); renderRecent();
})();
</script></body></html>`;

function childPage(child) {
  const patches = patchesFor(child);
  const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const link = (href, label) => href ? `<a href="${escape(href)}" target="_blank" rel="noreferrer" style="color:var(--rei);text-decoration:none">${escape(label)}</a>` : `<span style="color:var(--dim)">—</span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>ayamai — ${escape(child.id)}</title>
<link rel="icon" href="/gehirn/favicon.ico"/>${CSS}</head><body>
<header class="bar">
  ${brand({ tool: "gemu", jp: "ゲーム" })}
  <span class="clock"><a href="${BASE}/" style="color:var(--dim);text-decoration:none">gemu</a> · <a href="/gehirn/" style="color:var(--dim);text-decoration:none">gehirn</a></span>
</header>
<main class="grid" style="grid-template-columns:1fr 1fr">
  <section class="panel">
    <p class="label">ours · ${escape(child.parent)}/${escape(child.id)}</p>
    <h1 style="margin:0;font-family:var(--serif);font-weight:400;font-size:30px;letter-spacing:.12em;text-transform:uppercase">${escape(child.name)}</h1>
    <p class="sub" style="color:var(--dim);font-size:12px;margin-top:6px">${escape(child.description ?? "")}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:18px;font-family:var(--mono);font-size:11px">
      <tr><td style="color:var(--dim);padding:6px 0;width:120px">upstream</td><td>${link(child.upstream?.repo, child.upstream?.repo || "unknown")}</td></tr>
      <tr><td style="color:var(--dim);padding:6px 0">license</td><td>${escape(child.upstream?.license || "unknown")}</td></tr>
      <tr><td style="color:var(--dim);padding:6px 0">pinned</td><td>${escape(child.upstream?.tag || "—")}</td></tr>
      <tr><td style="color:var(--dim);padding:6px 0">fork</td><td>${child.fork?.repo ? link(child.fork.repo, child.fork.repo) : '<span style="color:var(--warn)">not forked yet</span>'}</td></tr>
      <tr><td style="color:var(--dim);padding:6px 0">systems</td><td>${escape((child.emulator?.systems ?? []).join(", ") || "—")}</td></tr>
      <tr><td style="color:var(--dim);padding:6px 0">binary</td><td>${escape(child.emulator?.exe ?? "—")}</td></tr>
    </table>
  </section>
  <section class="panel">
    <p class="label">patches <span class="hint">${patches.length}</span></p>
    ${patches.length ? patches.map((name) => `<div class="game"><span class="nm">${escape(name)}</span></div>`).join("") : '<span class="hint">none — our fork carries no diffs yet</span>'}
    <p class="label after">do</p>
    <div class="game">
      <span class="nm">launch ${escape(child.name)}</span>
      <button class="btn" id="launch">launch</button>
    </div>
    <p class="hint" id="out"></p>
    <p class="label after">where</p>
    <div class="hint">${escape(child.dir ?? "")}</div>
  </section>
</main>
<footer class="bar foot"><span>child project of gemu</span><span>ayamai · ikari</span></footer>
<script>
  document.getElementById("launch").addEventListener("click", function () {
    var out = document.getElementById("out");
    out.textContent = "launching…";
    fetch("${BASE}/api/launch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cockpit": "1" },
      body: JSON.stringify({ kind: "emulator", id: ${JSON.stringify(child.emulator?.key ?? child.id)} })
    }).then(function (r) { return r.json(); }).then(function (d) {
      out.textContent = d.ok ? "ok · " + d.ran : "fail · " + d.error;
    });
  });
</script>
</body></html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (BASE && url.pathname.startsWith(BASE)) url.pathname = url.pathname.slice(BASE.length) || "/";

  if (req.method === "GET" && url.pathname === "/api/state") {
    const data = await library.get();
    const ours = children().map((child) => ({
      id: child.id,
      displayId: `${child.parent}/${child.id}`,
      name: child.name,
      systems: child.emulator?.systems ?? [],
      upstream: child.upstream?.repo ?? "",
      license: child.upstream?.license ?? "",
      tag: child.upstream?.tag ?? "",
      fork: child.fork?.repo ?? "",
      patches: patchesFor(child).length,
      exe: child.emulator?.exe ?? "",
      binary: Boolean(child.emulator?.exe) && existsSync(toUnix(child.emulator.exe)),
    }));
    send(res, 200, { ...data, children: ours, mode: readMode(dataRoot()).mode });
    return;
  }

  const coverMatch = /^\/cover\/(\d+)\/?$/.exec(url.pathname);
  if (req.method === "GET" && coverMatch) { await cover(res, coverMatch[1], { refresh: url.searchParams.has("refresh") }); return; }

  if (url.pathname === "/templeos" || url.pathname === "/templeos/") {
    res.writeHead(302, { location: "/gemu/system/templeos/" });
    res.end();
    return;
  }

  const systemMatch = /^\/system\/([a-z0-9-]+)\/?$/.exec(url.pathname);
  if (req.method === "GET" && systemMatch) {
    if (!SYSTEMS[systemMatch[1]]) { send(res, 404, { error: "no such system" }); return; }
    try { send(res, 200, readFileSync(path.join(HERE, "public/system/index.html"), "utf8"), "text/html; charset=utf-8"); }
    catch { send(res, 500, "the system page is missing", "text/plain; charset=utf-8"); }
    return;
  }

  const systemState = /^\/system\/([a-z0-9-]+)\/state$/.exec(url.pathname);
  if (systemState) {
    const system = SYSTEMS[systemState[1]];
    if (!system) { send(res, 404, { error: "no such system" }); return; }
    const iso = systemIso(systemState[1]);
    let bytes = 0;
    try { bytes = readFileSync(iso).length; } catch { bytes = 0; }
    const qemu = existsSync(toUnix(QEMU));
    send(res, 200, {
      id: systemState[1],
      label: system.label, title: system.title, jp: system.jp, blurb: system.blurb, note: system.note,
      image: { exists: bytes > 0, bytes, name: system.iso },
      qemu, disk: Boolean(system.disk), ready: bytes > 0 && qemu,
    });
    return;
  }

  const systemLaunch = /^\/system\/([a-z0-9-]+)\/launch$/.exec(url.pathname);
  if (req.method === "POST" && systemLaunch) {
    if (req.headers["x-cockpit"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    const system = SYSTEMS[systemLaunch[1]];
    if (!system) { send(res, 404, { error: "no such system" }); return; }
    const iso = systemIso(systemLaunch[1]);
    if (!existsSync(iso)) { send(res, 409, { ok: false, error: "no image in the vault" }); return; }
    if (!existsSync(toUnix(QEMU))) { send(res, 409, { ok: false, error: "qemu is not installed" }); return; }

    let disk = null;
    if (system.disk) {
      const diskPath = path.join(VAULT, "system", system.disk);
      if (!existsSync(diskPath)) {
        await new Promise((resolve) => {
          const maker = spawn("cmd.exe", ["/c", QEMU_IMG, "create", "-f", "qcow2", toWindows(diskPath), String(system.diskGb ?? 8) + "G"],
            { stdio: "ignore" });
          maker.on("error", () => resolve());
          maker.on("exit", () => resolve());
          setTimeout(resolve, 4000);
        });
      }
      disk = toWindows(diskPath);
    }

    const { command, args } = systemCommand(system, toWindows(iso), disk);
    spawn("cmd.exe", ["/c", "start", "", command, ...args], { detached: true, stdio: "ignore" }).unref();
    send(res, 202, { ok: true, command: command + " " + args.join(" ") });
    return;
  }

  if (url.pathname === "/itch" || url.pathname === "/itch/") {
    try { send(res, 200, readFileSync(path.join(HERE, "public/itch/index.html"), "utf8"), "text/html; charset=utf-8"); }
    catch { send(res, 500, "the itch page is missing", "text/plain; charset=utf-8"); }
    return;
  }

  if (url.pathname === "/itch/state") {
    const catalog = itchCatalog({ force: url.searchParams.has("refresh") });
    const roots = catalog.roots;
    const inbox = catalog.inbox;
    const zips = [];
    if (inbox && existsSync(inbox)) {
      for (const name of readdirSync(inbox)) {
        if (!/\.zip$/i.test(name)) continue;
        const file = path.join(inbox, name);
        const entries = listZip(file);
        zips.push({ file, name, bytes: existsSync(file) ? readFileSync(file).length : 0, entries: entries.length, web: entries.some((entry) => /index\.html$/i.test(entry) || /\.html$/i.test(entry)) });
      }
    }
    send(res, 200, {
      games: catalog.games,
      roots: catalog.roots,
      duplicates: catalog.duplicates,
      inbox,
      zips,
      ruffle: existsSync(path.join(HERE, "public/ruffle/ruffle.js")) && (() => {
        try { return readdirSync(path.join(HERE, "public/ruffle")).some((file) => file.endsWith(".wasm")); } catch { return false; }
      })(),
      itchClient: existsSync(ROOTS.itchDir),
      itchApps: ROOTS.itchDir,
    });
    return;
  }

  if (url.pathname.startsWith("/itch/game/")) {
    const rest = decodeURIComponent(url.pathname.slice("/itch/game/".length));
    const slash = rest.indexOf("/");
    const slug = slash === -1 ? rest : rest.slice(0, slash);
    const relative = slash === -1 ? "" : rest.slice(slash + 1);
    const game = itchCatalog().games.find((entry) => entry.id === slug);
    if (!game || game.kind !== "web") { res.writeHead(404, { "content-type": "text/plain" }); res.end("no such game"); return; }
    if (!serveGameFile(req, res, game.root, relative || game.entry)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not here");
    }
    return;
  }

  if (url.pathname.startsWith("/itch/play/")) {
    const slug = decodeURIComponent(url.pathname.slice("/itch/play/".length)).replace(/\/$/, "");
    const game = itchCatalog().games.find((entry) => entry.id === slug);
    if (!game) { res.writeHead(404, { "content-type": "text/plain" }); res.end("no such game"); return; }
    send(res, 200, playerPage(game), "text/html; charset=utf-8");
    return;
  }

  if (url.pathname.startsWith("/itch/ruffle/")) {
    const name = decodeURIComponent(url.pathname.slice("/itch/ruffle/".length));
    const dir = path.join(HERE, "public/ruffle");
    const file = path.join(dir, name);
    // a whitelist of names in one folder, never a joined path
    const inside = path.relative(dir, file);
    if (!name || inside.startsWith("..") || path.isAbsolute(inside) || !existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not here");
      return;
    }
    const type = name.endsWith(".wasm") ? "application/wasm" : name.endsWith(".js") ? "text/javascript; charset=utf-8" : "application/octet-stream";
    sendBytes(res, readFileSync(file), type);
    return;
  }

  if (req.method === "POST" && url.pathname === "/itch/launch") {
    if (req.headers["x-cockpit"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    const body = await new Promise((resolve) => { let text = ""; req.on("data", (chunk) => { text += chunk; }); req.on("end", () => { try { resolve(JSON.parse(text || "{}")); } catch { resolve({}); } }); });
    const game = itchCatalog({ force: true }).games.find((entry) => entry.id === body?.id);
    if (!game) { send(res, 404, { ok: false, error: "no such game" }); return; }
    if (game.kind === "web" || game.kind === "flash") { send(res, 409, { ok: false, error: "that one plays in the browser" }); return; }
    const { command, args } = itchLaunch(game);
    if (!command) { send(res, 409, { ok: false, error: args ?? "cannot launch" }); return; }
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
    send(res, 202, { ok: true, command: command + " " + args.join(" ") });
    return;
  }

  if (req.method === "POST" && url.pathname === "/itch/install") {
    if (req.headers["x-cockpit"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    const body = await new Promise((resolve) => { let text = ""; req.on("data", (chunk) => { text += chunk; }); req.on("end", () => { try { resolve(JSON.parse(text || "{}")); } catch { resolve({}); } }); });
    const roots = itchRoots(dataRoot());
    const inbox = inboxOf(roots);
    if (!inbox || !body?.name || body.name.includes("/") || !/\.zip$/i.test(body.name)) { send(res, 400, { ok: false, error: "name a zip in the inbox" }); return; }
    const result = installZip(path.join(inbox, body.name), { vault: path.join(VAULT, "itch") });
    send(res, result.ok ? 202 : 400, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/itch/client") {
    if (req.headers["x-cockpit"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    spawn("cmd.exe", ["/c", "start", "", "winget", "install", "--id", "ItchIo.Itch", "--accept-package-agreements", "--accept-source-agreements"], { detached: true, stdio: "ignore" }).unref();
    send(res, 202, { ok: true, command: "winget install --id ItchIo.Itch" });
    return;
  }

  if (url.pathname === "/handheld" || url.pathname.startsWith("/handheld/")) {
    proxyHandheld(req, res, url.pathname.replace("/handheld", "") || "/");
    return;
  }

  // /gemu/<id>/ — one emulator's page
  const childMatch = /^\/([a-z0-9-]+)\/?$/.exec(url.pathname);
  if (req.method === "GET" && childMatch) {
    const child = children().find((entry) => entry.id === childMatch[1]);
    if (!child) { send(res, 404, { error: "no such emulator", known: children().map((entry) => entry.id) }); return; }
    send(res, 200, childPage(child), "text/html; charset=utf-8");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rescan") {
    if (req.headers["x-cockpit"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    const data = await library.get({ force: true });
    send(res, 200, { ok: true, total: data.total, at: data.at });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/roms") {
    const system = String(url.searchParams.get("system") ?? "");
    const relative = String(url.searchParams.get("path") ?? "");
    if (!system) { send(res, 400, { error: "system is required" }); return; }
    const listing = listRomDir(path.join(ROOTS.rom, system), relative);
    send(res, listing.ok ? 200 : 400, listing);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/launch") {
    if (req.headers["x-cockpit"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    const body = await readJson(req);
    const data = await library.get();

    // Only entries the library knows about may run: the request names a kind and
    // an id, never an executable path from the browser.
    const known = [];
    for (const section of data.sections) for (const game of section.games) known.push(game);

    let entry = null;
    if (body?.kind === "rom") {
      const system = String(body.system ?? "");
      const emulator = known.find((game) => game.kind === "system" && game.name === system)?.emulator;
      const exe = data.sections.flatMap((section) => section.games).find((game) => game.kind === "emulator" && game.name === emulator)?.exe;
      if (!exe) { send(res, 200, { ok: false, error: `no emulator covers ${system}` }); return; }
      const file = path.join(ROOTS.rom, system, String(body.rom ?? ""));
      if (!existsSync(file)) { send(res, 200, { ok: false, error: "no such rom" }); return; }
      entry = { kind: "rom", exe, rom: file, name: String(body.rom ?? "") };
    } else if (body?.kind === "emulator") {
      entry = known.find((game) => game.kind === "emulator" && String(game.id) === String(body.id)) ?? null;
    } else if (body?.kind === "folder") {
      const row = known.find((game) => game.kind === "system" && game.name === String(body.id));
      if (!row) { send(res, 200, { ok: false, error: "unknown system" }); return; }
      entry = { kind: "folder", id: row.name, name: row.name, folder: row.name };
    } else {
      entry = known.find((game) => String(game.kind) === String(body?.kind) && String(game.id) === String(body?.id)) ?? null;
    }

    if (!entry) { send(res, 200, { ok: false, error: "unknown game" }); return; }
    const result = launch(entry, { romRoot: ROOTS.rom });
    send(res, 200, { ...result, kind: entry.kind, id: entry.id, name: entry.name });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/handheld") {
    if (req.headers["x-cockpit"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    const body = await readJson(req);
    const system = String(body?.system ?? "");
    const file = path.join(ROOTS.rom, system, String(body?.rom ?? ""));
    if (!system || !existsSync(file)) { send(res, 200, { ok: false, error: "no such rom" }); return; }
    startHandheld(file);
    await new Promise((resolve) => setTimeout(resolve, 900));
    send(res, 200, { ok: true, at: file });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    send(res, 200, PAGE, "text/html; charset=utf-8");
    return;
  }

  send(res, 404, { error: "not found" }, "text/plain; charset=utf-8");
});

// Listen only when run, so the module can be imported by its tests.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) server.listen(PORT, "127.0.0.1", () => console.log(`gemu: http://127.0.0.1:${PORT}${BASE}`));
