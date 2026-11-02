#!/usr/bin/env node
// seiri — 整理. Putting the work in order.
//
//   node projects/seiri/index.mjs
//
// Reads the plan store, the repositories on this machine and the vault. Writes
// one thing only: plan status. Same data as `status`, same truth as `plan`.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const HOME = process.env.HOME;
const REPO = process.env.AYAMAI_REPO ?? path.resolve(import.meta.dirname, "../..");
const PLAN = path.join(REPO, "toys/plan/plan.mjs");
const VAULT = "/mnt/y/ayamai";
const ACTIVITY = path.join(VAULT, "state/activity.json");
const CATALOG = path.join(REPO, "catalog.json");

/** The rail is catalog-driven: a new project shows up without editing this file. */
function catalogEntries() {
  try { return JSON.parse(readFileSync(CATALOG, "utf8")).entries; } catch { return []; }
}

function catalogIds() {
  return catalogEntries().map((entry) => entry.id);
}

const IDEAS = ideasFile(REPO);

/** One request through the stored key. Nothing else in seiri touches the model. */
async function askModel(prompt) {
  const store = readStore();
  const id = store.active ?? "deepseek";
  const provider = providerById(id);
  if (!provider) return { ok: false, error: "no provider configured" };
  const entry = store.keys?.[id];
  if (provider.keyed && !entry?.apiKey) return { ok: false, error: "no key stored — add one in gehirn" };
  const result = await runPrompt({
    providerId: id,
    prompt,
    model: entry?.model ?? provider.model,
    baseURL: entry?.baseURL ?? provider.baseURL,
    apiKey: entry?.apiKey ?? "",
    temperature: 0.4,
    maxTokens: 1400,
  });
  return result.ok ? { ok: true, text: result.text } : { ok: false, error: result.error };
}

function ideaPayload() {
  const ideas = loadIdeas(IDEAS);
  const rows = [...ideas.values()]
    .sort((a, b) => b.id - a.id)
    .slice(0, 20)
    .map((idea) => ({ id: idea.id, text: idea.text, project: idea.project, mode: idea.mode, created: idea.created, status: idea.status, stories: idea.stories, planIds: idea.planIds }));
  return { ideas: rows, hasKey: Boolean(readStore().keys?.[readStore().active ?? "deepseek"]?.apiKey), projects: catalogEntries().map((entry) => ({ id: entry.id, kind: entry.kind, summary: entry.summary })) };
}
const PORT = Number(process.env.SEIRI_PORT ?? process.env.BOARD_PORT ?? 4460);
const BASE = (process.env.BASE_PREFIX ?? "").replace(/\/$/, "");
import { buildRail, validateAction, visiblePlans } from "./lib.mjs";
import { draftIdea, ideasFile, load as loadIdeas, nextId, record as recordIdea, validateCapture } from "./ideas.mjs";
import { providerById, readStore, runPrompt } from "../../packages/llm/index.mjs";
const GLYPH = { todo: "-", doing: ">", blocked: "!", done: "x" };

function run(command, args, cwd) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: 15_000, maxBuffer: 1 << 22 }, (error, stdout) =>
      resolve(error ? "" : String(stdout).trim()));
  });
}

async function planList() {
  const raw = await run(process.execPath, [PLAN, "list", "--all", "--json"], REPO);
  try { return JSON.parse(raw || "[]"); } catch { return []; }
}

async function planDirty() {
  const raw = await run(process.execPath, [PLAN, "dirty", "--repo", REPO, "--json"], REPO);
  try { return JSON.parse(raw || "[]"); } catch { return []; }
}

async function repos() {
  const found = await run("find", [HOME, "-maxdepth", "3", "-type", "d", "-name", ".git",
    "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.nvm/*"]);
  const dirs = found.split("\n").filter(Boolean).map((dir) => dir.replace(/\/\.git$/, "")).sort();
  const rows = [];
  for (const dir of dirs.slice(0, 12)) {
    const [branch, status, last] = await Promise.all([
      run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]),
      run("git", ["-C", dir, "status", "--porcelain"]),
      run("git", ["-C", dir, "log", "-1", "--format=%cr"]),
    ]);
    rows.push({
      name: path.basename(dir),
      branch: branch || "?",
      dirty: status.split("\n").filter(Boolean).length,
      last: last.replace(/ ago$/, "") || "no commits",
    });
  }
  return rows;
}

