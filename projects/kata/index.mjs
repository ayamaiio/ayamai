#!/usr/bin/env node
// kata — 型. The design library: tokens, components, and an editor that writes
// the source of truth.
//
//   node projects/kata/index.mjs        → http://127.0.0.1:4600
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { COMPONENTS } from "./catalog.mjs";
import { loadTokens, setToken, validateTokens } from "./tokens.mjs";

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "../..");
const TOKENS = path.join(HERE, "tokens.json");
const PORT = Number(process.env.KATA_PORT ?? 4600);
const BASE = (process.env.BASE_PREFIX ?? "").replace(/\/$/, "");

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

function regenerate() {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(HERE, "build.mjs")], { cwd: REPO, timeout: 30_000 }, (error, stdout, stderr) =>
      resolve({ ok: !error, out: String(stdout).trim(), error: error ? String(stderr || error.message).split("\n")[0] : "" }));
  });
}

function artefacts() {
  return [
    "ui/tokens.css",
    "projects/kata/public/tokens.css",
    "projects/yoru/design-system/src/generated/tokens.css",
  ].map((file) => ({ file, exists: existsSync(path.join(REPO, file)) }));
}

const CSS = `<style>
  :root{--void:#0b0d14;--ink:#e6ecff;--dim:#a3adc3;--line:#202a5a;--line-soft:rgba(32,42,90,.45);
        --card:#151d2e;--rei:#a9b7e8;--ok:#91b7b3;--warn:#cead9a;--red:#e53935;
        --serif:"Cormorant Garamond",Georgia,serif;--mono:"IBM Plex Mono",ui-monospace,monospace;
        --radius-sm:6px;--radius-md:10px}
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--void);color:var(--ink);font:13px/1.55 Inter,ui-sans-serif,system-ui,sans-serif}
  body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
    background:radial-gradient(1100px 620px at 78% -10%,rgba(169,183,232,.10),transparent 60%),
               radial-gradient(900px 520px at 8% 108%,rgba(176,169,220,.07),transparent 62%)}
  body>*{position:relative;z-index:1}
  .bar{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:16px 22px;border-bottom:1px solid var(--line)}
  .brand{display:inline-flex;align-items:baseline;gap:12px}
  .brand .word{font-family:var(--serif);font-size:15px;letter-spacing:.42em;text-transform:uppercase}
  .brand .jp{font-family:var(--serif);font-size:11px;letter-spacing:.42em;color:var(--dim);opacity:.6}
  .brand .slash{color:var(--red);font-family:var(--mono);font-size:15px}
  .brand .tool{font-family:var(--mono);font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:var(--dim)}
  .clock{font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--dim)}
  main{padding:0 22px 60px;max-width:1180px;margin:0 auto}
  .label{font-family:var(--mono);font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--dim);margin:30px 0 14px}
  .swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
  .swatch{border:1px solid var(--line);border-radius:var(--radius-md);overflow:hidden;background:var(--card)}
  .swatch .chip{height:56px}
  .swatch .name{display:flex;justify-content:space-between;padding:8px 10px;font:11px var(--mono);color:var(--dim)}
  .swatch .name b{color:var(--ink);font-weight:500}
  .type-row{display:flex;align-items:baseline;gap:16px;padding:10px 0;border-bottom:1px solid var(--line-soft)}
  .type-row .tag{width:70px;font:10px var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--dim)}
  .scale{display:flex;flex-wrap:wrap;gap:18px;align-items:baseline;padding:8px 0}
  .grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
  .comp{border:1px solid var(--line);border-radius:var(--radius-md);background:var(--card);padding:14px}
  .comp h3{margin:0 0 2px;font:400 15px var(--serif);letter-spacing:.16em;text-transform:uppercase}
  .comp .note{margin:0 0 12px;color:var(--dim);font-size:12px}
  .comp .stage{background:var(--void);border:1px solid var(--line-soft);border-radius:var(--radius-sm);padding:16px;overflow:auto}
  .comp details{margin-top:10px}
  .comp summary{cursor:pointer;font:10px var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--dim)}
  .comp pre{margin:8px 0 0;padding:10px;background:#0d1018;border:1px solid var(--line);border-radius:var(--radius-sm);
    font:11px/1.6 var(--mono);overflow:auto;color:#cfd8f2}
  .tokens{width:100%;border-collapse:collapse}
  .tokens td{padding:7px 6px;border-bottom:1px solid var(--line-soft);font-size:12px;vertical-align:middle}
  .tokens td.key{font-family:var(--mono);font-size:11px;color:var(--dim);width:180px}
  .tokens input{width:100%;background:var(--void);border:1px solid var(--line);color:var(--ink);
    border-radius:var(--radius-sm);padding:6px 9px;font:11px var(--mono);outline:none}
  .tokens input:focus{border-color:var(--rei)}
  .tokens button{background:rgba(32,42,90,.5);border:1px solid var(--line);color:var(--ink);
    border-radius:var(--radius-sm);padding:6px 12px;font:10px var(--mono);letter-spacing:.16em;text-transform:uppercase;cursor:pointer}
  .tokens button:hover{border-color:var(--rei)}
  .err{color:var(--red);font:11px var(--mono);min-height:16px}
  .ok{color:var(--ok);font:11px var(--mono);min-height:16px}
  .bar.foot{border-top:1px solid var(--line);border-bottom:0;padding:8px 22px;font:11px var(--mono);color:var(--dim)}
</style>`;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>ayamai — kata</title>
<link rel="icon" href="/gehirn/favicon.ico"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap"/>
<link rel="stylesheet" href="${BASE}/css/tokens.css"/>
${CSS}</head><body>
<header class="bar">
  <a class="brand" href="${BASE || "/"}" style="text-decoration:none;color:inherit"><span class="word">AYAMAI</span><span class="jp">アヤマイ</span><span class="slash">/</span><span class="tool">kata</span><span class="jp">型</span></a>
  <span class="clock"><a href="/gehirn/" style="color:var(--dim);text-decoration:none">gehirn</a> · <span id="stamp">--:--:--</span></span>
