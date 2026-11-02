#!/usr/bin/env node
// hisho — 秘書. The secretary's desk: the briefs, the queue, and the door the
// agents come through.
//
//   node projects/hisho/index.mjs        → http://127.0.0.1:4650/hisho/
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";

import { handle } from "./server.mjs";
import { recentAudit, REPO } from "./security.mjs";
import { dataRoot } from "../../packages/core/registry.mjs";
import { planTool } from "./security.mjs";

const PORT = Number(process.env.HISHO_PORT ?? 4650);
const BASE = (process.env.BASE_PREFIX ?? "").replace(/\/$/, "");
// The token lives where the platform puts its data, on every OS.
const TOKEN_FILE = path.join(dataRoot(), "agent-token");

function token() {
  try { return readFileSync(TOKEN_FILE, "utf8").trim(); } catch { return ""; }
}

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; if (raw.length > limit) req.destroy(); });
    req.on("end", () => resolve(raw));
  });
}

const CSS = `<style>
  :root{--void:#0b0d14;--ink:#e6ecff;--dim:#a3adc3;--line:#202a5a;--line-soft:rgba(32,42,90,.45);
        --card:#151d2e;--rei:#a9b7e8;--ok:#91b7b3;--warn:#cead9a;--red:#e53935;
        --serif:"Cormorant Garamond",Georgia,serif;--mono:"IBM Plex Mono",ui-monospace,monospace}
  *{box-sizing:border-box}
  html,body{margin:0;background:var(--void);color:var(--ink);font:13px/1.55 Inter,ui-sans-serif,system-ui,sans-serif}
  body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
    background:radial-gradient(1100px 620px at 78% -10%,rgba(169,183,232,.10),transparent 60%),
               radial-gradient(900px 520px at 8% 108%,rgba(176,169,220,.07),transparent 62%)}
  body>*{position:relative;z-index:1}
  .bar{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:16px 22px;border-bottom:1px solid var(--line)}
  .brand{display:inline-flex;align-items:baseline;gap:12px;color:inherit;text-decoration:none}
  .brand .word{font-family:var(--serif);font-size:15px;letter-spacing:.42em;text-transform:uppercase}
  .brand .jp{font-family:var(--serif);font-size:11px;letter-spacing:.42em;color:var(--dim);opacity:.6}
  .brand .slash{color:var(--red);font-family:var(--mono);font-size:15px}
  .brand .tool{font-family:var(--mono);font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:var(--dim)}
  .clock{font-family:var(--mono);font-size:11px;color:var(--dim)}
  .grid{display:grid;grid-template-columns:1.2fr 1fr;min-height:calc(100vh - 57px)}
  .panel{padding:20px 22px 28px;border-right:1px solid var(--line)}
  .panel:last-child{border-right:0}
  .label{font-family:var(--mono);font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--dim);margin:0 0 14px}
  .label.after{margin-top:32px}
  .row{display:flex;gap:10px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--line-soft)}
  .row .id{width:36px;font-family:var(--mono);font-size:11px;color:var(--dim)}
  .row .title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .meta{font-family:var(--mono);font-size:10px;color:var(--dim)}
  .row .holder{font-family:var(--mono);font-size:10px;color:var(--ok)}
  pre{background:#0d1018;border:1px solid var(--line);border-radius:8px;padding:12px 14px;font:11px/1.7 var(--mono);
      overflow:auto;color:#cfd8f2;margin:0 0 10px}
  .hint{font-size:12px;color:var(--dim);margin:0 0 10px}
  .ledger{font:11px/1.7 var(--mono);color:var(--dim)}
  .ledger .ok{color:var(--ok)}.ledger .bad{color:var(--red)}
</style>`;

function page({ claimed, queue, ledger }) {
  const rows = (items) => items.map((item) => `<div class="row"><span class="id">#${item.id}</span><span class="title">${escapeHtml(item.title)}</span>${item.assignee ? `<span class="holder">${escapeHtml(item.assignee)}</span>` : ""}<span class="meta">P${item.priority} ${escapeHtml(item.project || "-")}</span></div>`).join("") || `<p class="hint">nothing</p>`;
  const calls = ledger.map((entry) => `<div><span class="${entry.ok ? "ok" : "bad"}">${entry.ok ? "ok  " : "fail"}</span> ${escapeHtml(entry.tool)} · ${entry.ms ?? 0} ms · ${escapeHtml((entry.args ?? []).join(", "))}</div>`).join("") || `<p class="hint">no calls yet</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>ayamai — hisho</title>
<link rel="icon" href="/gehirn/favicon.ico"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500&display=swap"/>
${CSS}</head><body>
<header class="bar">
  <a class="brand" href="${BASE || "/"}"><span class="word">AYAMAI</span><span class="jp">アヤマイ</span><span class="slash">/</span><span class="tool">hisho</span><span class="jp">秘書</span></a>
  <span class="clock"><a href="/gehirn/" style="color:var(--dim);text-decoration:none">gehirn</a> · <span id="clock">--:--:--</span></span>
</header>
<main class="grid">
  <section class="panel">
    <p class="label">claimed</p>
    ${rows(claimed)}
    <p class="label after">queue</p>
    ${rows(queue)}
  </section>
  <section class="panel">
    <p class="label">connect</p>
    <p class="hint">Claude Code, Cursor, or any MCP client:</p>
    <pre>claude mcp add ayamai -- node ${escapeHtml(REPO)}/projects/hisho/stdio.mjs</pre>
    <p class="hint">over the door, with the agent token:</p>
    <pre>POST http://ayamai.local/hisho/mcp
x-ayamai-token: &lt;token&gt;</pre>
    <p class="label after">ledger</p>
    <div class="ledger">${calls}</div>
  </section>
</main>
<script>setInterval(function(){document.getElementById('clock').textContent=new Date().toLocaleTimeString();},1000);document.getElementById('clock').textContent=new Date().toLocaleTimeString();</script>
</body></html>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function snapshot() {
  const listing = await planTool(["list", "--all", "--json"]);
  let items = [];
  try { items = JSON.parse(listing.out || "[]"); } catch { items = []; }
  const now = Date.now();
  const isClaimed = (item) => item.assignee && Number(item.leaseUntil ?? 0) > now;
  return {
    claimed: items.filter(isClaimed),
    queue: items.filter((item) => item.status !== "done" && !isClaimed(item)),
    ledger: recentAudit(12),
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (BASE && url.pathname.startsWith(BASE)) url.pathname = url.pathname.slice(BASE.length) || "/";

  if (req.method === "GET" && url.pathname === "/api/state") { send(res, 200, await snapshot()); return; }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) { send(res, 200, page(await snapshot()), "text/html; charset=utf-8"); return; }

  if (req.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/")) {
    const expected = token();
    if (!expected) { send(res, 503, { error: "no agent token on this machine" }); return; }
    if (req.headers["x-ayamai-token"] !== expected) { send(res, 401, { error: "unauthorized" }); return; }
    let message;
    try { message = JSON.parse(await readBody(req)); } catch { send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); return; }
    const response = await handle(message, { by: "http" });
    if (!response) { send(res, 202, { ok: true }); return; }
    send(res, 200, response);
    return;
  }

  send(res, 404, { error: "not found" }, "text/plain; charset=utf-8");
}).listen(PORT, "127.0.0.1", () => console.log(`hisho: http://127.0.0.1:${PORT}${BASE}`));
