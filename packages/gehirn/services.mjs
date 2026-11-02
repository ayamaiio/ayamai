// The catalog: every service on this machine, how to see it, how to start it.
//
// Zero dependencies. One entry per thing that listens, with the exact argv a
// human would type — the cockpit shows that argv and runs it, nothing more.
import { execFile } from "node:child_process";
import { connect } from "node:net";
import { request } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const REPO = process.env.AYAMAI_REPO ?? path.resolve(import.meta.dirname, "../..");
export const AGENT_DIR = "/mnt/c/Users/admin/ayamai-agent";
export const LAN_DIR = "/mnt/c/Users/admin";
export const ROM_ROOTS = ["/mnt/z/Roms"];

const localdev = (service) => [
  ["python3", ["scripts/local-dev.py", "start", "--service", service]],
  ["python3", ["scripts/local-dev.py", "stop", "--service", service]],
];

const nodeScript = (script, extra = [], env = {}) => [
  ["env", [...Object.entries(env).map(([key, value]) => `${key}=${value}`), "node", script, ...extra]],
  null, // stopped by killing whatever holds the port
];

const windows = (dir, script) => [
  ["powershell.exe", ["-NoProfile", "-Command",
    `Start-Process node -ArgumentList '${script}' -WorkingDirectory '${dir.replace(/\//g, "\\")}' -WindowStyle Hidden`]],
  null,
];

/** First ROM the machine has, or null. The Game Boy needs a cartridge. */
export function findRom() {
  for (const root of ROM_ROOTS) {
    if (!existsSync(root)) continue;
    const walk = (dir, depth) => {
      if (depth > 3) return null;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
      for (const entry of entries) {
        if (entry.isFile() && /\.(gb|gbc)$/i.test(entry.name)) return path.join(dir, entry.name);
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const found = walk(path.join(dir, entry.name), depth + 1);
        if (found) return found;
      }
      return null;
    };
    const found = walk(root, 0);
    if (found) return found;
  }
  return null;
}

export const SERVICES = [
  { id: "web", project: "yoru", publicPath: "/yoru/", name: "yoru", group: "projects", port: 25322, path: "/yoru/", probe: "http", note: "media · vite", commands: localdev("web") },
  { id: "api", project: "yoru", publicPath: "/api/healthz", name: "api", group: "core", port: 8081, path: "/api/healthz", probe: "http", note: "express · dist", commands: localdev("api") },
  { id: "db", project: "yoru", name: "postgres", group: "core", port: 5434, probe: "tcp", note: "docker ayamai-dev", commands: [["docker", ["start", "ayamai-dev-5ff1196a34fe"]], ["docker", ["stop", "ayamai-dev-5ff1196a34fe"]]] },
  { id: "curator", project: "yoru", publicPath: "/curator/", name: "curator", group: "core", port: 4319, path: "/", probe: "http", note: "review queue", commands: localdev("curator") },

  { id: "tasks", project: "platform", publicPath: "/agent/capabilities", name: "task api", group: "core", port: 4491, path: "/agent/capabilities", probe: "http", note: "extensions talk here", tokenFile: process.env.AYAMAI_DATA ? process.env.AYAMAI_DATA + "/agent-token" : path.join(homedir(), ".local", "share", "ayamai", "agent-token"), commands: [["node", ["packages/agent/index.mjs"]], null] },
  { id: "agent", project: "yoru", name: "pixiv agent", group: "capture", port: 8099, path: "/status", probe: "http", timeout: 6000, note: "playwright · brave profile", commands: windows(AGENT_DIR, "agent-service.mjs"), host: "windows" },
  { id: "lan", project: "platform", publicPath: "/", name: "lan proxy", group: "capture", port: 25223, path: "/", probe: "http", note: "phone access", commands: windows(LAN_DIR, "ayamai-lan.mjs"), host: "windows" },

  { id: "tsukai", project: "tsukai", publicPath: "/tsukai/", name: "tsukai", group: "tools", port: 4655, path: "/tsukai/", probe: "http", note: "browser extension", commands: nodeScript("projects/tsukai/server.mjs", [], { BASE_PREFIX: "/tsukai" }) },
  { id: "fude", project: "fude", publicPath: "/fude/", name: "fude", group: "tools", port: 4656, path: "/fude/", probe: "http", note: "editor extension", commands: nodeScript("projects/fude/server.mjs", [], { BASE_PREFIX: "/fude" }) },
  { id: "uta", project: "uta", publicPath: "/uta/", name: "uta", group: "projects", port: 4670, path: "/uta/", probe: "http", note: "music", commands: nodeScript("projects/uta/server.mjs", [], { BASE_PREFIX: "/uta" }) },
  { id: "gemu", project: "gemu", publicPath: "/gemu/", name: "gemu", group: "projects", port: 4660, path: "/gemu/", probe: "http", note: "games", commands: nodeScript("projects/gemu/server.mjs", [], { BASE_PREFIX: "/gemu" }) },
  { id: "hisho", project: "hisho", publicPath: "/hisho/", name: "hisho", group: "core", port: 4650, path: "/hisho/", probe: "http", note: "agent harness", commands: nodeScript("projects/hisho/index.mjs", [], { BASE_PREFIX: "/hisho" }) },
  { id: "kata", project: "kata", publicPath: "/kata/", name: "kata", group: "core", port: 4600, path: "/kata/", probe: "http", note: "design library", commands: nodeScript("projects/kata/index.mjs", [], { BASE_PREFIX: "/kata" }) },
  { id: "seiri", project: "seiri", publicPath: "/seiri/", name: "seiri", group: "core", port: 4460, path: "/seiri/", probe: "http", note: "plans · repos", commands: nodeScript("projects/seiri/index.mjs", [], { BASE_PREFIX: "/seiri" }) },
  { id: "storybook", project: "platform", publicPath: "/storybook/", name: "storybook", group: "side", port: 6006, path: "/", probe: "http", note: "magi", commands: localdev("magi") },
  { id: "studio", project: "platform", name: "studio", group: "side", port: 5173, path: "/", probe: "http", note: "unmanaged", commands: null },
  { id: "play", project: "platform", publicPath: "/play/", name: "play", group: "core", port: 4680, path: "/play/", probe: "http", note: "the shelf", commands: nodeScript("packages/play/index.mjs", [], { BASE_PREFIX: "/play" }) },
  { id: "gehirn", project: "platform", publicPath: "/gehirn/", name: "gehirn", group: "side", port: 4490, path: "/", probe: "none", note: "this page", commands: null, self: true },
];

