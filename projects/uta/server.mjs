// uta — 歌. One library, one queue, one next song you can explain.
//
// Two kinds of track: owned (a file on the vault, we play it) and referenced
// (a Spotify/YouTube link, we remember it and open theirs).
import { createServer } from "node:http";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { brand } from "../../ui/brand.mjs";
import {
  MUSIC_DIR, detectLink, fromOembed, linkId, oembedUrl, scanLibrary,
} from "./library.mjs";
import { chooseNext } from "./recommend.mjs";
import { cancel as cancelScan, cachedIndex, findTrack, libraryPage, readIndex, scan, status as scanStatus, trackId } from "./scanner.mjs";
import { authorizeUrl, completeConnect, describe, fetchSeed, pkce, readStore, storePath, writeStore } from "./spotify.mjs";

const PORT = Number(process.env.PORT_OVERRIDE ?? 4670);
const BASE = (process.env.BASE_PREFIX ?? "").replace(/\/$/, "");
const DATA = path.join(process.env.AYAMAI_DATA ?? path.join(process.env.HOME ?? ".", ".local/share/ayamai"), "uta");
const PLAYS = path.join(DATA, "plays.jsonl");
const LINKS = path.join(DATA, "links.json");
const SPOTIFY = storePath(DATA);
// A local config file, so the client id survives a restart and never enters git.
function readConfig(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; }
}
const CONFIG = readConfig(path.join(DATA, "config.json"));
const SPOTIFY_CLIENT_ID = process.env.UTA_SPOTIFY_CLIENT_ID ?? CONFIG.spotifyClientId ?? "";
const SPOTIFY_SECRET = process.env.UTA_SPOTIFY_CLIENT_SECRET ?? CONFIG.spotifyClientSecret ?? "";
// Spotify only accepts https or a loopback redirect; the name will be refused.
const SPOTIFY_REDIRECT = process.env.UTA_SPOTIFY_REDIRECT ?? CONFIG.spotifyRedirect ?? "http://127.0.0.1:25222/uta/api/spotify/callback";

const TYPES = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".flac": "audio/flac", ".ogg": "audio/ogg", ".wav": "audio/wav" };
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ---- storage: plain files, readable with cat --------------------------- */

export function readPlays(file = PLAYS) {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

export function appendPlay(play, file = PLAYS) {
  mkdirSync(path.dirname(file), { recursive: true });
  // one line, appended: a whole-file rewrite is O(n²) and a crash mid-write
  // loses the history it was rewriting
  appendFileSync(file, JSON.stringify({ ...play, at: Date.now() }) + "\n");
  return true;
}

export function readLinks(file = LINKS) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return []; }
}

export function writeLinks(links, file = LINKS) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(links, null, 2) + "\n");
  renameSync(temp, file);
}

/* ---- media ------------------------------------------------------------- */

