// The dev cockpit: the machine's control panel.
//
//   node scripts/gehirn.mjs                 → http://localhost:4490
//   GEHIRN_HOST=0.0.0.0 node scripts/gehirn.mjs    expose on the LAN
//
// It shows what is running, what is not, and starts what is not. Every action
// runs the argv the catalog declares; nothing here invents a shell line.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { staleness } from "../core/process.mjs";
import { SERVICES, REPO, probe, dockerContainers, blockedReason, findRom, entriesFor, pidOnPort, ssDump } from "./services.mjs";
import { dataRoot, loadRegistry } from "../core/registry.mjs";
import { loadCatalog, resolveEntry } from "../core/catalog.mjs";
import { renderMarkdown, escapeHtml } from "./markdown.mjs";
import { listTree, readFileSafe } from "./files.mjs";
import { projects } from "./projects.mjs";
import { act, actProject, isTrustedRequest, recentActions, logAction } from "./actions.mjs";
import { renderPage } from "./page.mjs";
import { collect as collectFreshness } from "./freshness.mjs";
import { faceFor, rankProjects, readMode, writeMode } from "../core/mode.mjs";
import { brand } from "../../ui/brand.mjs";
import { publicState, saveKey, deleteKey, markVerified, readStore, noteRun, runPrompt, providerById, contextBrief } from "../llm/index.mjs";
import { sweep, sweepStatus } from "./pixiv.mjs";

const PORT = Number(process.env.GEHIRN_PORT ?? 4490);
const HOST = process.env.GEHIRN_HOST ?? "127.0.0.1";
const STARTED = Date.now();

const APP_PUBLIC = path.join(REPO, "projects", "yoru", "app", "public");

// A fixed allowlist. The cockpit serves the brand; it never serves the repo.
const STATIC = new Map([
  ["/ui/ui.css", { file: path.join(REPO, "ui", "ui.css"), type: "text/css; charset=utf-8" }],
  // ui.css @imports the generated tokens; without them everything is unstyled.
  ["/ui/tokens.css", { file: path.join(REPO, "ui", "tokens.css"), type: "text/css; charset=utf-8" }],
  ["/brand/mark.png", { file: path.join(APP_PUBLIC, "brand", "mark.png"), type: "image/png" }],
  ["/portrait.png", { file: path.join(APP_PUBLIC, "landing-glance.png"), type: "image/png" }],
  ["/favicon.ico", { file: path.join(APP_PUBLIC, "favicon.ico"), type: "image/x-icon" }],
  ["/favicon.svg", { file: path.join(APP_PUBLIC, "favicon.svg"), type: "image/svg+xml" }],
  ["/favicon-32x32.png", { file: path.join(APP_PUBLIC, "favicon-32x32.png"), type: "image/png" }],
  ["/apple-touch-icon.png", { file: path.join(APP_PUBLIC, "apple-touch-icon.png"), type: "image/png" }],
]);

function agentStatus() {
  return new Promise((resolve) => {
    const request = import("node:http").then(({ request: httpRequest }) => new Promise((done) => {
      const req = httpRequest({ host: "127.0.0.1", port: 8099, path: "/status", method: "GET", timeout: 1200 }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => { try { done(JSON.parse(body)); } catch { done(null); } });
      });
      req.on("error", () => done(null));
      req.on("timeout", () => { req.destroy(); done(null); });
      req.end();
    }));
    request.then(resolve);
  });
}

function phoneAddress() {
  try {
    const log = readFileSync("/mnt/c/Users/admin/ayamai-lan.log", "utf8");
    const found = [...log.matchAll(/http:\/\/(\d+\.\d+\.\d+\.\d+):25223/g)].map((match) => match[1]);
    const preferred = found.filter((ip) => ip.startsWith("10.") || ip.startsWith("192.168."));
    if (preferred.length) return `phone · http://${preferred[0]}:25223/feed`;
  } catch { /* the proxy has not started yet */ }
  return "";
}