/**
 * The argv for an action, or null when the service has no launcher.
 * Pure on purpose: the tests call it for every id and every action.
 */
export function commandFor(id, action, ctx = {}) {
  const service = SERVICES.find((entry) => entry.id === id);
  if (!service || !service.commands) return null;
  if (action !== "start" && action !== "stop") return null;
  const slot = action === "start" ? service.commands[0] : service.commands[1];
  if (!slot) return null;
  let args = [...slot[1]];
  if (id === "gb" && args.includes("<rom>")) {
    const rom = "rom" in ctx ? ctx.rom : findRom();
    if (!rom) return null;
    args = args.flatMap((arg) => (arg === "<rom>" ? [rom] : [arg]));
  }
  return [slot[0], args];
}

/** Why a run button is disabled, or null when it can run. */
export function blockedReason(service, ctx = {}) {
  if (service.self) return "this page";
  if (!service.commands) return "no launcher";
  if (service.id === "gb" && !("rom" in ctx ? ctx.rom : findRom())) return "no rom on Z:";
  return null;
}

function httpProbe(port, pathname, timeout = 1500, headers = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = request({ host: "127.0.0.1", port, path: pathname, method: "GET", timeout, headers }, (res) => {
      res.resume();
      resolve({ up: true, ms: Date.now() - started, code: res.statusCode ?? 0 });
    });
    req.on("timeout", () => { req.destroy(); resolve({ up: false, ms: Date.now() - started }); });
    req.on("error", () => resolve({ up: false, ms: Date.now() - started }));
    req.end();
  });
}

// Windows-hosted services are unreachable from WSL loopback; curl.exe is how we see them.
function windowsHttpProbe(port, pathname, timeout = 6000) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile("curl.exe", ["-s", "-o", "NUL", "-w", "%{http_code}", "--max-time", String(Math.ceil(timeout / 1000)),
      `http://127.0.0.1:${port}${pathname}`], { timeout: timeout + 2000 }, (error, stdout) => {
      const code = Number(String(stdout ?? "").trim());
      resolve({ up: !error && code > 0, ms: Date.now() - started, code: code || 0 });
    });
  });
}

function tcpProbe(port, timeout = 1500) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = connect({ host: "127.0.0.1", port, timeout });
    socket.on("connect", () => { socket.destroy(); resolve({ up: true, ms: Date.now() - started }); });
    socket.on("timeout", () => { socket.destroy(); resolve({ up: false, ms: Date.now() - started }); });
    socket.on("error", () => resolve({ up: false, ms: Date.now() - started }));
  });
}