function activity() {
  try { return JSON.parse(readFileSync(ACTIVITY, "utf8")); } catch { return null; }
}

async function state() {
  const [plans, dirty, repoRows] = await Promise.all([planList(), planDirty(), repos()]);
  return {
    at: Date.now(),
    plans: plans
      .map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status ?? "todo",
        priority: item.priority ?? 3,
        project: item.project ?? "",
        assignee: item.assignee ?? null,
        leaseUntil: item.leaseUntil ?? null,
      }))
      .sort((a, b) => a.priority - b.priority || a.id - b.id),
    dirty,
    repos: repoRows,
    activity: activity(),
    projects: buildRail(plans.map((item) => ({ project: item.project ?? "", status: item.status ?? "todo" })), catalogIds()),
    repo: REPO,
    ideas: ideaPayload(),
    counts: {
      open: plans.filter((item) => (item.status ?? "todo") !== "done").length,
      done: plans.filter((item) => item.status === "done").length,
      dirty: repoRows.filter((row) => row.dirty > 0).length,
    },
  };
}

// ---- writes -----------------------------------------------------------------

/** Pure: validate a write before any process starts. */

function runPlan(argv) {
  return new Promise((resolve) => {
    execFile(process.execPath, [PLAN, ...argv], { cwd: REPO, timeout: 20_000 }, (error, stdout, stderr) =>
      resolve({ ok: !error, out: String(stdout).trim(), error: error ? String(stderr || error.message).split("\n")[0] : "" }));
  });
}