function uptime() {
  const seconds = Math.round((Date.now() - STARTED) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The projects we build, with their live state where they have services. */
function catalogEntries(probes, mode = "dev") {
  const catalog = loadCatalog(REPO);
  const { entries, invalid } = catalog;
  const registry = loadRegistry(REPO);
  const wsl = existsSync("/proc/version") && readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  return {
    entries: rankProjects(entries, mode).map((entry) => {
      const resolved = resolveEntry(entry, REPO, { wsl, organizations: catalog.organizations, people: catalog.people });
      const registryProject = registry.projects.find((candidate) => candidate.id === entry.registryProject);
      let health = null;
      if (entry.registryProject) {
        const project = registry.projects.find((candidate) => candidate.id === entry.registryProject);
        const ports = (project?.services ?? []).map((service) => Number(service.port));
        const states = ports.map((port) => probes.find((probe) => probe.port === port)?.up);
        health = states.length ? (states.some(Boolean) ? "up" : "down") : null;
      }
      return {
        id: resolved.id, name: resolved.name, jp: resolved.jp, kind: resolved.kind,
        summary: resolved.summary, version: resolved.version,
        homePath: resolved.homePath, absPath: resolved.absPath,
        editorUri: resolved.editorUri, revealUri: resolved.revealUri,
        docs: resolved.docsResolved, links: resolved.links ?? [], extraPaths: resolved.extraPaths,
        org: resolved.org ? { id: resolved.org.id, name: resolved.org.name, owner: resolved.org.ownerName, summary: resolved.org.summary } : null,
        health,
        face: registryProject?.faces ? { play: faceFor(registryProject, "play"), dev: faceFor(registryProject, "dev") } : null,
      };
    }),
    invalid,
    people: catalog.people ?? [],
    organizations: catalog.organizations ?? [],
  };
}

/** Which service belongs to which project, derived once for the page. */
export function groupServices(probes) {
  const groups = {};
  for (const probe of probes) {
    const project = probe.project ?? "platform";
    groups[project] = [...(groups[project] ?? []), probe.id];
  }
  return groups;
}

/** The children the registry knows about — emulators under gemu, for now. */
export function childProjects() {
  return loadRegistry(REPO).children.map((child) => ({
    id: child.id,
    parent: child.parent,
    displayId: child.displayId,
    name: child.name,
    systems: child.emulator?.systems ?? [],
    upstream: child.upstream?.repo ?? "",
    license: child.upstream?.license ?? "",
    tag: child.upstream?.tag ?? "",
    fork: child.fork?.repo ?? "",
    branch: child.fork?.branch ?? "",
    exe: child.emulator?.exe ?? "",
    patches: countPatches(child.root),
  }));
}

function countPatches(dir) {
  try { return readdirSync(path.join(dir, "patches")).filter((name) => name.endsWith(".patch")).length; } catch { return 0; }
}

/** Open plan items per project. The plan store is flat; the panel wants them grouped. */
export function openPlans() {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(REPO, "toys/plan/plan.mjs"), "list", "--all", "--json"], { cwd: REPO, timeout: 10_000 }, (error, stdout) => {
      if (error) return resolve({ ok: false, groups: {} });
      try {
        const items = JSON.parse(stdout || "[]");
        const groups = {};
        for (const item of items) {
          if (item.status === "done" || item.status === "retired") continue;
          const key = item.project || "other";
          groups[key] = [...(groups[key] ?? []), { id: item.id, title: item.title, priority: item.priority, status: item.status }];
        }
        return resolve({ ok: true, groups, total: items.filter((item) => item.status !== "done" && item.status !== "retired").length });
      } catch { return resolve({ ok: false, groups: {} }); }
    });
  });
}

