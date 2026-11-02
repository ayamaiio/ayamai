import { statSync } from "node:fs";
import path from "node:path";
import { brand } from "../../ui/brand.mjs";
import { projectSummary } from "./services.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");

/** A stale stylesheet in a cached tab is always a debugging session. */
function assetVersion() {
  try { return Math.round(statSync(path.join(REPO, "ui", "ui.css")).mtimeMs).toString(36); } catch { return "0"; }
}

// The cockpit page. No framework, no build step, no webfonts.
// It borrows the shared surface kit (ui/ui.css) and adds only what a control
// panel needs: a dense service row, two states of a button, a quiet portrait,
// and a console for the model.
export function renderPage({ hostname = "local", phone = "", startedAt = Date.now() } = {}) {
  return `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="theme-color" content="#0b0d14" />
<meta name="robots" content="noindex,nofollow" />
<title>ayamai — gehirn</title>
<link rel="icon" href="/gehirn/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/gehirn/favicon-32x32.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/gehirn/apple-touch-icon.png" />
<link rel="stylesheet" href="/gehirn/ui/ui.css?v=${assetVersion()}" />
<link rel="stylesheet" href="/ui/brand.css" />
<link rel="icon" href="/ui/brand/favicon.svg" type="image/svg+xml" />
<style>
  body { padding-bottom: 42px; }
  .bar { gap: 20px; }
  .crumbs { display: flex; gap: 8px; align-items: baseline; padding: 9px 22px; border-bottom: 1px solid var(--line);
            font: 10px var(--mono); letter-spacing: .22em; text-transform: uppercase; color: var(--dim); }
  .crumbs a { color: var(--dim); text-decoration: none; }
  .crumbs a:hover { color: var(--pale); }
  .crumbs .here { color: var(--pale); }
  .crumbs .sep { color: var(--line); }
  .hidden { display: none; }
  .link { background: none; border: 0; color: var(--dim); font: 9px var(--mono); letter-spacing: .18em;
          text-transform: uppercase; cursor: pointer; padding: 0 0 0 8px; }
  .link:hover { color: var(--pale); }
  .child { padding: 8px 0; border-bottom: 1px solid var(--line); }
  .child .head { display: flex; gap: 8px; align-items: baseline; cursor: pointer; }
  .child .nm { flex: 1; font-family: var(--mono); font-size: 12px; }
  .child .tag { font: 9px var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--dim);
                max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .child .tag.ours { color: var(--ok); }
  .child .body { display: none; padding: 8px 0 2px 14px; font: 10px/1.7 var(--mono); color: var(--dim); }
  .child.open .body { display: block; }
  .child .body a { color: var(--rei); text-decoration: none; }
  .bar .brand img.mark { width: 17px; height: 17px; object-fit: contain; opacity: .9; align-self: center; }
  .bar .jp { font-family: var(--serif); font-size: 11px; letter-spacing: .42em; color: var(--dim); opacity: .55; align-self: center; }
  .bar .right { display: flex; align-items: center; gap: 14px; }
  .bar .sep { opacity: .35; margin: 0 2px; }

  .grid { min-height: calc(100vh - 57px - 42px); align-items: stretch; }

  /* services ------------------------------------------------------------- */
  .group { font: 500 9px/1 var(--mono); letter-spacing: .28em; text-transform: uppercase;
           color: var(--dim); margin: 18px 0 6px; opacity: .75; }
  .group:first-child { margin-top: 0; }
  .svc { display: grid; grid-template-columns: 12px 1fr 62px 1fr 78px auto; align-items: center;
         gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .svc:last-child { border-bottom: 0; }
  .svc .glyph { width: auto; font-size: 10px; }
  .svc.up .glyph { color: var(--rei); }
  .svc.down .glyph { color: var(--red); opacity: .75; }
  .svc.na .glyph { color: var(--dim); }
  .svc .stale { font: 9px var(--mono); letter-spacing: .16em; text-transform: uppercase; color: #cead9a;
                border: 1px solid currentColor; border-radius: 999px; padding: 1px 6px; align-self: center; }
  .svc .name { font-size: 13px; color: var(--pale); }
  .svc.down .name { color: var(--dim); }
  .svc .port { font-family: var(--mono); font-size: 11px; color: var(--dim); }
  .svc .note { font-family: var(--mono); font-size: 10px; color: var(--dim); opacity: .7;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .svc .lat { font-family: var(--mono); font-size: 10px; color: var(--dim); text-align: right; }
  .svc .act { display: flex; gap: 6px; justify-content: flex-end; }
  .svc .act .btn { padding: 4px 9px; font-size: 11px; }
  .svc.pending .glyph { color: var(--rei); animation: blink 1.1s steps(2, start) infinite; }
  .svc.pending .lat { color: var(--rei); }
  @keyframes blink { 50% { opacity: .2; } }

  .rule { margin-top: 18px; }
  .fill { width: 0; }

  /* actions -------------------------------------------------------------- */
  /* The column must be allowed to be narrower than its longest line. */
  .panel { min-width: 0; }
  .list { min-width: 0; }
  .item { max-width: 100%; }
  /* projects ------------------------------------------------------------- */
  .proj { padding: 12px 0 14px; border-bottom: 1px solid var(--line); }
  .proj:last-child { border-bottom: 0; }
  .proj .top { display: flex; align-items: baseline; gap: 10px; }
  .proj .nm { font: 400 15px/1 "Cormorant Garamond", Georgia, serif; letter-spacing: .16em; text-transform: uppercase;
              color: inherit; text-decoration: none; }
  a.nm:hover, a.nm:focus-visible { color: var(--rei); }
  a.nm:focus-visible { outline: 2px solid var(--rei); outline-offset: 3px; border-radius: 2px; }
  .proj .jp { font: 400 10px/1 "Cormorant Garamond", serif; letter-spacing: .34em; color: var(--dim); }
  .proj .kind { margin-left: auto; font: 500 9px/1 var(--mono); letter-spacing: .2em; text-transform: uppercase; color: var(--dim); }
  .proj .sum { margin: 6px 0 0; font-size: 12px; color: var(--dim); }
  .proj .org { margin: 4px 0 0; font: 10px var(--mono); letter-spacing: .14em; color: var(--dim); opacity: .75; }
  .proj .where { margin: 8px 0 0; font: 11px/1.5 var(--mono); color: var(--dim); overflow-wrap: anywhere; }
  .proj .where button { background: none; border: 0; padding: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  .proj .where button:hover { color: var(--pale); }
  .proj .fresh { margin: 6px 0 0; font: 9px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
  .proj .fresh.neglected { color: #cead9a; }
  .proj .acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
  .proj-run { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .proj-run .chip { font: 9px var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--dim);
                    border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; }
  .proj-run .chip.up { color: #91b7b3; border-color: rgba(145,183,179,.5); }
  .proj-run .chip.part { color: #cead9a; border-color: rgba(206,173,154,.5); }
  .proj-run .chip.down { color: #e5a3a3; border-color: rgba(229,163,163,.45); }
  .proj .acts .btn { padding: 4px 9px; font-size: 10px; }
  .proj .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dim); }
  .proj.up .dot { background: var(--ok); }
  .proj.down .dot { background: var(--red); }

  .item .meta.time { width: 62px; text-align: right; }
  /* A flex child will not shrink below its content without this, so a long
     argv overflowed the panel instead of ellipsising. */
  .item .title { font-family: var(--mono); font-size: 11px; color: var(--dim); min-width: 0; }

  /* portrait ------------------------------------------------------------- */
  .portrait { margin-top: 26px; border: 1px solid var(--line); border-radius: var(--radius-sm);
              overflow: hidden; position: relative; background: #0a0c12; }
  .portrait::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 2px;
                      background: var(--red); z-index: 2; }
  .portrait img { display: block; width: 100%; height: 210px; object-fit: cover;
                  object-position: 62% 22%; filter: grayscale(.45) contrast(1.06) brightness(.82); }
  .portrait figcaption { position: absolute; inset: auto 10px 8px auto; z-index: 2;
                         font: 500 9px/1 var(--mono); letter-spacing: .24em; text-transform: uppercase;
                         color: var(--dim); }

  .bar.foot span { white-space: nowrap; }
  .bar.foot .grow { flex: 1; }

  /* console -------------------------------------------------------------- */
  .palette.hidden { display: none; }
  .palette { position: fixed; inset: 0; z-index: 60; background: rgba(6,8,14,.82);
             display: grid; place-items: start center; padding: 12vh 20px 0; }
  .palette-box { width: min(560px, 100%); border: 1px solid var(--line); border-radius: 8px;
                 background: var(--void); box-shadow: 0 20px 60px rgba(0,0,0,.5); overflow: hidden; }
  .palette .input { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 14px 16px; }
  .palette-list { max-height: 46vh; overflow-y: auto; }
  .palette-item { display: flex; gap: 10px; align-items: baseline; padding: 9px 16px; cursor: pointer;
                  font: 11px var(--mono); color: var(--pale); }
  .palette-item .kind { color: var(--dim); font-size: 9px; letter-spacing: .16em; text-transform: uppercase; width: 58px; flex: none; }
  .palette-item .meta { margin-left: auto; color: var(--dim); font-size: 9px; }
  .palette-item.on, .palette-item:hover { background: rgba(32,42,90,.35); color: var(--pale); }
  .palette-hint { padding: 8px 16px; border-top: 1px solid var(--line); margin: 0; font-size: 9px; }
  .console { border-top: 1px solid var(--line); display: grid; grid-template-columns: 1.15fr 1.35fr 1fr; }
  .console .panel { min-height: 0; }
  .console .wide { grid-column: span 2; border-right: 1px solid var(--line); }
  .field { display: grid; grid-template-columns: 78px 1fr; align-items: center; gap: 10px; margin-bottom: 8px; }
  .field span { font: 500 9px/1 var(--mono); letter-spacing: .22em; text-transform: uppercase; color: var(--dim); }
  .field .input { padding: 6px 9px; font-family: var(--mono); font-size: 11px; }
  .field .input:disabled { opacity: .45; }
  select.input { appearance: none; }
  .row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .hint { font: 400 10px/1.6 var(--mono); color: var(--dim); overflow: hidden; text-overflow: ellipsis; }
  .hint.ok { color: var(--ok); }
  .hint.bad { color: var(--red); }
  textarea.input { font-family: var(--mono); font-size: 12px; line-height: 1.6; resize: vertical; }
  .answer { margin: 0; padding: 14px 16px; min-height: 132px; max-height: 380px; overflow: auto;
            border: 1px solid var(--line); border-radius: var(--radius-sm); background: rgba(11, 13, 20, 0.65);
            font: 400 12px/1.65 var(--mono); color: var(--pale); white-space: pre-wrap; word-break: break-word; }
  .answer.empty { color: var(--dim); font-family: var(--sans); }
  .checks { display: flex; align-items: center; gap: 8px; margin-top: 2px; font: 400 11px/1.6 var(--mono); color: var(--dim); }
  .checks input { accent-color: var(--rei); }

  @media (max-width: 1100px) {
    .grid { grid-template-columns: 1fr; }
    .panel { border-right: 0; border-bottom: 1px solid var(--line); min-height: 0; }
    .svc { grid-template-columns: 12px 1fr 62px auto; }
    .svc .note, .svc .lat { display: none; }
    .portrait { display: none; }
    .palette.hidden { display: none; }
  .palette { position: fixed; inset: 0; z-index: 60; background: rgba(6,8,14,.82);
             display: grid; place-items: start center; padding: 12vh 20px 0; }
  .palette-box { width: min(560px, 100%); border: 1px solid var(--line); border-radius: 8px;
                 background: var(--void); box-shadow: 0 20px 60px rgba(0,0,0,.5); overflow: hidden; }
  .palette .input { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; padding: 14px 16px; }
  .palette-list { max-height: 46vh; overflow-y: auto; }
  .palette-item { display: flex; gap: 10px; align-items: baseline; padding: 9px 16px; cursor: pointer;
                  font: 11px var(--mono); color: var(--pale); }
  .palette-item .kind { color: var(--dim); font-size: 9px; letter-spacing: .16em; text-transform: uppercase; width: 58px; flex: none; }
  .palette-item .meta { margin-left: auto; color: var(--dim); font-size: 9px; }
  .palette-item.on, .palette-item:hover { background: rgba(32,42,90,.35); color: var(--pale); }
  .palette-hint { padding: 8px 16px; border-top: 1px solid var(--line); margin: 0; font-size: 9px; }
  .console { grid-template-columns: 1fr; }
    .console .wide { grid-column: auto; border-right: 0; }
    .field { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <div class="bar">
    <div class="brand">${brand({ tool: "gehirn", jp: "ゲヒルン" })}</div>
    <div class="right">
      <span class="clock"><button id="summary" class="btn ghost sm">checking</button></span>
      <span class="clock"><span id="clock">--:--:--</span></span>
      <span class="clock">LOCAL · ${escapeHtml(hostname)}</span>
      <span class="seg" id="mode"><button data-mode="play" aria-pressed="false">play</button><button data-mode="dev" aria-pressed="true">dev</button></span>
    </div>
  </div>

  <nav class="crumbs" id="crumbs"></nav>

  <div class="grid">
    <section class="panel">
      <p class="label"><span id="projects-label">projects</span> <span class="hint" id="project-counts"></span></p>
      <div id="projects"><p class="empty">reading the catalog…</p></div>
      <div id="children-wrap" class="hidden">
        <p class="label after">children <span class="hint" id="children-count"></span></p>
        <div id="children"></div>
      </div>
      <p class="label after" id="repos-label">repos</p>
      <table class="table" id="repos"><tbody></tbody></table>
      <p class="label after" id="vault-label">vault</p>
      <dl class="stats" id="vault"></dl>
    </section>

    <section class="panel">
      <p class="label"><span id="services-label">services</span> <button class="link" id="all-services">all services</button></p>
      <input class="input filter" id="service-filter" placeholder="filter services" spellcheck="false" />
      <div id="services"><p class="empty">reading the machine…</p></div>
      <div class="rule"><div class="fill" id="upbar"></div></div>
      <p class="hint" id="sweep-note" style="margin-top:10px"></p>
    </section>

    <section class="panel">
      <p class="label"><button class="link" id="log-toggle">actions <span id="log-count"></span></button></p>
      <div id="log-wrap"><ul class="list" id="actions"><li class="empty">nothing yet</li></ul></div>
      <div id="work-wrap" class="hidden">
        <p class="label after">work <span class="hint" id="work-count"></span></p>
        <div id="work"></div>
      </div>
      <p class="label after">machine</p>
      <dl class="stats" id="machine"></dl>
      <figure class="portrait">
        <img src="/gehirn/portrait.png" alt="" />
        <figcaption>rei · local</figcaption>
      </figure>
    </section>
  </div>

  <div class="palette hidden" id="palette">
    <div class="palette-box">
      <input class="input" id="palette-input" placeholder="jump to a project or service" spellcheck="false" autocomplete="off" />
      <div class="palette-list" id="palette-list"></div>
      <p class="hint palette-hint">↵ open · ↑↓ move · esc close</p>
    </div>
  </div>

  <div class="console">
    <section class="panel wide">
      <p class="label">model</p>
      <div class="field"><span>provider</span><select id="llm-provider" class="input"></select></div>
      <div class="field"><span>model</span><input id="llm-model" class="input" spellcheck="false" /></div>
      <div class="field"><span>base url</span><input id="llm-base" class="input" spellcheck="false" /></div>
      <div class="field"><span>api key</span><input id="llm-key" class="input" type="password" placeholder="paste once; stored 0600" autocomplete="off" /></div>
      <div class="row">
        <button class="btn" id="llm-save">store key</button>
        <button class="btn ghost" id="llm-forget">forget</button>
        <span class="hint" id="llm-state">no key yet</span>
      </div>

      <p class="label after">prompt</p>
      <textarea id="llm-prompt" class="input" rows="4" spellcheck="false" placeholder="ask the machine something"></textarea>
      <div class="checks">
        <input type="checkbox" id="llm-context" />
        <label for="llm-context">attach project context</label>
        <span id="llm-context-size" class="muted"></span>
      </div>
      <div class="row">
        <button class="btn" id="llm-run">run</button>
        <span class="hint" id="llm-status"></span>
      </div>
    </section>

    <section class="panel">
      <p class="label">output</p>
      <pre class="answer empty" id="llm-answer">no answer yet</pre>
      <div class="hint" id="llm-meta" style="margin-top:10px"></div>
      <p class="label after">recent</p>
      <ul class="list" id="llm-recent"><li class="empty">nothing yet</li></ul>
    </section>
  </div>

  <div class="bar foot">
    <span>${escapeHtml(phone || "phone · see lan proxy")}</span>
    <span class="grow"></span>
    <span>up since ${new Date(startedAt).toLocaleTimeString()}</span>
    <span class="grow"></span>
    <span id="stamp">—</span>
  </div>

<script>
(function () {
  var state = null, showAll = false, onlyDown = false;

  /** /gehirn/gemu → "gemu"; /gehirn/ → null. */
  function currentProject() {
    var parts = location.pathname.split("/").filter(Boolean);
    var at = parts.indexOf("gehirn");
    var next = at >= 0 ? parts[at + 1] : null;
    return next && /^[a-z][a-z0-9-]{1,31}$/.test(next) ? next : null;
  }

  var GROUPS = [["core", "core"], ["projects", "projects"], ["tools", "tools"], ["capture", "capture"], ["side", "side projects"]];
  var pending = {};
  var llm = null;
  var lastProvider = null;
  var runTimer = null;
  var runStarted = 0;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function glyphFor(state) {
    if (state === "up") return "\\u25A0";
    if (state === "pending") return "\\u25C6";
    if (state === "na") return "\\u2014";
    return "\\u25A1";
  }

  function row(service) {
    var state = pending[service.id] ? "pending" : (service.up ? "up" : (service.blocked ? "na" : "down"));
    var wrap = el("div", "svc " + state);
    wrap.dataset.id = service.id;

    wrap.appendChild(el("span", "glyph", glyphFor(state)));
    wrap.appendChild(el("span", "name", service.name));
    if (service.stale) {
      var stale = el("span", "stale", "stale");
      stale.title = "this process started before its code last changed — restart it";
      wrap.appendChild(stale);
    }
    wrap.appendChild(el("span", "port", ":" + service.port));
    wrap.appendChild(el("span", "note", service.detail || service.note || ""));

    var lat = el("span", "lat", state === "pending"
      ? "starting…"
      : (service.up ? (service.ms + " ms" + (service.code ? " · " + service.code : "")) : (service.blocked || "not running")));
    wrap.appendChild(lat);

    var act = el("span", "act");
    if (service.up && !service.self && service.probe !== "tcp") {
      var open = el("a", "btn ghost", "open");
      open.href = service.publicPath || ("http://localhost:" + service.port + (service.path || "/"));
      open.target = "_blank";
      open.rel = "noreferrer";
      act.appendChild(open);
    }
    if (!service.self) {
      var canRun = !service.blocked && !service.up;
      var canStop = service.up && service.canStop !== false;
      var button = el("button", "btn", canRun ? "run" : (service.up ? "stop" : (service.blocked ? "—" : "run")));
      button.disabled = pending[service.id] ? true : (canRun ? false : !canStop);
      button.dataset.action = canRun ? "start" : "stop";
      act.appendChild(button);
    }
    if (service.stale && !service.self) {
      var restart = el("button", "btn", "restart");
      restart.title = "stop then start — this process is older than its code";
      restart.dataset.action = "restart";
      act.appendChild(restart);
    }
    if (service.id === "agent" && service.up) {
      var sweepButton = el("button", "btn ghost", "sweep");
      sweepButton.dataset.action = "sweep";
      sweepButton.title = "resume the bookmark run";
      act.appendChild(sweepButton);
    }
    wrap.appendChild(act);
    return wrap;
  }

  function sameLine(services) {
    var expected = services.filter(function (service) { return !service.blocked; });
    var up = expected.filter(function (service) { return service.up; }).length;
    var down = expected.filter(function (service) { return !service.up; });
    var stale = services.filter(function (service) { return service.stale; }).length;
    var parts = [up + " / " + expected.length + " up"];
    if (down.length) {
      var names = down.slice(0, 2).map(function (service) { return service.name || service.id; });
      parts.push(down.length > 2 ? names.join(", ") + " +" + (down.length - 2) + " more" : names.join(", "));
    }
    if (stale) parts.push(stale + " stale");
    return { text: parts.join(" · "), up: up, total: expected.length, down: down.length };
  }

  function sortServices(services) {
    var rank = function (service) { return (service.up ? 2 : 0) + (service.stale ? -1 : 0); };
    return services.slice().sort(function (a, b) {
      return rank(a) - rank(b) || String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
  }

  function renderServices(data, allowed) {
    var host = document.getElementById("services");
    host.innerHTML = "";
    var services = Array.isArray(data) ? data : (data.services || []);
    if (allowed) services = services.filter(function (service) { return allowed.indexOf(service.id) >= 0; });

    // the header names what is wrong, and filters to it when clicked
    var line = sameLine(services);
    var summary = document.getElementById("summary");
    summary.textContent = line.text;
    summary.className = "btn ghost sm" + (onlyDown ? " on" : "");
    summary.title = line.down ? "show only what is down" : "everything is up";
    document.getElementById("upbar").style.width = (line.total ? Math.round((line.up / line.total) * 100) : 0) + "%";

    if (onlyDown) services = services.filter(function (service) { return !service.up || service.stale; });
    var query = (document.getElementById("service-filter").value || "").trim().toLowerCase();
    if (query) {
      services = services.filter(function (service) {
        return [service.id, service.name, service.project, service.note, service.publicPath]
          .join(" ").toLowerCase().indexOf(query) >= 0;
      });
    }
    if (!services.length) { host.appendChild(el("p", "empty", onlyDown ? "nothing is down" : "nothing matches")); return; }
    GROUPS.forEach(function (pair) {
      var items = sortServices(services.filter(function (service) { return service.group === pair[0]; }));
      if (!items.length) return;
      host.appendChild(el("p", "group", pair[1]));
      items.forEach(function (service) { host.appendChild(row(service)); });
    });
  }

  function renderCrumbs(entry) {
    var host = document.getElementById("crumbs");
    host.innerHTML = "";
    var home = document.createElement("a");
    home.href = "/gehirn/";
    home.textContent = "ayamai";
    host.appendChild(home);
    if (!entry) { host.appendChild(el("span", "here", "· platform")); return; }
    host.appendChild(el("span", "sep", "/"));
    host.appendChild(el("span", "here", entry.name));
  }

  function renderChildren(entry) {
    var wrap = document.getElementById("children-wrap");
    var list = (state.children || []).filter(function (child) { return child.parent === entry.id; });
    if (!list.length) { wrap.classList.add("hidden"); return; }
    wrap.classList.remove("hidden");
    document.getElementById("children-count").textContent = list.length + " projects";
    var host = document.getElementById("children");
    host.innerHTML = "";
    list.forEach(function (child) {
      var row = el("div", "child");
      var head = el("div", "head");
      head.appendChild(el("span", "nm", child.name));
      head.appendChild(el("span", "tag" + (child.fork ? " ours" : ""), child.fork ? "ours" : "upstream"));
      head.appendChild(el("span", "tag", child.systems.join(" · ") || "—"));
      row.appendChild(head);
      var body = el("div", "body");
      body.appendChild(el("div", null, "upstream · " + (child.upstream || "unknown") + " (" + (child.license || "?") + ")"));
      body.appendChild(el("div", null, "pinned · " + (child.tag || "—") + " · patches · " + child.patches));
      var fork = el("div", null, "fork · " + (child.fork || "not forked yet"));
      body.appendChild(fork);
      var link = document.createElement("a");
      link.href = "/gemu/" + child.id + "/";
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "open " + child.displayId + " →";
      body.appendChild(link);
      row.appendChild(body);
      head.addEventListener("click", function () { row.classList.toggle("open"); });
      host.appendChild(row);
    });
  }

  function renderWork(entry) {
    var wrap = document.getElementById("work-wrap");
    var plans = state.plans || { ok: false, groups: {} };
    var items = (plans.groups || {})[entry.id] || [];
    wrap.classList.remove("hidden");
    document.getElementById("work-count").textContent = items.length ? items.length + " open" : plans.ok ? "none" : "unavailable";
    var host = document.getElementById("work");
    host.innerHTML = "";
    if (!items.length) { host.appendChild(el("p", "empty", plans.ok ? "nothing open" : "plans unavailable")); return; }
    items.slice(0, 8).forEach(function (item) {
      var row = el("div", "item");
      row.appendChild(el("span", "meta", "#" + item.id));
      row.appendChild(el("span", "title", item.title));
      row.appendChild(el("span", "meta", "P" + item.priority + " " + item.status));
      host.appendChild(row);
    });
  }

  var freshness = null;
  function loadFreshness() {
    return fetch("/gehirn/api/freshness", { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data) return;
        freshness = {};
        data.projects.forEach(function (project) { freshness[project.id] = project; });
      })
      .catch(function () {});
  }

  var mode = "dev";
  function setMode(next) {
    mode = next === "play" ? "play" : "dev";
    Array.prototype.forEach.call(document.querySelectorAll("#mode button"), function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    });
  }

  function bindMode() {
    Array.prototype.forEach.call(document.querySelectorAll("#mode button"), function (button) {
      button.addEventListener("click", function () {
        var wanted = button.dataset.mode;
        fetch("/gehirn/api/mode", { method: "POST", headers: { "content-type": "application/json", "x-cockpit": "1" }, body: JSON.stringify({ mode: wanted }) })
          .then(function (response) { return response.json(); })
          .then(function (answer) {
            if (!answer || !answer.ok) { toast("could not switch mode"); return; }
            setMode(answer.mode);
            if (wanted === "play") location.href = "/play/";
          })
          .catch(function () { toast("could not switch mode"); });
      });
    });
  }

  function renderCatalog(catalog, only) {
    var host = document.getElementById("projects");
    if (!host || !catalog) return;
    host.innerHTML = "";
    if (only) {
      catalog = { ...catalog, entries: (catalog.entries || []).filter(function (entry) { return entry.id === only; }) };
    }
    var orgs = catalog.organizations || [];
    var people = catalog.people || [];
    var counts = document.getElementById("project-counts");
    if (counts && (orgs.length || people.length)) {
      counts.textContent = orgs.map(function (org) { return org.id; }).join(", ") +
        " · " + people.map(function (person) { return person.id; }).join(", ");
    }
    (catalog.entries || []).forEach(function (entry) {
      var box = el("div", "proj " + (entry.health || ""));
      var top = el("div", "top");
      if (entry.health) top.appendChild(el("span", "dot"));
      var name = el("a", "nm", entry.name);
      name.href = "/gehirn/" + encodeURIComponent(entry.id);
      name.title = entry.id === currentProject() ? entry.name : "open " + entry.id;
      top.appendChild(name);
      if (entry.jp) top.appendChild(el("span", "jp", entry.jp));
      top.appendChild(el("span", "kind", entry.kind + (entry.version ? " · " + entry.version : "")));
      box.appendChild(top);
      if (entry.summary) box.appendChild(el("p", "sum", entry.summary));
      if (entry.org) {
        var line = el("p", "org", entry.org.name + " · " + entry.org.owner);
        line.title = entry.org.summary || entry.org.name;
        box.appendChild(line);
      }

      var where = el("p", "where");
      var copy = document.createElement("button");
      copy.textContent = entry.homePath;
      copy.title = "copy " + entry.absPath;
      copy.addEventListener("click", function () {
        navigator.clipboard.writeText(entry.absPath).then(function () {
          var before = copy.textContent;
          copy.textContent = "copied";
          setTimeout(function () { copy.textContent = before; }, 900);
        });
      });
      where.appendChild(copy);
      (entry.extraPaths || []).forEach(function (extra) {
        where.appendChild(document.createTextNode(" · " + extra.label + ": " + extra.homePath));
      });
      box.appendChild(where);

      var acts = el("div", "acts");
      // navigation first: the door, the code, then the rest behind a disclosure
      var links = entry.links || [];
      if (links[0]) {
        var first = el("a", "btn ghost", links[0].label);
        first.href = links[0].url;
        first.target = "_blank";
        first.rel = "noreferrer";
        acts.appendChild(first);
      }
      var browse = el("a", "btn ghost", "code");
      browse.href = "/gehirn/files/" + encodeURIComponent(entry.id) + "/";
      browse.target = "_blank";
      acts.appendChild(browse);

      var more = [];
      links.slice(1).forEach(function (link) {
        var a = el("a", "btn ghost", link.label);
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noreferrer";
        more.push(a);
      });
      (entry.docs || []).forEach(function (doc) {
        if (!doc.exists) return;
        var a = el("a", "btn ghost", doc.doc.split("/").pop().replace(/\.md$/i, "").toLowerCase());
        a.href = "/gehirn/docs/" + encodeURIComponent(entry.id) + "/" + doc.doc.split("/").map(encodeURIComponent).join("/");
        a.target = "_blank";
        a.title = doc.doc;
        more.push(a);
      });
      var edit = el("button", "btn ghost", "vscode");
      edit.addEventListener("click", function () { return openOn("editor", entry.id, edit); });
      more.push(edit);
      var reveal = el("button", "btn ghost", "reveal");
      reveal.addEventListener("click", function () { return openOn("reveal", entry.id, reveal); });
      more.push(reveal);

      var extra = null;
      if (more.length) {
        extra = el("div", "more hidden");
        more.forEach(function (node) { extra.appendChild(node); });
        var toggle = el("button", "btn ghost more-toggle", "\u22ef");
        toggle.title = "more for " + entry.name;
        toggle.addEventListener("click", function () { extra.classList.toggle("hidden"); });
        acts.appendChild(toggle);
      }
      box.appendChild(acts);

      // one button for the whole project, when it has services gehirn can start
      var summary = projectSummary(state.services || [], entry.id);
      var fresh = (freshness && freshness[entry.id]) || null;
      if (fresh) {
        var line = el("p", "fresh" + (fresh.neglected ? " neglected" : ""), fresh.line);
        if (fresh.lastCommit && fresh.lastCommit.subject) line.title = fresh.lastCommit.subject;
        if (fresh.neglected) {
          var quiet = el("span", "stale", "neglected");
          quiet.style.marginLeft = "8px";
          quiet.title = fresh.name + " has not been touched in " + fresh.days + " days - the code is fine, nobody has looked";
          line.appendChild(quiet);
        }
        box.appendChild(line);
      }

      if (entry.face) {
        var open = el("a", "btn sm", "open");
        open.href = entry.face[mode] || entry.face.dev;
        open.textContent = mode === "play" ? "play" : "open";
        box.appendChild(open);
      }

      if (summary && summary.hasButton) {
        var bar = el("div", "proj-run");
        var chip = el("span", "chip " + (summary.up === summary.total ? "up" : summary.up ? "part" : "down"));
        chip.textContent = summary.blockedReason ? summary.blockedReason : summary.label;
        bar.appendChild(chip);
        var runButton = el("button", "btn ghost project-button", summary.canStart ? "start" : "stop");
        runButton.dataset.project = entry.id;
        runButton.dataset.then = summary.canStart ? "start" : "stop";
        if (summary.blockedReason) {
          runButton.disabled = true;
          runButton.title = summary.blockedReason;
        }
        bar.appendChild(runButton);
        box.appendChild(bar);
      }

      if (extra) box.appendChild(extra);
      host.appendChild(box);
    });
  }

  /** One press: start or stop every service a project owns. */
  async function runProject(project, action, button) {
    var was = button.textContent;
    button.disabled = true;
    button.textContent = action === "stop" ? "stopping…" : "starting…";
    try {
      var response = await fetch("/gehirn/api/project", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cockpit": "1" },
        body: JSON.stringify({ id: project, action: action }),
      });
      var result = await response.json();
      button.textContent = result.ok ? "checking…" : "retry";
      if (!result.ok && result.message) button.title = result.message;
    } catch (error) {
      button.textContent = was;
    } finally {
      setTimeout(function () { button.disabled = false; tick(); }, 1200);
    }
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest("button.project-button");
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    runProject(button.dataset.project, button.dataset.then || "start", button);
  });

  async function openOn(kind, id, button) {
    var before = button.textContent;
    button.disabled = true;
    button.textContent = "…";
    try {
      var response = await fetch("/gehirn/open/" + kind, {
        method: "POST",
        headers: { "content-type": "application/json", "x-gehirn": "1" },
        body: JSON.stringify({ id: id })
      });
      var data = await response.json().catch(function () { return {}; });
      button.textContent = response.ok ? "opened" : (data.error || "failed").slice(0, 18);
    } catch (error) {
      button.textContent = "failed";
    }
    setTimeout(function () { button.textContent = before; button.disabled = false; }, 1400);
  }

  function renderProjects(projects) {
    if (!projects) return;
    var body = document.querySelector("#repos tbody");
    body.innerHTML = "";
    (projects.repos || []).forEach(function (repo) {
      var tr = el("tr");
      tr.appendChild(el("td", "name", repo.name));
      tr.appendChild(el("td", "right", repo.branch + " · " + (repo.dirty ? repo.dirty + " dirty" : "clean")));
      body.appendChild(tr);
    });
    var vault = document.getElementById("vault");
    vault.innerHTML = "";
    [["used", projects.vault.used], ["free", projects.vault.free], ["volume", projects.vault.total]]
      .forEach(function (pair) {
        var stat = el("div", "stat");
        stat.appendChild(el("dt", null, pair[0]));
        stat.appendChild(el("dd", null, pair[1]));
        vault.appendChild(stat);
      });
  }

  function renderLog(lines) {
    var wrap = document.getElementById("log-wrap");
    var open = localStorage.getItem("ayamai.gehirn.log") === "open";
    wrap.classList.toggle("hidden", !open);
    document.getElementById("log-toggle").textContent = "actions · " + (lines ? lines.length : 0) + (open ? " ⌃" : " ⌄");
  }

  function renderActions(lines) {
    renderLog(lines);
    var host = document.getElementById("actions");
    host.innerHTML = "";
    if (!lines || !lines.length) { host.appendChild(el("li", "empty", "nothing yet")); return; }
    lines.forEach(function (line) {
      var item = el("li", "item");
      var when = line.slice(0, 8);
      var what = line.slice(9).trim();
      item.title = what;                       // the full line on hover
      item.appendChild(el("span", "meta time", when));
      item.appendChild(el("span", "title", what));
      host.appendChild(item);
    });
  }

  // one copy of the rule, injected: the card and the server cannot disagree
  var projectSummary = ${projectSummary.toString()};

  function renderMachine(data) {
    var host = document.getElementById("machine");
    host.innerHTML = "";
    var release = data.release || {};
    var rows = [
      ["release", release.tag
        ? release.tag.replace("release/", "") + " · " + new Date(release.at).toLocaleDateString()
        : "never published"],
      ["docker", data.docker.up ? data.docker.containers.length + " containers" : "engine down"],
      ["agent", data.agent ? (data.agent.signedIn ? "signed in · " + data.agent.user : "signed out") : "stopped"],
      ["lan", data.lan && data.lan.length ? data.lan[0] : "—"],
      ["uptime", data.uptime],
    ];
    if (data.sweep) {
      rows.push(["sweep", data.sweep.running
        ? (data.sweep.total ? data.sweep.done + " / " + data.sweep.total : "listing bookmarks")
        : "idle · " + data.sweep.done + " home"]);
    }
    rows.forEach(function (pair) {
      var stat = el("div", "stat");
      stat.appendChild(el("dt", null, pair[0]));
      stat.appendChild(el("dd", null, String(pair[1])));
      host.appendChild(stat);
    });
    document.getElementById("stamp").textContent = "checked " + new Date(data.at).toLocaleTimeString();
  }

  /* ---- model console ---------------------------------------------------- */

  function fillProviders(state) {
    var select = document.getElementById("llm-provider");
    var current = select.value;
    select.innerHTML = "";
    state.providers.forEach(function (provider) {
      var option = el("option", null, provider.name + (provider.keyed ? "" : " · local"));
      option.value = provider.id;
      option.dataset.base = provider.baseURL;
      option.dataset.model = provider.model;
      option.dataset.keyed = provider.keyed ? "1" : "0";
      select.appendChild(option);
    });
    if (current) select.value = current;
    if (!select.value) select.value = state.active || state.providers[0].id;
  }

  function syncProviderFields(force) {
    var select = document.getElementById("llm-provider");
    var option = select.selectedOptions[0];
    if (!option) return;
    var configured = (llm.configured || []).find(function (entry) { return entry.provider === select.value; });
    var changed = lastProvider !== select.value;
    lastProvider = select.value;

    var model = document.getElementById("llm-model");
    var base = document.getElementById("llm-base");
    if (changed || force) {
      model.value = configured ? configured.model : option.dataset.model;
      base.value = configured ? configured.baseURL : option.dataset.base;
    }
    var key = document.getElementById("llm-key");
    key.disabled = option.dataset.keyed === "0";
    key.placeholder = configured ? "stored · " + configured.fingerprint + " — paste to replace" : "paste once; stored 0600";

    var state = document.getElementById("llm-state");
    var parts = (llm.configured || []).map(function (entry) {
      return entry.provider + " " + entry.fingerprint + (entry.lastOk ? " ✓" : "");
    });
    state.textContent = parts.length ? parts.join("  ·  ") : "no key yet";
    state.className = "hint" + (parts.length ? " ok" : "");
  }

  function renderRecent(items) {
    var host = document.getElementById("llm-recent");
    host.innerHTML = "";
    if (!items || !items.length) { host.appendChild(el("li", "empty", "nothing yet")); return; }
    items.forEach(function (entry) {
      var item = el("li", "item");
      item.appendChild(el("span", "id", String(entry.tokens || 0)));
      item.appendChild(el("span", "title", entry.provider + " · " + entry.model));
      item.appendChild(el("span", "meta", (entry.ms / 1000).toFixed(1) + "s"));
      host.appendChild(item);
    });
  }

  function renderLlm(state) {
    if (!state) return;
    llm = state;
    fillProviders(state);
    syncProviderFields(false);
    renderRecent(state.recent);
  }

  function setAnswer(text, meta, isError) {
    var answer = document.getElementById("llm-answer");
    answer.className = "answer" + (text ? "" : " empty");
    answer.textContent = text || "no answer yet";
    if (isError) answer.style.borderColor = "var(--red)";
    else answer.style.borderColor = "";
    document.getElementById("llm-meta").textContent = meta || "";
    document.getElementById("llm-meta").className = "hint" + (isError ? " bad" : "");
  }

  async function post(path, body) {
    var response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cockpit": "1" },
      body: JSON.stringify(body || {})
    });
    var data = await response.json().catch(function () { return {}; });
    return { ok: response.ok, status: response.status, data: data };
  }

  document.getElementById("llm-provider").addEventListener("change", function () { syncProviderFields(true); });

  document.getElementById("llm-save").addEventListener("click", async function () {
    var select = document.getElementById("llm-provider");
    var button = this;
    var state = document.getElementById("llm-state");
    button.disabled = true;
    state.className = "hint";
    state.textContent = "verifying…";
    var result = await post("/gehirn/api/llm/key", {
      provider: select.value,
      apiKey: document.getElementById("llm-key").value,
      model: document.getElementById("llm-model").value,
      baseURL: document.getElementById("llm-base").value
    });
    button.disabled = false;
    document.getElementById("llm-key").value = "";
    if (!result.ok) {
      state.className = "hint bad";
      state.textContent = result.data.error || "could not store the key";
      return;
    }
    state.className = "hint " + (result.data.verified ? "ok" : "bad");
    state.textContent = result.data.verified ? "stored · " + result.data.fingerprint + " · verified" : "stored · " + result.data.fingerprint + " · " + (result.data.detail || "not verified");
    renderLlm(result.data.llm);
    tick();
  });

  document.getElementById("llm-forget").addEventListener("click", async function () {
    var provider = document.getElementById("llm-provider").value;
    var result = await post("/gehirn/api/llm/key/delete", { provider: provider });
    var state = document.getElementById("llm-state");
    state.className = "hint" + (result.ok ? "" : " bad");
    state.textContent = result.ok ? "removed " + provider : (result.data.error || "nothing stored");
    if (result.ok) renderLlm(result.data.llm);
    tick();
  });

  document.getElementById("llm-run").addEventListener("click", async function () {
    var button = this;
    var prompt = document.getElementById("llm-prompt").value;
    var status = document.getElementById("llm-status");
    if (!prompt.trim()) { status.className = "hint bad"; status.textContent = "empty prompt"; return; }
    button.disabled = true;
    runStarted = Date.now();
    setAnswer("", "", false);
    document.getElementById("llm-answer").textContent = "waiting…";
    runTimer = setInterval(function () {
      status.className = "hint";
      status.textContent = "running " + Math.round((Date.now() - runStarted) / 1000) + "s";
    }, 500);
    var result = await post("/gehirn/api/llm/run", {
      provider: document.getElementById("llm-provider").value,
      prompt: prompt,
      model: document.getElementById("llm-model").value,
      attachContext: document.getElementById("llm-context").checked
    });
    clearInterval(runTimer);
    button.disabled = false;
    status.className = "hint";
    status.textContent = "";
    if (result.data.ok) {
      var usage = result.data.usage || { prompt: 0, completion: 0 };
      setAnswer(result.data.text, result.data.model + " · " + (result.data.ms / 1000).toFixed(1) + " s · " +
        usage.prompt + " in / " + usage.completion + " out" + (result.data.truncated ? " · truncated" : ""), false);
      renderLlm(result.data.llm);
      tick();
      return;
    }
    setAnswer(result.data.error || "failed", Math.round((result.data.ms || 0) / 10) / 100 + " s", true);
  });

  document.getElementById("llm-context").addEventListener("change", function () {
    document.getElementById("llm-context-size").textContent = this.checked ? "included with the next run" : "";
  });

  /* ---- loop -------------------------------------------------------------- */

  /* ---- jump palette ---------------------------------------------------- */

  var paletteItems = [];
  var paletteIndex = 0;

  function paletteTargets() {
    var projects = ((state && state.catalog && state.catalog.entries) || []).map(function (entry) {
      return {
        kind: "project", label: entry.name, id: entry.id,
        meta: entry.kind + (entry.version ? " · " + entry.version : ""),
        haystack: [entry.id, entry.name, entry.kind, entry.summary].join(" ").toLowerCase(),
        go: function () { location.href = "/gehirn/" + encodeURIComponent(entry.id); },
      };
    });
    var services = ((state && state.services) || []).map(function (service) {
      return {
        kind: "service", label: service.name || service.id, id: service.id,
        meta: ":" + service.port + (service.up ? " · up" : " · down"),
        haystack: [service.id, service.name, service.project, service.note, service.publicPath].join(" ").toLowerCase(),
        go: function () {
          if (service.up && service.publicPath) { window.open(service.publicPath, "_blank", "noreferrer"); return; }
          location.href = "/gehirn/" + encodeURIComponent(service.project || "") + "#" + service.id;
        },
      };
    });
    return projects.concat(services);
  }

  function renderPalette() {
    var query = (document.getElementById("palette-input").value || "").trim().toLowerCase();
    var all = paletteTargets();
    paletteItems = (query ? all.filter(function (item) { return item.haystack.indexOf(query) >= 0; }) : all).slice(0, 12);
    if (!paletteItems.length) paletteItems = all.slice(0, 12);
    paletteIndex = Math.min(paletteIndex, paletteItems.length - 1);
    var host = document.getElementById("palette-list");
    host.innerHTML = "";
    paletteItems.forEach(function (item, index) {
      var row = el("div", "palette-item" + (index === paletteIndex ? " on" : ""));
      row.appendChild(el("span", "kind", item.kind));
      row.appendChild(el("span", "label", item.label));
      row.appendChild(el("span", "meta", item.meta));
      row.addEventListener("click", function () { item.go(); });
      host.appendChild(row);
    });
  }

  function openPalette() {
    if (!state) return;
    paletteIndex = 0;
    document.getElementById("palette").classList.remove("hidden");
    var input = document.getElementById("palette-input");
    input.value = "";
    renderPalette();
    input.focus();
  }

  function closePalette() {
    document.getElementById("palette").classList.add("hidden");
  }

  // ---- the panel's controls ---------------------------------------------
  document.getElementById("all-services").addEventListener("click", function () {
    showAll = !showAll;
    renderView();
  });

  document.getElementById("summary").addEventListener("click", function () {
    onlyDown = !onlyDown;
    renderServices(state.services || [], allowedServices());
  });

  document.getElementById("service-filter").addEventListener("input", function () {
    renderServices(state.services || [], allowedServices());
  });

  document.getElementById("log-toggle").addEventListener("click", function () {
    var open = localStorage.getItem("ayamai.gehirn.log") === "open";
    localStorage.setItem("ayamai.gehirn.log", open ? "closed" : "open");
    renderLog((state && state.actions) || []);
  });

  document.getElementById("palette-input").addEventListener("input", function () { paletteIndex = 0; renderPalette(); });
  document.getElementById("palette").addEventListener("click", function (event) {
    if (event.target.id === "palette") closePalette();
  });

  document.addEventListener("keydown", function (event) {
    var open = !document.getElementById("palette").classList.contains("hidden");
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
    if (!open && (event.key === "/" || (event.key === "k" && (event.metaKey || event.ctrlKey))) && !typing) {
      event.preventDefault();
      openPalette();
      return;
    }
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); closePalette(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, paletteItems.length - 1); renderPalette(); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); paletteIndex = Math.max(paletteIndex - 1, 0); renderPalette(); return; }
    if (event.key === "Enter" && paletteItems[paletteIndex]) { event.preventDefault(); paletteItems[paletteIndex].go(); }
  });

  bindMode();

  /** The allow-list for the current view, or null when everything is on show. */
  function allowedServices() {
    if (showAll) return null;
    var entry = currentProject();
    var groups = state.groups || {};
    return entry ? (groups[entry] || []) : (groups.platform || []);
  }

  /** Which page we are: ayamai, or one project. The path says so. */
  function renderView() {
    var id = currentProject();
    var entry = id ? (((state.catalog || {}).entries || []).find(function (e) { return e.id === id; }) || null) : null;

    renderCrumbs(entry);
    if (id && !entry) {
      var crumbs = document.getElementById("crumbs");
      crumbs.appendChild(el("span", "sep", "/"));
      crumbs.appendChild(el("span", "here", 'no project "' + id + '"'));
    }

    document.getElementById("projects-label").textContent = entry ? "project" : "projects";
    setMode(state.mode);
    loadFreshness().then(function () { renderCatalog(state.catalog, entry ? entry.id : null); });

    if (entry) { renderChildren(entry); renderWork(entry); }
    else {
      document.getElementById("children-wrap").classList.add("hidden");
      document.getElementById("work-wrap").classList.add("hidden");
    }
    ["repos-label", "repos", "vault-label", "vault"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.classList.toggle("hidden", Boolean(entry));
    });

    renderServices(state.services || [], allowedServices());

    document.getElementById("services-label").textContent = entry ? "services · " + entry.name : "platform services";
    document.getElementById("all-services").textContent = showAll ? "only this" : "all services";
  }

  // A client that dies silently leaves "reading…" on the screen forever.
  window.addEventListener("unhandledrejection", function (event) {
    var summary = document.getElementById("summary");
    if (summary) summary.textContent = "gehirn failed in the browser: " + ((event.reason && event.reason.message) || "rejected promise");
  });
  window.addEventListener("error", function (event) {
    var summary = document.getElementById("summary");
    if (summary) summary.textContent = "gehirn failed in the browser: " + (event.message || "unknown");
  });

  async function tick() {
    var data;
    try {
      data = await (await fetch("/gehirn/api/status", { cache: "no-store" })).json();
    } catch (error) {
      document.getElementById("summary").textContent = "gehirn lost the loop";
      return;
    }
    state = data;
    renderProjects(data.projects);
    renderView();
    renderActions(data.actions);
    renderMachine(data);
    renderLlm(data.llm);
  }

  async function runSweep(payload) {
    var note = document.getElementById("sweep-note");
    note.className = "hint";
    note.textContent = "working…";
    var result = await fetch("/gehirn/api/pixiv/sweep", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cockpit": "1" },
      body: JSON.stringify(payload)
    });
    return { ok: result.ok, status: result.status, data: await result.json().catch(function () { return {}; }) };
  }

  document.addEventListener("click", async function (event) {
    var sweepButton = event.target.closest('button[data-action="sweep"]');
    if (sweepButton) {
      var note = document.getElementById("sweep-note");
      sweepButton.disabled = true;
      var before = sweepButton.textContent;
      sweepButton.textContent = "working…";
      var result = await runSweep({});
      if (result.status === 409 && result.data && result.data.needsBraveClosed) {
        note.className = "hint bad";
        note.textContent = result.data.message;
        if (confirm(result.data.message + "\\n\\nClose Brave and start the sweep now?")) {
          result = await runSweep({ force: true });
        }
      }
      sweepButton.disabled = false;
      sweepButton.textContent = before;
      note.className = "hint " + (result.ok ? "ok" : "bad");
      note.textContent = result.ok
        ? (result.data.state || "sweep started") + (result.data.sweep && result.data.sweep.total ? " · " + result.data.sweep.done + " / " + result.data.sweep.total : "")
        : (result.data.message || result.data.error || "could not start the sweep");
      tick();
      return;
    }
    var button = event.target.closest("button[data-action]");
    if (!button) return;
    var wrap = button.closest(".svc");
    var id = wrap.dataset.id;
    var action = button.dataset.action;
    pending[id] = true;
    wrap.className = "svc pending";
    button.disabled = true;
    try {
      var response = await fetch("/gehirn/api/action", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cockpit": "1" },
        body: JSON.stringify({ id: id, action: action })
      });
      if (!response.ok) { button.disabled = false; button.textContent = "retry"; }
      setTimeout(function () { delete pending[id]; tick(); }, 900);
      tick();
    } catch (error) {
      pending[id] = false;
      button.disabled = false;
    }
  });

  setInterval(function () {
    document.getElementById("clock").textContent = new Date().toLocaleTimeString();
  }, 1000);
  document.getElementById("clock").textContent = new Date().toLocaleTimeString();

  tick();
  setInterval(tick, 3000);
})();
</script>
</body>
</html>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
