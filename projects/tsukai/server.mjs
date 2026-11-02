// The page: what this extension is, what it may do, and how to load it.
//
// Reads the extension's own manifest at request time — the version on the page
// is the version Chrome will see, or the page says why it cannot tell.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { brand, brandLinks } from "../../ui/brand.mjs";

const HERE = import.meta.dirname;
const EXTENSION = path.join(HERE, "extension");
const PORT = Number(process.env.PORT_OVERRIDE ?? 4655);
const BASE = (process.env.BASE_PREFIX ?? "").replace(/\/$/, "");

function readJson(file) {
  try { return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) }; }
  catch (error) { return { ok: false, error: String(error.message).split("\n")[0] }; }
}

export function inventory(dir = EXTENSION) {
  const manifest = readJson(path.join(dir, "manifest.json"));
  return { extension: dir, ok: manifest.ok, error: manifest.ok ? null : manifest.error, manifest: manifest.ok ? manifest.value : null };
}

const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STYLE = `<style>
  :root{--void:#0b0d14;--ink:#e6ecff;--dim:#a3adc3;--line:#202a5a;--line-soft:rgba(32,42,90,.45);
        --card:#151d2e;--rei:#a9b7e8;--ok:#91b7b3;--red:#e53935;
        --serif:"Cormorant Garamond",Georgia,serif;--mono:"IBM Plex Mono",ui-monospace,monospace}
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--void);color:var(--ink);font:13px/1.55 Inter,ui-sans-serif,system-ui,sans-serif}
  body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
    background:radial-gradient(1100px 620px at 78% -10%,rgba(169,183,232,.10),transparent 60%),
               radial-gradient(900px 520px at 8% 108%,rgba(176,169,220,.07),transparent 62%)}
  body>*{position:relative;z-index:1}
  .bar{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:16px 22px;border-bottom:1px solid var(--line)}
  .clock{font-family:var(--mono);font-size:11px;color:var(--dim)}
  .grid{display:grid;grid-template-columns:1fr 1fr;min-height:calc(100vh - 57px)}
  .panel{padding:22px 24px 28px;border-right:1px solid var(--line)}
  .panel:last-child{border-right:0}
  .label{font-family:var(--mono);font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--dim);margin:0 0 12px}
  .label.after{margin-top:30px}
  h1{margin:0;font:400 26px/1.1 var(--serif);letter-spacing:.1em}
  .sub{margin:8px 0 0;color:var(--dim);font-size:12px}
  .ver{font-family:var(--mono);font-size:11px;color:var(--ok);margin-top:6px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  td{padding:6px 0;border-bottom:1px solid var(--line-soft);font:11px var(--mono);color:var(--dim);vertical-align:top}
  td:first-child{width:120px;color:var(--ink)}
  td + td{padding-left:16px}
  ol{margin:0;padding-left:20px;color:#d9e1f5;font-size:13px}
  li{margin-bottom:8px}
  .path{display:flex;gap:8px;align-items:center;margin:10px 0 14px}
  .path code{flex:1;min-width:0;overflow:auto;background:#0d1018;border:1px solid var(--line);border-radius:6px;
    padding:8px 10px;font:11px var(--mono);white-space:nowrap}
  .path button{background:rgba(32,42,90,.5);border:1px solid var(--line);color:var(--ink);border-radius:6px;
    padding:8px 12px;font:10px var(--mono);letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
  .path button:hover{border-color:var(--rei)}
  .links{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
  .links a{border:1px solid var(--line);border-radius:6px;padding:5px 11px;font:10px var(--mono);
    letter-spacing:.14em;text-transform:uppercase;color:var(--dim);text-decoration:none}
  .links a:hover{border-color:var(--rei);color:var(--ink)}
  .err{color:var(--red);font:11px var(--mono)}
  .bar.foot{border-top:1px solid var(--line);border-bottom:0;padding:8px 22px;font:11px var(--mono);color:var(--dim)}
</style>`;

export const renderPage = (data) => `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>ayamai — tsukai</title>
<link rel="icon" href="/gehirn/favicon.ico"/>
${brandLinks()}
${STYLE}</head><body>
<header class="bar">
  ${brand({ tool: "tsukai", jp: "使い" })}
  <span class="clock"><a href="/gehirn/" style="color:var(--dim);text-decoration:none">gehirn</a> · <span id="clock">--:--:--</span></span>
</header>
<main class="grid">
  <section class="panel">
    <p class="label">the extension</p>
    ${data.ok ? `<h1>${escape(data.manifest.name ?? "__ID__")}</h1>
    <p class="sub">${escape(data.manifest.description ?? "the browser extension")}</p>
    <p class="ver">version ${escape(data.manifest.version ?? "unknown")} · manifest v${escape(data.manifest.manifest_version ?? "?")}</p>
    <p class="label after">permissions</p>
    <table>${(data.manifest.permissions ?? []).map((permission) => `<tr><td>${escape(permission)}</td><td>${escape({
      activeTab: "read the page you are on, when you ask",
      scripting: "run a script in that tab to capture it",
      storage: "remember the door's address",
    }[permission] ?? "")}</td></tr>`).join("")}</table>
    <p class="label after">hosts</p>
    <table>${(data.manifest.host_permissions ?? []).map((host) => `<tr><td>${escape(host)}</td><td>the local door</td></tr>`).join("")}</table>` : `<p class="err">could not read the manifest: ${escape(data.error)}</p>`}
  </section>
  <section class="panel">
    <p class="label">install</p>
    ${data.ok ? `<p class="sub">Load it unpacked — this folder, not the project root.</p>
    <div class="path"><code id="p">${escape(data.extension)}</code><button id="copy">copy</button></div>
    <ol>
      <li>Open <code>brave://extensions</code> (or <code>chrome://extensions</code>).</li>
      <li>Turn on <b>Developer mode</b>.</li>
      <li>Press <b>Load unpacked</b>.</li>
      <li>Choose the folder above — the one containing <code>manifest.json</code>.</li>
    </ol>
    <p class="sub">It talks to <code>http://ayamai.local</code>; keep the door running.</p>
    <script>document.getElementById("copy").addEventListener("click",function(){var b=this;navigator.clipboard.writeText(document.getElementById("p").textContent).then(function(){b.textContent="copied";setTimeout(function(){b.textContent="copy"},1200)})})</script>` : `<p class="err">fix the manifest, then reload this page.</p>`}
    <p class="label after">elsewhere</p>
    <div class="links">
      <a href="/gehirn/docs/tsukai/docs/projects/tsukai.md">docs</a>
      <a href="/gehirn/files/tsukai/">code</a>
      <a href="${BASE}/api/state">state</a>
    </div>
  </section>
</main>
<footer class="bar foot"><span>read-only · ${escape(data.extension)}</span><span>ayamai · ikari</span></footer>
<script>setInterval(function(){document.getElementById("clock").textContent=new Date().toLocaleTimeString();},1000);document.getElementById("clock").textContent=new Date().toLocaleTimeString();</script>
</body></html>`;

export function createServerFor(port = PORT, base = BASE) {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (base && url.pathname.startsWith(base)) url.pathname = url.pathname.slice(base.length) || "/";
    const data = inventory();
    if (url.pathname === "/api/state") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(renderPage(data));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }).listen(port, "127.0.0.1", () => console.log("tsukai: http://127.0.0.1:" + port + base));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(HERE, "server.mjs");
if (isMain) createServerFor();