/** The last release on the record, and the version the tree claims. */
export function releaseState(repo = REPO, record = path.join(process.env.AYAMAI_DATA ?? path.join(process.env.HOME ?? ".", ".local/share/ayamai"), "publish.jsonl")) {
  let last = null;
  try {
    const lines = readFileSync(record, "utf8").trim().split("\n").filter(Boolean);
    last = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
  } catch { last = null; }
  let version = null;
  try {
    const catalog = JSON.parse(readFileSync(path.join(repo, "catalog.json"), "utf8"));
    version = (catalog.entries ?? []).find((entry) => entry.kind === "platform")?.version ?? null;
  } catch { version = null; }
  return { version, tag: last?.tag ?? null, at: last?.at ?? null, commit: last?.commit ? last.commit.slice(0, 7) : null };
}

async function snapshot() {
  const rom = findRom();
  const ss = await ssDump();
  const [probes, docker, projectRows, agent] = await Promise.all([
    Promise.all(SERVICES.map(async (service) => {
      const result = await probe(service);
      // The process is the code: if it started before the file it serves, it is old.
      const fresh = staleness({ pid: pidOnPort(ss, service.port), files: entriesFor(service.id, REPO) });
      return {
        stale: fresh.stale === true,
        startedAt: fresh.startMs,
        id: service.id,
        name: service.name,
        group: service.group,
        project: service.project ?? "platform",
        port: service.port,
        path: service.path ?? "/",
        publicPath: service.publicPath ?? null,
        note: service.note,
        self: Boolean(service.self),
        probe: service.probe,
        blocked: blockedReason(service, { rom }),
        ...result,
      };
    })),
    dockerContainers(),
    projects().catch(() => null),
    agentStatus(),
  ]);

  return {
    at: Date.now(),
    host: hostname(),
    uptime: uptime(),
    services: probes,
    groups: groupServices(probes),
    docker,
    projects: projectRows,
    mode: readMode(dataRoot()).mode,
    agent,
    lan: phoneAddress(),
    actions: recentActions(),
    release: releaseState(),
    llm: publicState(),
    catalog: catalogEntries(probes, readMode(dataRoot()).mode),
    children: childProjects(),
    plans: await openPlans(),
    sweep: probes.find((service) => service.id === "agent")?.up ? await sweepStatus() : null,
  };
}

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req, limit = 4096) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; if (raw.length > limit) req.destroy(); });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve(null); }
    });
  });
}

function readJson(req, limit = 4096) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; if (raw.length > limit) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve(null); } });
  });
}