// ---- the page ---------------------------------------------------------------

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
  .brand{display:inline-flex;align-items:baseline;gap:12px;color:var(--ink);text-decoration:none}
  .brand .word{font-family:var(--serif);font-size:15px;letter-spacing:.42em;text-transform:uppercase}
  .brand .jp{font-family:var(--serif);font-size:11px;letter-spacing:.42em;color:var(--dim);opacity:.6}
  .brand .slash{color:var(--red);font-family:var(--mono);font-size:15px}
  .brand .tool{font-family:var(--mono);font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:var(--dim)}
  .clock{font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--dim)}
  .grid{display:grid;grid-template-columns:1.15fr 1.35fr 1fr;min-height:calc(100vh - 57px)}
  .panel{padding:20px 22px 28px;border-right:1px solid var(--line)}
  .panel:last-child{border-right:0}
  .label{font-family:var(--mono);font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--dim);margin:0 0 14px}
  .label.after{margin-top:34px}
  .row{display:flex;gap:10px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--line-soft)}
  .row:last-child{border-bottom:0}
  .row .id{width:34px;flex:none;font-family:var(--mono);font-size:11px;color:var(--dim)}
  .row .pr{width:26px;flex:none;font-family:var(--mono);font-size:10px;color:var(--dim)}
  .row .title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .row .title b{font-weight:500}
  .row .meta{flex:none;font-family:var(--mono);font-size:10px;color:var(--dim)}
  .glyph{width:12px;flex:none;font-family:var(--mono);color:var(--rei)}
  .glyph.done{color:var(--dim)}.glyph.blocked{color:var(--red)}.glyph.doing{color:var(--ok)}
  .acts{display:flex;gap:4px;flex:none}
  .acts button{background:none;border:1px solid transparent;border-radius:4px;padding:1px 5px;cursor:pointer;
    color:var(--dim);font:10px var(--mono)}
  .acts button:hover{border-color:var(--line);color:var(--ink)}
  .table{width:100%;border-collapse:collapse}
  .table td{padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:12px}
  .table tr:last-child td{border-bottom:0}
  .table td.right{text-align:right;font-family:var(--mono);font-size:11px;color:var(--dim)}
  .stats{margin:0}
  .stat{display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--line-soft)}
  .stat:last-child{border-bottom:0}.stat dt{color:var(--dim)}.stat dd{margin:0;font-family:var(--mono);font-size:13px}
  .add{display:flex;gap:8px;margin-top:14px}
  .add input{flex:1;background:var(--void);border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:7px 10px;font:12px var(--mono);outline:none}
  .add input:focus{border-color:var(--rei)}
  .add select{background:var(--void);border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:7px 8px;font:11px var(--mono)}
  .add button{background:rgba(32,42,90,.5);border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:7px 12px;font:11px var(--mono);cursor:pointer}
  .add button:hover{border-color:var(--rei)}
  .capture{display:flex;flex-direction:column;gap:8px;margin-bottom:6px}
  .capture textarea{width:100%;background:var(--void);border:1px solid var(--line);color:var(--ink);border-radius:6px;
    padding:8px 10px;font:12px/1.5 var(--mono);resize:vertical;outline:none}
  .capture textarea:focus{border-color:var(--rei)}
  .capture-row{display:flex;gap:6px;align-items:center}
  .capture-row select{flex:1;background:var(--void);border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:6px 8px;font:11px var(--mono)}
  .capture-row button{background:rgba(32,42,90,.5);border:1px solid var(--line);color:var(--ink);border-radius:6px;padding:6px 12px;font:10px var(--mono);letter-spacing:.12em;text-transform:uppercase;cursor:pointer}
  .capture-row button:hover{border-color:var(--rei)}
  .capture-row button:disabled{opacity:.5;cursor:default}
  .idea-row{display:flex;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--line-soft);font:11px var(--mono)}
  .idea-row .id{color:var(--dim);width:56px;flex:none}
  .idea-row .text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}
  .idea-row .badge{flex:none;color:var(--dim);font-size:9px;letter-spacing:.16em;text-transform:uppercase}
  .idea-row.unpacked .badge{color:var(--ok)}
  .draft{display:grid;grid-template-columns:20px 1fr;gap:6px 8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line-soft)}
  .draft input[type=text]{width:100%;background:var(--void);border:1px solid var(--line);color:var(--ink);border-radius:4px;padding:4px 7px;font:11px var(--mono)}
  .draft select{background:var(--void);border:1px solid var(--line);color:var(--ink);border-radius:4px;padding:4px 6px;font:10px var(--mono)}
  .draft .meta2{display:flex;gap:6px;align-items:center}
  .draft label{display:flex;gap:6px;align-items:center;color:var(--dim);font:10px var(--mono)}
  .rail{display:flex;flex-direction:column;gap:2px;margin-bottom:6px}
  .rail button{display:flex;justify-content:space-between;gap:10px;background:none;border:1px solid transparent;border-radius:6px;
    padding:5px 8px;font:11px var(--mono);color:var(--dim);cursor:pointer;text-align:left}
  .rail button:hover{border-color:var(--line);color:var(--ink)}
  .rail button.on{border-color:var(--rei);color:var(--ink);background:rgba(169,183,232,.08)}
  .rail button .n{color:var(--dim)}
  .rail button.on .n{color:var(--rei)}
  .hand{margin-top:8px;border:1px solid var(--line);border-radius:6px;padding:8px 10px;background:#0d1018}
  .hand p{margin:0 0 6px;font:10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
  .hand code{display:block;font:11px/1.5 var(--mono);color:var(--psale,#e6ecff);word-break:break-all;margin-bottom:6px}
  .hand button{background:rgba(32,42,90,.5);border:1px solid var(--line);color:var(--ink);border-radius:4px;padding:3px 8px;font:10px var(--mono);cursor:pointer}
  .lease{font:10px var(--mono);color:var(--ok)}
  .filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
  .filters button{background:none;border:1px solid var(--line);border-radius:999px;padding:3px 10px;font:10px var(--mono);
    letter-spacing:.14em;text-transform:uppercase;color:var(--dim);cursor:pointer}
  .filters button.on{border-color:var(--rei);color:var(--ink)}
  .bar.foot{border-top:1px solid var(--line);border-bottom:0;padding:8px 22px;font-family:var(--mono);font-size:11px;color:var(--dim)}
  .err{color:var(--red);font:11px var(--mono)}
  .hint{color:var(--dim);font:10px var(--mono)}
</style>`;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>ayamai — seiri</title>
<link rel="icon" href="/gehirn/favicon.ico"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap"/>
${CSS}</head><body>
<header class="bar">
  <a class="brand" href="${BASE || "/"}"><span class="word">AYAMAI</span><span class="jp">アヤマイ</span><span class="slash">/</span><span class="tool">seiri</span><span class="jp">整理</span></a>
  <span class="clock"><span id="counts">—</span> · <a href="/gehirn/" style="color:var(--dim);text-decoration:none">gehirn</a> · <span id="clock">--:--:--</span></span>
</header>
<main class="grid">
  <section class="panel">
    <p class="label">capture</p>
    <div class="capture">
      <textarea id="idea-text" rows="2" maxlength="2000" placeholder="an idea, half-formed is fine"></textarea>
      <div class="capture-row">
        <select id="idea-project"></select>
        <button id="idea-remember" title="keep it for later (Ctrl+Enter)">remember</button>
        <button id="idea-unpack" title="ask the model to unpack it">unpack</button>
      </div>
      <p class="hint" id="idea-status"></p>
      <div id="idea-review"></div>
    </div>
    <p class="label after">ideas <span class="hint" id="idea-count"></span></p>
    <div id="ideas"><span class="hint">nothing yet</span></div>
    <p class="label after">projects</p>
    <div class="rail" id="rail"></div>
    <p class="label after">plans <span class="hint" id="plan-count"></span></p>
    <div class="filters" id="filters"></div>
    <div id="plans"><span class="hint">reading…</span></div>
    <div class="add">
      <input id="new-title" placeholder="add an item" maxlength="120"/>
      <select id="new-priority"><option value="1">P1</option><option value="2">P2</option><option value="3" selected>P3</option><option value="4">P4</option></select>
      <select id="new-project"></select>
      <button id="new-add">add</button>
    </div>
    <p class="err" id="plan-error"></p>
    <div class="hand" id="hand" style="display:none"></div>
  </section>
  <section class="panel">
    <p class="label">repositories</p>
    <table class="table" id="repos"><tbody></tbody></table>
    <p class="label after">uncommitted</p>
    <div id="dirty"><span class="hint">none</span></div>
  </section>
  <section class="panel">
    <p class="label">activity</p>
    <div id="activity"><span class="hint">nothing recent</span></div>
    <p class="label after">box</p>
    <dl class="stats" id="box"></dl>
  </section>
</main>
<footer class="bar foot"><span id="updated">connecting</span><span>reads plan · git · vault · writes plan status</span></footer>
<script>
(function(){
  var state = null, filter = "all", project = localStorage.getItem("seiri.project") || "all", selected = 0;
  var drafting = false, review = [];
  var $ = function(id){ return document.getElementById(id); };
  function el(tag, cls, text){ var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function ideaWrite(payload){
    return fetch("${BASE}/api/ideas", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cockpit": "1" },
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, data: d }; }); });
  }

  function renderIdeas(){
    var info = (state && state.ideas) || { ideas: [], hasKey: false, projects: [] };
    var select = $("idea-project");
    if (select && !select.options.length) {
      info.projects.forEach(function(p){ var o = document.createElement("option"); o.value = p.id; o.textContent = p.id; select.appendChild(o); });
    }
    if (select && project !== "all" && project !== "other") select.value = project;
    var host = $("ideas"); host.innerHTML = "";
    $("idea-count").textContent = info.ideas.length ? info.ideas.length + " in the inbox" : "";
    if (!info.ideas.length) { host.appendChild(el("span","hint","nothing yet")); }
    info.ideas.forEach(function(idea){
      var row = el("div", "idea-row " + idea.status);
      row.appendChild(el("span", "id", "idea #" + idea.id));
      var text = el("span", "text", idea.text.replace(/[ \t\n]+/g, " ").slice(0, 90));
      text.title = idea.text;
      row.appendChild(text);
      var badge = el("span", "badge", idea.status === "unpacked" ? idea.planIds.map(function(id){ return "#" + id; }).join(" ") : idea.status);
      row.appendChild(badge);
      row.style.cursor = "pointer";
      row.title = "click to reopen";
      row.addEventListener("click", function(){
        $("idea-text").value = idea.text;
        if (idea.stories && idea.stories.length) { review = idea.stories.map(function(s){ return Object.assign({ keep: true }, s); }); renderReview(); }
        else { review = []; renderReview(); }
      });
      host.appendChild(row);
    });
    var unpack = $("idea-unpack");
    if (unpack) unpack.disabled = drafting || !info.hasKey;
    if (!info.hasKey) $("idea-status").textContent = "no model key — remember still works, unpack needs one in gehirn";
  }

  function renderReview(){
    var host = $("idea-review"); host.innerHTML = "";
    if (!review.length) return;
    review.forEach(function(story, index){
      var row = el("div", "draft");
      var check = document.createElement("input"); check.type = "checkbox"; check.checked = story.keep !== false;
      check.addEventListener("change", function(){ story.keep = check.checked; });
      row.appendChild(check);
      var title = document.createElement("input"); title.type = "text"; title.value = story.title;
      title.addEventListener("input", function(){ story.title = title.value; });
      row.appendChild(title);
      var meta = el("div", "meta2");
      var proj = document.createElement("select");
      ((state.ideas || {}).projects || []).forEach(function(p){ var o = document.createElement("option"); o.value = p.id; o.textContent = p.id; if (p.id === story.project) o.selected = true; proj.appendChild(o); });
      proj.addEventListener("change", function(){ story.project = proj.value; });
      var prio = document.createElement("select");
      [1,2,3,4].forEach(function(n){ var o = document.createElement("option"); o.value = n; o.textContent = "P" + n; if (n === story.priority) o.selected = true; prio.appendChild(o); });
      prio.addEventListener("change", function(){ story.priority = Number(prio.value); });
      meta.appendChild(proj); meta.appendChild(prio);
      if (story.body) { var why = el("label", null, "why"); why.title = story.body; meta.appendChild(why); }
      row.appendChild(meta);
      host.appendChild(row);
    });
    var actions = el("div", "capture-row");
    var create = el("button", null, "create " + review.filter(function(s){ return s.keep !== false; }).length);
    create.addEventListener("click", createStories);
    var discard = el("button", null, "discard");
    discard.addEventListener("click", function(){ review = []; renderReview(); });
    actions.appendChild(create); actions.appendChild(discard);
    host.appendChild(actions);
  }

  function remember(){
    var text = $("idea-text").value.trim();
    if (!text) return;
    ideaWrite({ action: "capture", text: text, project: $("idea-project").value, mode: "quick" }).then(function(result){
      if (!result.ok) { $("idea-status").textContent = result.data.error || "could not save"; return; }
      $("idea-status").textContent = "kept as idea #" + result.data.id;
      $("idea-text").value = "";
      refresh();
    });
  }

  function unpack(){
    var text = $("idea-text").value.trim();
    if (!text) { $("idea-status").textContent = "write the idea first"; return; }
    drafting = true;
    $("idea-unpack").disabled = true;
    $("idea-status").textContent = "unpacking…";
    ideaWrite({ action: "capture", text: text, project: $("idea-project").value, mode: "unpack" }).then(function(captured){
      if (!captured.ok) { drafting = false; $("idea-status").textContent = captured.data.error || "could not save"; return; }
      return ideaWrite({ action: "draft", id: captured.data.id }).then(function(result){
        drafting = false;
        if (!result.ok) { $("idea-status").textContent = result.data.error || "the model could not unpack that"; renderIdeas(); return; }
        review = result.data.stories.map(function(s){ return Object.assign({ keep: true }, s); });
        $("idea-status").textContent = "idea #" + captured.data.id + " · " + review.length + " stories" + (result.data.dropped && result.data.dropped.length ? " (" + result.data.dropped.length + " dropped)" : "");
        $("idea-text").value = "";
        renderReview();
        refresh();
      });
    });
  }

  function createStories(){
    var picked = review.filter(function(s){ return s.keep !== false; });
    if (!picked.length) return;
    var ideaId = /idea #([0-9]+)/.exec($("idea-status").textContent);
    var id = ideaId ? Number(ideaId[1]) : null;
    var payload = { action: "accept", stories: picked };
    if (id) payload.id = id;
    if (!id) { $("idea-status").textContent = "reopen the idea first"; return; }
    ideaWrite(payload).then(function(result){
      if (!result.ok) { $("idea-status").textContent = result.data.error || "could not create"; return; }
      $("idea-status").textContent = "created " + result.data.planIds.map(function(n){ return "#" + n; }).join(", ");
      review = []; renderReview();
      refresh();
    });
  }

  function renderRail(){
    var host = $("rail"); host.innerHTML = "";
    (state.projects || []).forEach(function(row){
      var b = el("button", project === row.id ? "on" : "");
      b.appendChild(el("span", null, row.id === "all" ? "all" : row.id));
      b.appendChild(el("span", "n", String(row.open)));
      b.title = row.id === "all" ? "every project" : "only " + row.id;
      b.addEventListener("click", function(){
        project = row.id; localStorage.setItem("seiri.project", project); selected = 0; render();
      });
      host.appendChild(b);
    });
    var select = $("new-project");
    if (select && !select.options.length) {
      (state.projects || []).filter(function(r){ return r.id !== "all" && r.id !== "other"; }).forEach(function(r){
        var option = document.createElement("option"); option.value = r.id; option.textContent = r.id;
        select.appendChild(option);
      });
    }
    if (select) select.value = (project === "all" || project === "other") ? "ayamai" : project;
  }

  function renderFilters(){
    var host = $("filters"); host.innerHTML = "";
    [["all","all"],["todo","todo"],["doing","doing"],["blocked","blocked"],["done","done"]].forEach(function(pair){
      var b = el("button", filter === pair[0] ? "on" : "", pair[1]);
      b.addEventListener("click", function(){ filter = pair[0]; render(); });
      host.appendChild(b);
    });
  }

  function write(payload){
    return fetch("${BASE}/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cockpit": "1" },
      body: JSON.stringify(payload)
    }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, data: d }; }); });
  }

  function renderPlans(){
    var host = $("plans"); host.innerHTML = "";
    var items = (state.plans || []).filter(function(item){
      if (filter !== "all" && item.status !== filter) return false;
      if (project === "all") return true;
      if (project === "other") return !item.project;
      return item.project === project;
    });
    $("plan-count").textContent = items.length + " shown";
    if (!items.length) { host.appendChild(el("span","hint","nothing here")); return; }
    items.forEach(function(item, index){
      var row = el("div", "row" + (index === selected ? " on" : ""));
      row.dataset.id = item.id;
      row.appendChild(el("span", "glyph " + item.status, item.status === "done" ? "x" : item.status === "blocked" ? "!" : item.status === "doing" ? ">" : "-"));
      row.appendChild(el("span", "id", "#" + item.id));
      row.appendChild(el("span", "pr", "P" + item.priority));
      var title = el("span", "title"); title.appendChild(el("b", null, item.title)); row.appendChild(title);
      if (project === "all") row.appendChild(el("span", "meta", item.project || "—"));
      var held = item.assignee && Number(item.leaseUntil || 0) > Date.now();
      if (held) {
        var left = Math.max(0, Math.round((Number(item.leaseUntil) - Date.now()) / 1000));
        var mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");
        var lease = el("span", "lease", item.assignee + " · " + mm + ":" + ss);
        lease.dataset.until = item.leaseUntil;
        row.appendChild(lease);
      }
      var acts = el("span", "acts");
      if (held) {
        var release = el("button", null, "\u00d7");
        release.title = "release from " + item.assignee;
        release.addEventListener("click", function(){
          write({ action: "release", id: item.id }).then(handleWrite);
        });
        acts.appendChild(release);
      } else {
        var hand = el("button", null, "\u2192");
        hand.title = "hand to an agent";
        hand.addEventListener("click", function(){ handOff(item); });
        acts.appendChild(hand);
      }
      [["doing","\u25B6"],["done","\u2713"],["blocked","!"]].forEach(function(pair){
        var status = pair[0];
        var b = el("button", null, pair[1]);
        b.title = "mark " + status;
        b.addEventListener("click", function(){
          write({ action: "set-status", id: item.id, status: status }).then(function(result){
            if (!result.ok) { $("plan-error").textContent = result.data.error || "write failed"; return; }
            $("plan-error").textContent = "";
            refresh();
          });
        });
        acts.appendChild(b);
      });
      row.appendChild(acts);
      host.appendChild(row);
    });
  }

  var handItem = null;

  function handleWrite(result){
    if (!result.ok) { $("plan-error").textContent = result.data.error || "write failed"; return; }
    $("plan-error").textContent = "";
    refresh();
  }

  function handOff(item){
    write({ action: "claim", id: item.id, by: "operator" }).then(function(result){
      if (!result.ok) { handleWrite(result); return; }
      var line = "claude mcp add ayamai -- node " + (state.repo || "") + "/projects/hisho/stdio.mjs";
      var ask = 'then: "take #' + item.id + ' — ' + item.title.replace(/"/g, "'") + '"';
      $("plan-error").textContent = "";
      var host = $("hand");
      host.style.display = "block";
      host.innerHTML = "";
      host.appendChild(el("p", null, "#" + item.id + " handed to operator"));
      var a = el("code", null, line); var b = el("code", null, ask);
      host.appendChild(a); host.appendChild(b);
      var copy = el("button", null, "copy");
      copy.addEventListener("click", function(){
        var text = line + "\\n" + ask;
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(function(){ copy.textContent = "copied"; setTimeout(function(){ copy.textContent = "copy"; }, 1200); });
        else { window.getSelection().selectAllChildren(host); copy.textContent = "select and copy"; }
      });
      host.appendChild(copy);
      refresh();
    });
  }

  function tickLeases(){
    var nodes = document.querySelectorAll(".lease");
    var now = Date.now();
    for (var i = 0; i < nodes.length; i++) {
      var until = Number(nodes[i].dataset.until || 0);
      var left = Math.max(0, Math.round((until - now) / 1000));
      var who = nodes[i].textContent.split(" · ")[0];
      var mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");
      nodes[i].textContent = who + " · " + mm + ":" + ss;
    }
  }

  function renderRepos(){
    var body = document.querySelector("#repos tbody"); body.innerHTML = "";
    (state.repos || []).forEach(function(repo){
      var tr = el("tr");
      tr.appendChild(el("td", null, repo.name));
      tr.appendChild(el("td", "right", repo.branch + " · " + (repo.dirty ? repo.dirty + " dirty" : "clean")));
      body.appendChild(tr);
    });
  }

  function renderDirty(){
    var host = $("dirty"); host.innerHTML = "";
    var rows = (state.dirty || []).slice(0, 12);
    if (!rows.length) { host.appendChild(el("span","hint","working tree clean")); return; }
    rows.forEach(function(item){
      var row = el("div","row");
      row.appendChild(el("span","id", String(item.id ? "#" + item.id : "-")));
      var title = el("span","title"); title.appendChild(el("b", null, item.file || item.title || "")); row.appendChild(title);
      host.appendChild(row);
    });
  }

  function renderActivity(){
    var host = $("activity"); host.innerHTML = "";
    var a = state.activity;
    if (!a) { host.appendChild(el("span","hint","no activity file")); return; }
    var items = Array.isArray(a.items) ? a.items.slice(0, 8) : [];
    if (!items.length) { host.appendChild(el("span","hint","nothing recent")); return; }
    items.forEach(function(item){
      var row = el("div","row");
      var title = el("span","title"); title.appendChild(el("b", null, item.title || String(item))); row.appendChild(title);
      host.appendChild(row);
    });
  }

  function renderBox(){
    var host = $("box"); host.innerHTML = "";
    [["open", state.counts.open], ["done", state.counts.done], ["dirty repos", state.counts.dirty]].forEach(function(pair){
      var stat = el("div","stat");
      stat.appendChild(el("dt", null, pair[0]));
      stat.appendChild(el("dd", null, String(pair[1])));
      host.appendChild(stat);
    });
    $("counts").textContent = state.counts.open + " open · " + state.counts.dirty + " dirty";
  }

  function render(){ renderIdeas(); renderRail(); renderFilters(); renderPlans(); renderRepos(); renderDirty(); renderActivity(); renderBox(); }

  function refresh(){
    fetch("${BASE}/api/state", { cache: "no-store" })
      .then(function(r){ return r.json(); })
      .then(function(data){ state = data; render(); $("updated").textContent = "updated " + new Date(data.at).toLocaleTimeString(); })
      .catch(function(){ $("updated").textContent = "lost the loop"; });
  }

  $("idea-remember").addEventListener("click", remember);
  $("idea-unpack").addEventListener("click", unpack);
  $("idea-text").addEventListener("keydown", function(event){
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); remember(); }
  });

  $("new-add").addEventListener("click", function(){
    var title = $("new-title").value.trim();
    if (!title) return;
    write({ action: "add", title: title, priority: Number($("new-priority").value), project: $("new-project").value || "ayamai" }).then(function(result){
      if (!result.ok) { $("plan-error").textContent = result.data.error || "could not add"; return; }
      $("new-title").value = ""; $("plan-error").textContent = ""; refresh();
    });
  });

  document.addEventListener("keydown", function(event){
    if (event.target.tagName === "INPUT" || event.target.tagName === "SELECT") return;
    var visible = (state && state.plans || []).filter(function(item){ return filter === "all" || item.status === filter; });
    if (event.key === "j") { selected = Math.min(visible.length - 1, selected + 1); renderPlans(); }
    else if (event.key === "k") { selected = Math.max(0, selected - 1); renderPlans(); }
    else if ((event.key === "d" || event.key === "b") && visible[selected]) {
      var status = event.key === "d" ? "done" : "blocked";
      write({ action: "set-status", id: visible[selected].id, status: status }).then(function(){ refresh(); });
    }
  });

  setInterval(function(){ $("clock").textContent = new Date().toLocaleTimeString(); tickLeases(); }, 1000);
  $("clock").textContent = new Date().toLocaleTimeString();
  refresh();
  setInterval(refresh, 5000);
})();
</script></body></html>`;

// ---- server -----------------------------------------------------------------

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

createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (BASE && url.pathname.startsWith(BASE)) url.pathname = url.pathname.slice(BASE.length) || "/";

  if (req.method === "GET" && url.pathname === "/api/state") { send(res, 200, await state()); return; }

  if (req.method === "POST" && url.pathname === "/api/ideas") {
    if (req.headers["x-cockpit"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    const body = await readJson(req);
    const action = String(body?.action ?? "");
    const file = IDEAS;

    if (action === "capture") {
      const checked = validateCapture(body);
      if (!checked.ok) { send(res, 400, checked); return; }
      const ideas = loadIdeas(file);
      const id = nextId(ideas);
      recordIdea(file, { t: "idea", id, text: checked.text, project: checked.project || null, mode: checked.mode });
      send(res, 200, { ok: true, id });
      return;
    }

    if (action === "draft") {
      const idea = loadIdeas(file).get(Number(body?.id));
      if (!idea) { send(res, 404, { error: "no such idea" }); return; }
      const projects = catalogEntries().map((entry) => ({ id: entry.id, kind: entry.kind, summary: entry.summary }));
      const result = await draftIdea({ file, idea, projects, ask: askModel });
      send(res, result.ok ? 200 : 502, result);
      return;
    }

    if (action === "accept") {
      const idea = loadIdeas(file).get(Number(body?.id));
      if (!idea) { send(res, 404, { error: "no such idea" }); return; }
      if (idea.planIds?.length) { send(res, 200, { ok: true, planIds: idea.planIds, already: true }); return; }
      const stories = Array.isArray(body?.stories) ? body.stories.slice(0, 6) : [];
      if (!stories.length) { send(res, 400, { error: "pick at least one story" }); return; }
      const planIds = [];
      for (const story of stories) {
        const title = String(story?.title ?? "").trim();
        if (!title) continue;
        const known = catalogIds();
        const asked = String(story?.project ?? "");
        const project = known.includes(asked) ? asked : (known.includes(idea.project) ? idea.project : known[0] ?? "ayamai");
        const priority = Number(story?.priority ?? 3);
        const created = await runPlan(["add", title.slice(0, 120), "--project", project, "--priority",
          String([1, 2, 3, 4].includes(priority) ? priority : 3), "--labels", `idea:${idea.id}`,
          "--body", `from idea #${idea.id} · ${idea.text.slice(0, 200)}\n\n${String(story?.body ?? "")}`]);
        const match = /#(\d+)/.exec(created.out ?? "");
        if (created.ok && match) planIds.push(Number(match[1]));
      }
      if (!planIds.length) { send(res, 502, { error: "the plan tool refused every story" }); return; }
      recordIdea(file, { t: "accept", id: idea.id, planIds });
      send(res, 200, { ok: true, planIds });
      return;
    }

    if (action === "archive") {
      if (!loadIdeas(file).has(Number(body?.id))) { send(res, 404, { error: "no such idea" }); return; }
      recordIdea(file, { t: "archive", id: Number(body?.id) });
      send(res, 200, { ok: true });
      return;
    }

    send(res, 400, { error: `unknown action "${action}"` });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/plan") {
    if (req.headers["x-cockpit"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    const body = await readJson(req);
    const checked = validateAction(body);
    if (!checked.ok) { send(res, 400, checked); return; }
    const result = await runPlan(checked.argv);
    send(res, result.ok ? 200 : 500, result.ok ? { ok: true, argv: checked.argv } : { error: result.error });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    send(res, 200, PAGE, "text/html; charset=utf-8");
    return;
  }
  send(res, 404, { error: "not found" }, "text/plain; charset=utf-8");
}).listen(PORT, "127.0.0.1", () => console.log(`seiri: http://127.0.0.1:${PORT}${BASE}`));