</header>
<main>
  <p class="label">foundations · colour</p>
  <div class="swatches" id="swatches"></div>

  <p class="label">foundations · typography</p>
  <div class="type-row"><span class="tag">serif</span><span style="font:400 26px var(--serif);letter-spacing:.2em">AYAMAI アヤマイ</span></div>
  <div class="type-row"><span class="tag">sans</span><span style="font:400 15px var(--sans)">A quiet place to run things.</span></div>
  <div class="type-row"><span class="tag">mono</span><span style="font:400 13px var(--mono)">0 1 2 3 4 5 · :8081 · +1.2 ms</span></div>

  <p class="label">foundations · radius &amp; spacing</p>
  <div class="scale" id="scale"></div>

  <p class="label">components</p>
  <div class="grid2" id="components"></div>

  <p class="label">editor</p>
  <p style="margin:0 0 10px;color:var(--dim);font-size:12px">Changing a value writes <code>projects/kata/tokens.json</code> and regenerates every stylesheet that consumes it.</p>
  <table class="tokens"><tbody id="tokens"></tbody></table>
  <p class="err" id="err"></p><p class="ok" id="ok"></p>
</main>
<footer class="bar foot"><span>kata · 型</span><span id="artefacts"></span></footer>
<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  function el(tag, cls, text){ var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var state = null;

  function renderColour(){
    var host = $("swatches"); host.innerHTML = "";
    Object.keys(state.tokens.color).forEach(function(key){
      var value = state.tokens.color[key];
      var box = el("div","swatch");
      var chip = el("div","chip"); chip.style.background = value; box.appendChild(chip);
      var name = el("div","name"); name.appendChild(el("b", null, key)); name.appendChild(el("span", null, value));
      box.appendChild(name);
      box.style.cursor = "pointer";
      box.title = "copy var(--" + key + ")";
      box.addEventListener("click", function(){ navigator.clipboard.writeText("var(--" + key + ")"); });
      host.appendChild(box);
    });
  }

  function renderScale(){
    var host = $("scale"); host.innerHTML = "";
    Object.keys(state.tokens.radius).forEach(function(key){
      var box = el("div"); box.style.cssText = "width:64px;height:44px;border:1px solid var(--line);background:var(--card);display:grid;place-items:center;font:10px var(--mono);color:var(--dim);border-radius:" + state.tokens.radius[key];
      box.textContent = "r-" + key; host.appendChild(box);
    });
    Object.keys(state.tokens.spacing).forEach(function(key){
      var box = el("div"); box.style.cssText = "width:" + state.tokens.spacing[key] + ";height:" + state.tokens.spacing[key] + ";background:var(--rei);border-radius:2px;min-width:4px;min-height:4px";
      box.title = "space-" + key + " · " + state.tokens.spacing[key]; host.appendChild(box);
    });
  }

  function renderComponents(){
    var host = $("components"); host.innerHTML = "";
    state.components.forEach(function(comp){
      var box = el("div","comp");
      box.appendChild(el("h3", null, comp.name));
      box.appendChild(el("p","note", comp.note));
      var stage = el("div","stage"); stage.innerHTML = comp.markup; box.appendChild(stage);
      var details = el("details");
      details.appendChild(el("summary", null, "snippet"));
      var pre = el("pre"); pre.textContent = comp.markup; details.appendChild(pre);
      box.appendChild(details);
      host.appendChild(box);
    });
  }

  function renderTokens(){
    var body = $("tokens"); body.innerHTML = "";
    ["color","radius","spacing","typography"].forEach(function(group){
      Object.keys(state.tokens[group] || {}).forEach(function(key){
        var tr = el("tr");
        tr.appendChild(el("td","key", group + "." + key));
        var cell = el("td"); var input = el("input"); input.value = state.tokens[group][key];
        cell.appendChild(input); tr.appendChild(cell);
        var act = el("td"); var button = el("button", null, "apply");
        button.addEventListener("click", function(){ apply(group + "." + key, input.value, button); });
        act.appendChild(button); tr.appendChild(act);
        body.appendChild(tr);
      });
    });
  }

  function apply(tokenPath, value, button){
    button.disabled = true;
    fetch("${BASE}/api/token", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cockpit": "1" },
      body: JSON.stringify({ path: tokenPath, value: value })
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, data: d }; }); })
      .then(function(result){
        button.disabled = false;
        if (!result.ok) { $("err").textContent = result.data.error || "could not save"; $("ok").textContent = ""; return; }
        $("err").textContent = "";
        $("ok").textContent = tokenPath + " → " + value + " · regenerated";
        refresh();
      });
  }

  function refresh(){
    fetch("${BASE}/api/state", { cache: "no-store" }).then(function(r){ return r.json(); }).then(function(data){
      state = data; renderColour(); renderScale(); renderComponents(); renderTokens();
      $("artefacts").textContent = data.artefacts.filter(function(a){ return a.exists; }).length + "/" + data.artefacts.length + " artefacts";
    });
  }

  setInterval(function(){ $("stamp").textContent = new Date().toLocaleTimeString(); }, 1000);
  $("stamp").textContent = new Date().toLocaleTimeString();
  refresh();
})();
</script></body></html>`;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (BASE && url.pathname.startsWith(BASE)) url.pathname = url.pathname.slice(BASE.length) || "/";

  if (req.method === "GET" && url.pathname === "/api/state") {
    const tokens = loadTokens(TOKENS);
    send(res, 200, { tokens, components: COMPONENTS, artefacts: artefacts(), errors: validateTokens(tokens) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/css/tokens.css") {
    const file = path.join(HERE, "public", "tokens.css");
    send(res, existsSync(file) ? 200 : 404, existsSync(file) ? readFileSync(file, "utf8") : "/* run node projects/kata/build.mjs */",
      "text/css; charset=utf-8");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/token") {
    if (req.headers["x-cockpit"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    const body = await readJson(req);
    const current = loadTokens(TOKENS);
    const result = setToken(current, body?.path, body?.value);
    if (!result.ok) { send(res, 400, result); return; }
    const { writeFileSync } = await import("node:fs");
    writeFileSync(TOKENS, JSON.stringify(result.tokens, null, 2) + "\n");
    const built = await regenerate();
    send(res, built.ok ? 200 : 500, built.ok ? { ok: true } : { error: built.error });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    send(res, 200, PAGE, "text/html; charset=utf-8");
    return;
  }
  send(res, 404, { error: "not found" }, "text/plain; charset=utf-8");
}).listen(PORT, "127.0.0.1", () => console.log(`kata: http://127.0.0.1:${PORT}${BASE}`));