const server = createServer(async (req, res) => {
  // A single bad render must not take the panel down: the door shows a 502 for
  // every route when this process dies, and the cause is in this log.
  try {
    await handle(req, res);
  } catch (error) {
    console.error("gehirn: request failed", error);
    try {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(`gehirn: ${String(error && error.message || error)}\n`);
    } catch { /* the socket is gone */ }
  }
});

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  // Behind the front door everything arrives under /gehirn; direct access does not.
  if (url.pathname === "/gehirn") { url.pathname = "/"; }
  else if (url.pathname.startsWith("/gehirn/")) url.pathname = url.pathname.slice("/gehirn".length);

  if (req.method === "GET" && STATIC.has(url.pathname)) {
    const entry = STATIC.get(url.pathname);
    try {
      const file = await readFile(entry.file);
      // These files change while you work on them; a cached copy is always wrong.
      res.writeHead(200, { "content-type": entry.type, "cache-control": "no-store" });
      res.end(file);
    } catch (error) {
      send(res, 404, { error: "asset missing", detail: String(error?.message ?? error), file: entry.file });
    }
    return;
  }

  // /gehirn/<project> is the same page; the client reads the path. Anything
  // that is not a known project id is a 404 but still renders, so a stale
  // bookmark explains itself.
  const projectMatch = /^\/([a-z][a-z0-9-]{1,31})\/?$/.exec(url.pathname);
  if (req.method === "GET" && projectMatch) {
    const known = catalogEntries([]).entries.some((entry) => entry.id === projectMatch[1]);
    res.writeHead(known ? 200 : 404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(renderPage({ hostname: hostname(), phone: phoneAddress(), startedAt: STARTED }));
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    send(res, 200, renderPage({ hostname: hostname(), phone: phoneAddress(), startedAt: STARTED }), "text/html; charset=utf-8");
    return;
  }

  // Opening an editor or a folder runs a Windows process. The page must ask with
  // our header; a foreign page cannot set one cross-origin.
  if (req.method === "POST" && (url.pathname === "/open/editor" || url.pathname === "/open/reveal")) {
    if (req.headers["x-gehirn"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    const body = await readJson(req);
    const { entries } = loadCatalog(REPO);
    const entry = entries.find((candidate) => candidate.id === String(body?.id ?? ""));
    if (!entry) { send(res, 404, { error: "no such project" }); return; }
    const abs = path.resolve(REPO, entry.path);
    const wsl = existsSync("/proc/version") && readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
    const distro = process.env.WSL_DISTRO_NAME ?? process.env.AYAMAI_WSL_DISTRO ?? "Ubuntu";

    let command;
    let args;
    if (url.pathname === "/open/reveal") {
      command = "explorer.exe";
      args = [wsl ? `\\\\wsl$\\${distro}${abs.replace(/\//g, "\\")}` : abs];
    } else {
      // The VS Code CLI, not the URI scheme: the handler on this machine does nothing.
      command = "powershell.exe";
      const codeBin = `${String.raw`$env:LOCALAPPDATA`}\\Programs\\Microsoft VS Code\\bin\\code.cmd`;
      const target = wsl ? `vscode-remote://wsl+${distro}${abs}` : abs;
      args = ["-NoProfile", "-Command", `& "${codeBin}" --folder-uri "${target.replace(/"/g, '')}"`];
    }
    execFile(command, args, { timeout: 20_000, windowsHide: true }, (error) => {
      // code.cmd and explorer commonly exit non-zero after doing their job.
      const missing = error && (error.code === "ENOENT" || /not recognized|not found/i.test(error.message));
      send(res, missing ? 500 : 200, missing ? { error: String(error.message).split("\n")[0] } : { ok: true, opened: abs });
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/catalog") {
    const snapshotNow = await snapshot();
    send(res, 200, snapshotNow.catalog);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/docs/")) {
    const [, , id, ...rest] = url.pathname.split("/");
    const doc = decodeURIComponent(rest.join("/"));
    const { entries } = loadCatalog(REPO);
    const entry = entries.find((candidate) => candidate.id === id);
    const allowed = (entry?.docs ?? []).includes(doc);
    if (!entry || !allowed) { send(res, 404, { error: "no such document" }, "text/plain; charset=utf-8"); return; }
    // Docs may live at the repository's docs/ rather than beside the project.
    const docRoot = doc.startsWith("docs/") ? REPO : path.resolve(REPO, entry.path);
    const docName = doc.startsWith("docs/") ? doc : doc;
    const read = readFileSafe(docRoot, docName);
    if (!read.ok) { send(res, 404, { error: read.error }, "text/plain; charset=utf-8"); return; }
    send(res, 200, docsPage(entry, doc, read.text), "text/html; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/files/")) {
    const [, , id, ...rest] = url.pathname.split("/");
    const tail = decodeURIComponent(rest.join("/"));
    const { entries } = loadCatalog(REPO);
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) { send(res, 404, { error: "no such project" }, "text/plain; charset=utf-8"); return; }
    const root = path.resolve(REPO, entry.path);
    if (!tail || tail.endsWith("/")) {
      const listing = listTree(root, tail);
      if (!listing.ok) { send(res, listing.error === "not found" ? 404 : 403, { error: listing.error }, "text/plain; charset=utf-8"); return; }
      send(res, 200, treePage(entry, listing), "text/html; charset=utf-8");
      return;
    }
    const read = readFileSafe(root, tail);
    if (!read.ok) {
      if (read.error === "is a directory") {
        const listing = listTree(root, `${tail}/`);
        send(res, listing.ok ? 200 : 403, listing.ok ? treePage(entry, listing) : { error: listing.error }, listing.ok ? "text/html; charset=utf-8" : "text/plain; charset=utf-8");
        return;
      }
      send(res, read.error === "not found" ? 404 : read.error === "binary" ? 415 : read.error?.includes("too large") ? 413 : 403,
        { error: read.error }, "text/plain; charset=utf-8");
      return;
    }
    send(res, 200, filePage(entry, read), "text/html; charset=utf-8");
    return;
  }

  if (url.pathname === "/api/mode") {
    if (req.method === "GET") { send(res, 200, readMode(dataRoot())); return; }
    if (req.method !== "POST") { send(res, 405, { error: "GET or POST" }); return; }
    if (req.headers["x-cockpit"] !== "1") { send(res, 403, { error: "untrusted request" }); return; }
    const body = await new Promise((resolve) => {
      let text = "";
      req.on("data", (chunk) => { text += chunk; if (text.length > 2048) req.destroy(); });
      req.on("end", () => { try { resolve(JSON.parse(text || "{}")); } catch { resolve({}); } });
    });
    try {
      const written = writeMode(dataRoot(), body?.mode);
      send(res, 200, { ok: true, ...written });
    } catch (error) {
      send(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (url.pathname === "/api/freshness") {
    const catalog = loadCatalog(REPO);
    send(res, 200, await collectFreshness({ repo: REPO, entries: catalog.entries ?? [], data: dataRoot() }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    send(res, 200, await snapshot());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/action") {
    if (!isTrustedRequest(req.headers)) {
      logAction("reject action → untrusted origin");
      send(res, 403, { error: "untrusted request" });
      return;
    }
    const body = await readBody(req);
    if (!body || typeof body.id !== "string") {
      send(res, 400, { error: "expected {id, action}" });
      return;
    }
    const result = await act(body.id, body.action);
    send(res, result.code, { ok: result.ok, message: result.message, command: result.command });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/project") {
    if (!isTrustedRequest(req.headers)) {
      logAction("reject project action → untrusted origin");
      send(res, 403, { error: "untrusted request" });
      return;
    }
    const body = await readBody(req);
    if (!body || typeof body.id !== "string") {
      send(res, 400, { error: "expected {id, action}" });
      return;
    }
    const result = await actProject(body.id, String(body.action ?? "start"));
    send(res, result.code, { ok: result.ok, message: result.message, results: result.results });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/llm/")) {
    if (!isTrustedRequest(req.headers)) {
      logAction("reject llm → untrusted origin");
      send(res, 403, { error: "untrusted request" });
      return;
    }
    const body = await readBody(req, 65_536);
    if (!body) { send(res, 400, { error: "expected a JSON body" }); return; }

    if (url.pathname === "/api/llm/key") {
      const saved = saveKey(body);
      if (!saved.ok) { send(res, saved.code, { ok: false, error: saved.message }); return; }
      const entry = readStore().keys?.[body.provider] ?? {};
      const probe = await runPrompt({
        providerId: body.provider,
        prompt: "Reply with the single word: ok",
        model: entry.model,
        baseURL: entry.baseURL,
        apiKey: entry.apiKey ?? "",
        maxTokens: 8,
        temperature: 0,
        timeout: 30_000,
      });
      markVerified(body.provider, probe.ok, probe.message);
      logAction(`llm key set · ${body.provider} · ${saved.fingerprint}${probe.ok ? " · verified" : " · not verified"}`);
      send(res, 200, {
        ok: true,
        fingerprint: saved.fingerprint,
        verified: probe.ok,
        detail: probe.ok ? `verified in ${probe.ms} ms` : probe.message,
        llm: publicState(),
    catalog: catalogEntries(probes),
    children: childProjects(),
    plans: await openPlans(),
      });
      return;
    }

    if (url.pathname === "/api/llm/key/delete") {
      const removed = deleteKey(String(body.provider ?? ""));
      if (!removed.ok) { send(res, removed.code, { ok: false, error: removed.message }); return; }
      logAction(`llm key removed · ${body.provider}`);
      send(res, 200, { ok: true, llm: publicState() });
      return;
    }

    if (url.pathname === "/api/llm/run") {
      const store = readStore();
      const provider = providerById(String(body.provider ?? store.active ?? ""));
      if (!provider) { send(res, 400, { ok: false, error: "no provider selected" }); return; }
      const entry = store.keys?.[provider.id];
      if (provider.keyed && !entry?.apiKey) { send(res, 400, { ok: false, error: `no key for ${provider.name}` }); return; }
      const prompt = String(body.prompt ?? "").trim();
      if (!prompt) { send(res, 400, { ok: false, error: "empty prompt" }); return; }

      let text = prompt;
      if (body.attachContext) text = `${contextBrief(await snapshot())}\n\n${prompt}`;

      const result = await runPrompt({
        providerId: provider.id,
        prompt: text,
        model: entry?.model ?? provider.model,
        baseURL: entry?.baseURL ?? provider.baseURL,
        apiKey: entry?.apiKey ?? "",
        temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7,
        maxTokens: Number(body.maxTokens) > 0 ? Number(body.maxTokens) : 1024,
      });

      if (result.ok) {
        const tokens = (result.usage?.prompt ?? 0) + (result.usage?.completion ?? 0);
        noteRun(readStore(), {
          at: new Date().toISOString(),
          provider: provider.id,
          model: result.model,
          ms: result.ms,
          tokens,
        });
        logAction(`llm run · ${provider.id} · ${tokens} tok · ${(result.ms / 1000).toFixed(1)} s`);
        send(res, 200, { ...result, llm: publicState() });
        return;
      }
      logAction(`llm failed · ${provider.id} · ${result.message}`);
      send(res, 200, { ok: false, error: result.message, ms: result.ms });
      return;
    }
  }
  if (req.method === "POST" && url.pathname === "/api/pixiv/sweep") {
    if (!isTrustedRequest(req.headers)) {
      logAction("reject sweep → untrusted origin");
      send(res, 403, { error: "untrusted request" });
      return;
    }
    const body = (await readBody(req, 4096)) ?? {};
    const result = await sweep({ force: Boolean(body.force), minutes: Number(body.minutes) > 0 ? Number(body.minutes) : 180 });
    logAction(`pixiv sweep · ${result.state ?? (result.ok ? "started" : "failed")}${result.sweep?.running ? ` · ${result.sweep.done}/${result.sweep.total}` : ""}`);
    send(res, result.code ?? (result.ok ? 202 : 500), result);
    return;
  }

  send(res, 404, { error: "no such route" });
}

// The code browser and the reader: the kit's tokens, and only the typography a
// long document needs. It used to carry the media-era palette.
const SHARED_CSS = `<style>
  *{box-sizing:border-box}
  body{margin:0;background:var(--void);color:var(--pale);font:14px/1.7 Inter,ui-sans-serif,system-ui,sans-serif}
  header{position:sticky;top:0;display:flex;justify-content:space-between;align-items:baseline;gap:16px;
         padding:14px 24px;border-bottom:1px solid var(--line);background:rgba(11,13,20,.94);backdrop-filter:blur(8px)}
  .brand{font-family:"Cormorant Garamond",Georgia,serif;letter-spacing:.4em;text-transform:uppercase;font-size:12px}
  .brand b{color:var(--red);font-weight:400;margin:0 10px}
  .meta{font:500 10px/1 "IBM Plex Mono",monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--dim)}
  .meta a{color:var(--dim);text-decoration:none}.meta a:hover{color:var(--pale)}
  main{max-width:900px;margin:0 auto;padding:32px 24px 80px}
  h1,h2,h3,h4{font-family:"Cormorant Garamond",Georgia,serif;font-weight:400;letter-spacing:.04em}
  h1{font-size:30px}h2{font-size:22px;margin-top:32px}h3{font-size:17px}
  p,li{color:var(--pale)}
  a{color:var(--rei)}
  code{font-family:"IBM Plex Mono",monospace;font-size:.86em;background:rgba(169,183,232,.1);padding:1px 5px;border-radius:4px}
  pre{background:rgba(255,255,255,.02);border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow:auto}
  pre code{background:none;padding:0;font-size:12.5px;line-height:1.6}
  blockquote{margin:18px 0;padding:6px 16px;border-left:2px solid var(--line);color:var(--dim)}
  table{border-collapse:collapse;width:100%;font-size:13px}
  td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}
  .row{display:flex;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--line);font-family:"IBM Plex Mono",monospace;font-size:12px}
  .row.dir a{color:var(--rei)} .row a{color:var(--pale);text-decoration:none} .row a:hover{color:var(--rei)}
  .size{margin-left:auto;color:var(--dim)}
  .crumb{color:var(--dim);font-family:"IBM Plex Mono",monospace;font-size:11px;margin-bottom:14px}
</style>`;

function shell(entry, title, bodyHtml, extraMeta = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(title)} · ${escapeHtml(entry.name)}</title>
<link rel="icon" href="/gehirn/favicon.ico" />
<link rel="stylesheet" href="/gehirn/ui/ui.css" />${SHARED_CSS}</head><body>
<header>${brand({ tool: entry.name })}
<span class="meta">${extraMeta}<a href="/gehirn/">gehirn</a></span></header>
<main>${bodyHtml}</main></body></html>`;
}

function docsPage(entry, doc, markdown) {
  return shell(entry, doc, `<div class="crumb">${escapeHtml(entry.path)}/${escapeHtml(doc)} · read-only</div>${renderMarkdown(markdown)}`,
    `<a href="/files/${encodeURIComponent(entry.id)}/${escapeURI(doc)}">source</a> · `);
}

function treePage(entry, listing) {
  const rows = listing.entries.map((row) => {
    const target = `/files/${encodeURIComponent(entry.id)}/${listing.relative ? `${listing.relative}/` : ""}${row.name}${row.dir ? "/" : ""}`;
    return `<div class="row${row.dir ? " dir" : ""}"><a href="${target}">${escapeHtml(row.name)}${row.dir ? "/" : ""}</a><span class="size">${row.dir ? "" : `${Math.max(1, Math.round(row.size / 1024))} KB`}</span></div>`;
  }).join("");
  return shell(entry, listing.relative || "/", `<div class="crumb">${escapeHtml(entry.path)}/${escapeHtml(listing.relative)} · read-only</div>${rows || "<p>empty</p>"}`);
}

function filePage(entry, read) {
  const body = escapeHtml(read.text);
  return shell(entry, read.relative, `<div class="crumb">${escapeHtml(entry.path)}/${escapeHtml(read.relative)} · ${read.lines} lines · read-only</div><pre><code>${body}</code></pre>`);
}

function escapeURI(value) {
  return String(value).split("/").map(encodeURIComponent).join("/");
}

/** Open the panel. Tests import this module for its functions, so nothing
 *  binds a port unless the file is run. */
export function start() {
  server.listen(PORT, HOST, () => {
    const where = HOST === "0.0.0.0" ? `http://localhost:${PORT} (also on the LAN)` : `http://localhost:${PORT}`;
    console.log(`gehirn: ${where}`);
    logAction(`gehirn listening on ${HOST}:${PORT}`);
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) start();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    logAction(`cockpit stopped (${signal})`);
    server.close(() => process.exit(0));
  });
}

export { snapshot, server };