export function probe(service) {
  if (service.self) return Promise.resolve({ up: true, ms: 0, self: true });
  const timeout = service.timeout ?? 1500;   // the agent blocks while it lists bookmarks
  if (service.tokenFile) {
    let token = "";
    try { token = readFileSync(service.tokenFile, "utf8").trim(); } catch { /* not created yet */ }
    if (token) return httpProbe(service.port, service.path ?? "/", timeout, { "x-ayamai-token": token });
  }
  if (service.host === "windows") return windowsHttpProbe(service.port, service.path ?? "/", timeout);
  return service.probe === "tcp"
    ? tcpProbe(service.port, timeout)
    : httpProbe(service.port, service.path ?? "/", timeout);
}

/** pid listening on a port, from `ss -lntp` output. Pure for the tests. */
export function pidOnPort(ssOutput, port) {
  for (const line of String(ssOutput).split("\n")) {
    if (!line.includes(`:${port} `)) continue;
    const match = line.match(/pid=(\d+)/);
    if (match) return Number(match[1]);
  }
  return null;
}

/** The entry files a service runs from, for the freshness check. */
const ENTRY_FILES = {
  gehirn: ["packages/gehirn/entry.mjs", "packages/gehirn/page.mjs", "packages/gehirn/services.mjs"],
  hisho: ["projects/hisho/index.mjs", "projects/hisho/context.mjs", "projects/hisho/tools.mjs"],
  seiri: ["projects/seiri/index.mjs"],
  kata: ["projects/kata/index.mjs"],
  gemu: ["projects/gemu/server.mjs"],
  tsukai: ["projects/tsukai/server.mjs"],
  fude: ["projects/fude/server.mjs"],
};

export function entriesFor(id, repo) {
  const files = ENTRY_FILES[id];
  return files ? files.map((file) => path.join(repo, file)) : [];
}

export function ssDump() {
  return new Promise((resolve) => {
    execFile("ss", ["-lntp"], { timeout: 2500 }, (error, stdout) => resolve(error ? "" : stdout));
  });
}

export function dockerContainers() {
  return new Promise((resolve) => {
    execFile("docker", ["ps", "--format", "{{.Names}}|{{.Status}}|{{.Ports}}"], { timeout: 4000 }, (error, stdout) => {
      if (error) { resolve({ up: false, containers: [] }); return; }
      resolve({
        up: true,
        containers: stdout.split("\n").filter(Boolean).map((line) => {
          const [name, status, ports] = line.split("|");
          return { name, status, ports: ports ?? "" };
        }),
      });
    });
  });
}

/** Pure: what the header says. Down and stale are the two things worth naming. */
export function statusLine(services = []) {
  const list = Array.isArray(services) ? services : [];
  const expected = list.filter((service) => !service.blocked);
  const up = expected.filter((service) => service.up).length;
  const down = expected.filter((service) => !service.up);
  const stale = list.filter((service) => service.stale).length;
  const parts = [`${up} / ${expected.length} up`];
  if (down.length) {
    const names = down.slice(0, 2).map((service) => service.name || service.id);
    parts.push(down.length > 2 ? `${names.join(", ")} +${down.length - 2} more` : names.join(", "));
  }
  if (stale) parts.push(`${stale} stale`);
  return { text: parts.join(" · "), up, total: expected.length, down, stale };
}

/** Pure: what is broken first, then what is old, then alphabetical. */
export function sortServices(services = []) {
  const rank = (service) => (service.up ? 2 : 0) + (service.stale ? -1 : 0);
  return [...(Array.isArray(services) ? services : [])].sort((a, b) =>
    rank(a) - rank(b) ||
    String(a.name || a.id).localeCompare(String(b.name || b.id)));
}

/** The order a project starts in: what it depends on first. */
const START_ORDER = ["db", "api", "web", "curator", "agent", "tasks", "lan", "storybook", "studio"];

/** Pure: dependency-first order, unknown ids last and stable. */
export function startOrder(ids = []) {
  const rank = (id) => {
    const index = START_ORDER.indexOf(id);
    return index < 0 ? START_ORDER.length : index;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
}

/** Pure: what a project's button should say and whether it can be pressed. */
export function projectSummary(services = [], projectId) {
  const mine = (Array.isArray(services) ? services : []).filter((service) => service.project === projectId);
  const startable = mine.filter((service) => !service.self && !service.blocked);
  const up = startable.filter((service) => service.up).length;
  const down = startable.filter((service) => !service.up).map((service) => service.id);
  const stale = mine.filter((service) => service.stale).length;
  const blocked = mine.filter((service) => service.blocked);

  return {
    project: projectId,
    total: startable.length,
    up,
    down,
    stale,
    // a project with nothing startable gets no button at all
    hasButton: startable.length > 0,
    canStart: down.length > 0,
    canStop: startable.length > 0 && up === startable.length,
    blockedReason: blocked.length === mine.length && mine.length
      ? (blocked.map((service) => service.blocked).filter(Boolean)[0] || "nothing to start")
      : null,
    label: up + " of " + startable.length + " up",
  };
}