/** Serve a file with Range support: seeking does not work without it. */
export function serveFile(req, res, filePath, size = null) {
  let stat;
  try { stat = size === null ? statSync(filePath) : { size }; } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const total = stat.size;
  const type = TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("content-type", type);

  const header = req.headers.range;
  if (!header) {
    res.writeHead(200, { "content-length": total });
    createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) {
    res.writeHead(416, { "content-range": `bytes */${total}` });
    res.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  if (start >= total || end < start) {
    res.writeHead(416, { "content-range": `bytes */${total}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    "content-range": `bytes ${start}-${end}/${total}`,
    "content-length": end - start + 1,
  });
  createReadStream(filePath, { start, end }).pipe(res);
}

/** Resolve a library path, refusing anything outside the music directory. */
export function resolveTrack(relPath, root = MUSIC_DIR) {
  const absolute = path.resolve(root, relPath);
  const inside = path.relative(root, absolute);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return existsSync(absolute) ? absolute : null;
}

/* ---- api --------------------------------------------------------------- */

const json = (res, code, payload) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
};

const readBody = (req, limit = 8192) => new Promise((resolve) => {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { body += chunk; if (body.length > limit) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve(null); } });
  req.on("error", () => resolve(null));
});

async function saveLink(url) {
  const target = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(target)) return { ok: false, message: "that is not a link" };
  const { service, externalId } = detectLink(target);
  const id = linkId(service, externalId);
  const links = readLinks();
  if (links.some((link) => link.id === id)) return { ok: false, message: "already saved" };

  let metadata = { title: null, artist: null, thumb: null };
  const endpoint = oembedUrl(service, target);
  if (endpoint) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(4000), headers: { "user-agent": "ayamai-uta" } });
      if (response.ok) metadata = fromOembed(await response.json());
    } catch { /* the link is still worth keeping */ }
  }

  const link = {
    id, kind: "reference", service, url: target,
    title: metadata.title ?? target,
    artist: metadata.artist,
    thumb: metadata.thumb,
    metadata: Boolean(metadata.title),
    added: Date.now(),
  };
  writeLinks([link, ...links]);
  return { ok: true, link };
}

/* ---- the page ---------------------------------------------------------- */

export function page() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>uta · ayamai</title>
<link rel="icon" href="/ui/brand/favicon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/ui/ui.css" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital@0;1&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500&display=swap" />
<style>
  /* the palette and the control face come from /ui/ui.css */
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;background:var(--void);color:var(--pale);font:13px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}
  .bar{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:14px 22px;border-bottom:1px solid var(--line)}
  .bar .name{display:flex;align-items:baseline;gap:2px}
  .bar h1{margin:0;font:400 20px var(--serif);letter-spacing:.1em}
  .bar .jp{color:var(--rei);font:400 11px var(--mono);letter-spacing:.4em;margin-left:10px}
  .bar .meta{color:var(--dim);font:400 10px var(--mono);letter-spacing:.18em;text-transform:uppercase}
  main{display:grid;grid-template-columns:1fr 380px;height:calc(100vh - 53px - 76px)}
  .col{overflow-y:auto;padding:6px 0}
  .col + .col{border-left:1px solid var(--line)}
  .label{padding:14px 22px 6px;color:var(--dim);font:400 9px var(--mono);letter-spacing:.22em;text-transform:uppercase}
  .row{display:flex;gap:12px;align-items:baseline;padding:8px 22px;border-bottom:1px solid rgba(29,34,51,.55);cursor:pointer}
  .row:hover{background:rgba(32,42,58,.35)}
  .row.on{background:rgba(255,59,92,.08)}
  .row .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .a{color:var(--muted);font-size:12px;max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .tag{color:var(--dim);font:9px var(--mono);letter-spacing:.1em}
  .empty{padding:18px 22px;color:var(--dim);font-size:12px;line-height:1.7}
  .empty code{color:var(--rei)}
  .add{display:flex;gap:8px;padding:12px 22px}
  .add .input{flex:1;width:auto}
  .label .right{float:right;text-transform:none;letter-spacing:0}
  .finder{display:flex;gap:6px;margin:0 0 10px;align-items:center}
  .finder .input{flex:1;min-width:0;font:400 11px var(--mono);letter-spacing:.06em;padding:7px 10px}
  .finder input::placeholder{color:var(--dim);text-transform:uppercase;letter-spacing:.14em;font-size:9px}
  .hint.small{font:10px var(--mono);letter-spacing:.08em;color:var(--dim);margin:0 0 8px}
  .hint.small.running{color:var(--pale)}
  .link .svc{color:var(--dim);font:9px var(--mono);letter-spacing:.16em;text-transform:uppercase}
  .link a{color:var(--pale);text-decoration:none}
  .link a:hover{color:var(--pale)}
  .link .rm{background:none;border:0;color:var(--dim);cursor:pointer;font:11px var(--mono);padding:0 4px}
  .link .rm:hover{color:var(--red)}
  .add .state{flex:1;font:10px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
  .add a.btn{background:none;border:1px solid var(--line);border-radius:4px;color:var(--pale);padding:8px 14px;
    font:500 10px var(--mono);letter-spacing:.2em;text-transform:uppercase;cursor:pointer;text-decoration:none}
  .add a.btn:hover{border-color:var(--red)}
  footer{position:fixed;inset:auto 0 0;display:grid;grid-template-columns:1fr auto;gap:18px;align-items:center;
    padding:12px 22px;border-top:1px solid var(--line);background:rgba(11,13,20,.97)}
  .now{min-width:0}
  .now b{font-weight:400;color:var(--pale)}
  .now .why{color:var(--dim);font:10px var(--mono);letter-spacing:.1em;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  audio{width:100%;height:34px;color-scheme:dark;filter:grayscale(1) contrast(.9) brightness(.85);border-radius:4px}
  .controls{display:flex;gap:10px;align-items:center}
  @media (max-width:860px){main{grid-template-columns:1fr;height:auto}.col + .col{border-left:0;border-top:1px solid var(--line)}footer{position:static}}
</style></head>
<body>
  <div class="bar">
    <div class="name"><h1>uta</h1><span class="jp">歌</span></div>
    <div class="meta" id="meta">reading the library…</div>
  </div>

  <main>
    <section class="col">
      <p class="label">library <span class="right"><button class="btn ghost sm" id="scan">scan</button></span></p>
      <p class="hint small" id="scan-state"></p>
      <div class="finder">
        <input class="input" id="find" placeholder="search title, artist, album" spellcheck="false" />
        <span class="seg" id="sort"><button data-sort="title" aria-pressed="true">title</button><button data-sort="artist" aria-pressed="false">artist</button></span>
      </div>
      <p class="hint small" id="count"></p>
      <div id="library"><p class="empty">reading…</p></div>
      <button class="btn ghost sm" id="more" hidden>load more</button>
    </section>
    <section class="col">
      <p class="label">saved</p>
      <div class="add">
        <input class="input" id="url" placeholder="paste a spotify or youtube link" spellcheck="false" />
        <button class="btn sm" id="save">save</button>
      </div>
      <div id="links"></div>
      <p class="label after">spotify</p>
      <div class="add" id="spotify-line">
        <span class="state" id="spotify-state">checking…</span>
      </div>
    </section>
  </main>

  <footer>
    <div class="now">
      <div id="title"><b>nothing playing</b></div>
      <div class="why" id="why"></div>
      <audio id="audio" controls preload="none"></audio>
    </div>
    <div class="controls">
      <button class="btn sm" id="next">next →</button>
    </div>
  </footer>

<script>
(function () {
  var BASE = ${JSON.stringify(BASE)};
  var library = [];
  var current = null;
  var started = 0;

  var audio = document.getElementById("audio");
  var list = document.getElementById("library");
  var linksHost = document.getElementById("links");
  var title = document.getElementById("title");
  var why = document.getElementById("why");
  var meta = document.getElementById("meta");

  function api(pathname, options) {
    return fetch(BASE + pathname, options).then(function (response) { return response.json(); });
  }

  function row(track) {
    var el = document.createElement("div");
    el.className = "row" + (current && current.id === track.id ? " on" : "");
    el.dataset.id = track.id;

    var t = document.createElement("span");
    t.className = "t";
    t.textContent = track.title;
    el.appendChild(t);

    var a = document.createElement("span");
    a.className = "a";
    a.textContent = track.artist || "—";
    el.appendChild(a);

    var tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = track.tags === "id3" ? "" : "filename";
    el.appendChild(tag);

    el.addEventListener("click", function () { play(track); });
    return el;
  }

  var scanTimer = null;

  function scanState() {
    return api("/api/scan").then(function (state) {
      var line = document.getElementById("scan-state");
      if (state.running) {
        line.className = "hint small running";
        line.textContent = state.line || "scanning…";
        if (!scanTimer) scanTimer = setInterval(function () {
          scanState().then(function (next) { if (!next.running) location.reload(); });
        }, 1500);
      } else {
        line.className = "hint small";
        if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      }
      return state;
    });
  }

  var moveToVault = false;
  function startScan() {
    api("/api/scan", { method: "POST", headers: { "x-cockpit": "1", "content-type": "application/json" }, body: JSON.stringify({ mode: moveToVault ? "move" : "index" }) })
      .then(function (answer) {
        if (!answer || !answer.ok) { document.getElementById("scan-state").textContent = "a scan is already running"; }
        scanState();
      });
  }

  var total = 0, more = false, query = "", sort = "title", loading = false;

  function load(reset) {
    if (loading) return;
    loading = true;
    if (reset) { offset = 0; }
    var params = "?limit=50&offset=" + offset + "&sort=" + encodeURIComponent(sort) + (query ? "&q=" + encodeURIComponent(query) : "");
    api("/api/library" + params).then(function (answer) {
      library = reset ? answer.tracks : library.concat(answer.tracks);
      total = answer.total;
      more = answer.more;
      offset += answer.tracks.length;
      loading = false;
      render(answer);
    }).catch(function () { loading = false; });
  }

  function renderCount(answer) {
    var label = document.getElementById("count");
    var found = library.length.toLocaleString();
    var all = (total || 0).toLocaleString();
    label.textContent = query
      ? found + " of " + all + " matching “" + query + "”"
      : "Showing " + found + " of " + all + (answer && answer.junk ? " · " + answer.junk.toLocaleString() + " skipped" : "");
    document.getElementById("more").hidden = !more;
    document.getElementById("more").textContent = more ? "load " + Math.min(50, (total || 0) - library.length) + " more" : "load more";
    meta.textContent = ((answer && answer.libraryTotal) || (total || 0)).toLocaleString() + " owned";
    var state = document.getElementById("scan-state");
    if (state && answer && answer.scan && answer.scan.running) state.classList.add("running");
    else if (state) state.classList.remove("running");
  }

  function render(answer) {
    list.innerHTML = "";
    if (!library.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      if (query && total === 0) {
        empty.textContent = "nothing matches “" + query + "”.";
        var clear = document.createElement("button");
        clear.className = "scan";
        clear.textContent = "clear";
        clear.addEventListener("click", function () { var box = document.getElementById("find"); box.value = ""; query = ""; load(true); });
        empty.appendChild(document.createElement("br"));
        empty.appendChild(clear);
        list.appendChild(empty);
        renderCount();
        return;
      }
      empty.innerHTML = "nothing indexed yet.";
      var press = document.createElement("button");
      press.className = "scan";
      press.textContent = "scan this machine";
      press.addEventListener("click", startScan);
      empty.appendChild(document.createElement("br"));
      empty.appendChild(press);
      list.appendChild(empty);

      var opt = document.createElement("label");
      opt.className = "hint small";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.addEventListener("change", function () { moveToVault = box.checked; });
      opt.appendChild(box);
      opt.appendChild(document.createTextNode(" move the audio into the vault (Y:) instead of indexing it where it sits"));
      list.appendChild(opt);
      return;
    }
    library.forEach(function (track) { list.appendChild(row(track)); });
    renderCount(answer);
  }

  function play(track) {
    // the previous one counts as skipped if it never got a third of the way
    if (current && current.id !== track.id && audio.duration && audio.currentTime < audio.duration / 3) {
      api("/api/plays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: current.id, artist: current.artist, skipped: true, ms: Math.round(audio.currentTime * 1000) })
      });
    }
    current = track;
    started = Date.now();
    // once per selection: the play event fires again on every resume
    api("/api/plays", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: track.id, artist: track.artist, skipped: false, ms: 0 })
    });
    audio.src = track.url || (BASE + "/media/" + track.path.split("/").map(encodeURIComponent).join("/"));
    audio.play().catch(function () {});
    title.innerHTML = "";
    var b = document.createElement("b");
    b.textContent = track.title;
    title.appendChild(b);
    if (track.artist) title.appendChild(document.createTextNode(" · " + track.artist));
    why.textContent = "";
    render();
  }

  // how long it was actually listened to, written when the track ends
  audio.addEventListener("ended", function () {
    if (!current) return;
    api("/api/plays", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: current.id, artist: current.artist, skipped: false, ms: Math.round((audio.duration || 0) * 1000) })
    });
  });

  function next() {
    api("/api/next").then(function (answer) {
      if (!answer.track) { why.textContent = answer.why; return; }
      play(answer.track);
      why.textContent = answer.why;
    });
  }
  document.getElementById("next").addEventListener("click", next);

  document.getElementById("save").addEventListener("click", function () {
    var input = document.getElementById("url");
    var url = input.value.trim();
    if (!url) return;
    api("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url })
    }).then(function (result) {
      if (!result.ok) { input.value = ""; input.placeholder = result.message; return; }
      input.value = "";
      loadLinks();
    });
  });

  function linkRow(link) {
    var el = document.createElement("div");
    el.className = "row link";
    var svc = document.createElement("span");
    svc.className = "svc";
    svc.textContent = link.service;
    el.appendChild(svc);

    var a = document.createElement("a");
    a.className = "t";
    a.href = link.url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = link.title;
    el.appendChild(a);

    var rm = document.createElement("button");
    rm.className = "rm";
    rm.textContent = "×";
    rm.title = "remove";
    rm.addEventListener("click", function (event) {
      event.preventDefault();
      api("/api/links/" + encodeURIComponent(link.id), { method: "DELETE" }).then(loadLinks);
    });
    el.appendChild(rm);
    return el;
  }

  function loadLinks() {
    api("/api/links").then(function (answer) {
      linksHost.innerHTML = "";
      if (!answer.links.length) {
        var empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "nothing saved yet — paste a link above.";
        linksHost.appendChild(empty);
        return;
      }
      answer.links.forEach(function (link) { linksHost.appendChild(linkRow(link)); });
      meta.textContent = library.length + " owned · " + answer.links.length + " saved";
    });
  }

  function loadSpotify() {
    api("/api/spotify/status").then(function (status) {
      var host = document.getElementById("spotify-line");
      document.getElementById("spotify-state").textContent = status.line;
      var old = host.querySelector("a.btn");
      if (old) old.remove();
      if (status.state === "connected") return;
      var a = document.createElement("a");
      a.className = "btn";
      a.textContent = status.configured ? "connect" : "how";
      a.href = status.configured ? BASE + "/api/spotify/start" : "https://developer.spotify.com/dashboard";
      if (!status.configured) a.target = "_blank";
      a.title = status.configured ? "authorise uta to read your top artists" : "create an app, then set UTA_SPOTIFY_CLIENT_ID";
      host.appendChild(a);
    }).catch(function () {});
  }

  load(true);
  loadLinks();
  loadSpotify();
  document.getElementById("scan").addEventListener("click", startScan);
  scanState();

  var findTimer = null;
  document.getElementById("find").addEventListener("input", function (event) {
    clearTimeout(findTimer);
    var value = event.target.value;
    findTimer = setTimeout(function () { query = value.trim(); load(true); }, 250);
  });
  document.getElementById("more").addEventListener("click", function () { load(false); });
  Array.prototype.forEach.call(document.querySelectorAll("#sort button"), function (button) {
    button.addEventListener("click", function () {
      sort = button.dataset.sort;
      Array.prototype.forEach.call(document.querySelectorAll("#sort button"), function (other) {
        other.setAttribute("aria-pressed", String(other === button));
      });
      load(true);
    });
  });
})();
</script>
</body></html>`;
}

/* ---- the server -------------------------------------------------------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === BASE + "/" || url.pathname === BASE) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page());
    return;
  }

  if (url.pathname === `${BASE}/api/library`) {
    const index = cachedIndex();
    const result = libraryPage(index.tracks ?? [], {
      limit: url.searchParams.get("limit"),
      offset: url.searchParams.get("offset"),
      q: url.searchParams.get("q") ?? "",
      sort: url.searchParams.get("sort") ?? "title",
    });
    const tracks = result.tracks.map((track) => ({ ...track, url: `${BASE}/media/` + encodeURIComponent(track.id) }));
    json(res, 200, {
      dir: index.roots?.map((root) => root.path) ?? [],
      tracks,
      total: result.total,
      libraryTotal: (index.tracks ?? []).length,
      junk: index.junk ?? 0,
      offset: result.offset,
      limit: result.limit,
      more: result.more,
      query: result.query,
      sort: result.sort,
      links: readLinks(),
      scannedAt: index.at ?? null,
      files: index.files ?? 0,
      found: index.found ?? 0,
      scan: scanStatus(),
    });
    return;
  }

  if (url.pathname === `${BASE}/api/scan` && req.method === "GET") {
    const index = cachedIndex();
    json(res, 200, { ...scanStatus(), scannedAt: index.at ?? null, found: index.found ?? 0 });
    return;
  }

  if (url.pathname === `${BASE}/api/scan` && req.method === "POST") {
    if (req.headers["x-cockpit"] !== "1") { json(res, 403, { error: "untrusted request" }); return; }
    if (scanStatus().running) { json(res, 409, { ok: false, ...scanStatus() }); return; }
    const body = await readBody(req).catch(() => null);
    const mode = body?.mode === "move" ? "move" : "index";
    json(res, 202, { ok: true, mode, ...scanStatus() });
    // the walk runs after the answer: a scan is minutes long, not a request
    scan({ incremental: true, mode }).catch((error) => console.error("uta: scan failed", error));
    return;
  }

  if (url.pathname === `${BASE}/api/scan/cancel` && req.method === "POST") {
    if (req.headers["x-cockpit"] !== "1") { json(res, 403, { error: "untrusted request" }); return; }
    json(res, 200, cancelScan());
    return;
  }

  if (url.pathname === `${BASE}/api/links` && req.method === "GET") {
    json(res, 200, { links: readLinks() });
    return;
  }

  if (url.pathname === `${BASE}/api/links` && req.method === "POST") {
    const body = await readBody(req);
    const result = await saveLink(body?.url);
    json(res, result.ok ? 201 : 400, result);
    return;
  }

  if (url.pathname.startsWith(`${BASE}/api/links/`) && req.method === "DELETE") {
    const id = decodeURIComponent(url.pathname.slice(`${BASE}/api/links/`.length));
    const links = readLinks();
    const next = links.filter((link) => link.id !== id);
    writeLinks(next);
    json(res, 200, { ok: next.length !== links.length, links: next });
    return;
  }

  if (url.pathname === `${BASE}/api/plays` && req.method === "POST") {
    const body = await readBody(req);
    if (!body?.id) { json(res, 400, { ok: false, message: "a play needs an id" }); return; }
    appendPlay({ id: String(body.id), artist: body.artist ?? null, skipped: Boolean(body.skipped), ms: Number(body.ms) || 0 });
    json(res, 202, { ok: true });
    return;
  }

  if (url.pathname === `${BASE}/api/spotify/status`) {
    json(res, 200, { ...describe(readStore(SPOTIFY), { clientId: SPOTIFY_CLIENT_ID }), redirect: SPOTIFY_REDIRECT, configured: Boolean(SPOTIFY_CLIENT_ID) });
    return;
  }

  if (url.pathname === `${BASE}/api/spotify/start`) {
    if (!SPOTIFY_CLIENT_ID) { json(res, 409, { ok: false, message: "set UTA_SPOTIFY_CLIENT_ID first" }); return; }
    const { verifier, challenge } = pkce();
    const state = Math.random().toString(36).slice(2, 12);
    const previous = readStore(SPOTIFY) ?? {};
    writeStore(SPOTIFY, { ...previous, pending: { verifier, state, at: Date.now() } });
    res.writeHead(302, { location: authorizeUrl({ clientId: SPOTIFY_CLIENT_ID, redirectUri: SPOTIFY_REDIRECT, challenge, state }) });
    res.end();
    return;
  }

  if (url.pathname === `${BASE}/api/spotify/callback`) {
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const error = url.searchParams.get("error") ?? "";
    const back = (query) => { res.writeHead(302, { location: BASE + "/?" + query }); res.end(); };
    if (error) return back("spotify=" + encodeURIComponent(error));
    const store = readStore(SPOTIFY);
    if (!store?.pending || store.pending.state !== state || !code) return back("spotify=state");

    try {
      const tokens = await completeConnect({
        clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_SECRET, code,
        verifier: store.pending.verifier, redirectUri: SPOTIFY_REDIRECT,
      });
      const seed = await fetchSeed(tokens.access_token);
      writeStore(SPOTIFY, {
        refreshToken: tokens.refresh_token ?? null,
        accessToken: tokens.access_token ?? null,
        expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
        seed,
        connectedAt: Date.now(),
      });
      return back("spotify=connected");
    } catch (failure) {
      return back("spotify=failed");
    }
  }

  if (req.method === "POST" && url.pathname === `${BASE}/api/spotify/disconnect`) {
    writeStore(SPOTIFY, {});
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === `${BASE}/api/next`) {
    const scan = scanLibrary();
    const store = readStore(SPOTIFY);
    const answer = chooseNext({ tracks: scan.tracks, plays: readPlays(), seed: store?.seed ?? null, now: Date.now() });
    json(res, 200, answer);
    return;
  }

  if (url.pathname.startsWith(`${BASE}/media/`)) {
    const raw = decodeURIComponent(url.pathname.slice(`${BASE}/media/`.length));
    // an index id, not a path: the index is the only thing that can name a file
    const track = trackId(raw) ? findTrack(raw) : null;
    const file = track ? track.path : resolveTrack(raw);
    if (!file) { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
    serveFile(req, res, file);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

// Listen only when run, so the module can be imported by its tests: a file that
// binds a port on import is a file that cannot be unit-tested.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  // the magic: a machine with no index gets scanned without being asked
  if (!(readIndex().found > 0)) {
    console.log("uta: no index yet - scanning this machine");
    scan({ incremental: true }).catch((error) => console.error("uta: scan failed", error));
  }
  server.listen(PORT, process.env.HOST ?? "127.0.0.1", () => {
    console.log(`uta: http://localhost:${PORT}${BASE}/  (music: ${MUSIC_DIR})`);
  });
}
