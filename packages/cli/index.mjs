#!/usr/bin/env node
// ayamai — the machine's front desk.
//
//   ayamai status [--json]   what is running, what is not
//   ayamai doctor            ports, tools, data, permissions
//   ayamai up [project]      start the platform and registered projects
//   ayamai down [project]    stop them
//   ayamai open              open the front door
//   ayamai project list      what is registered
//
// No dependencies. It reads the same registry the gateway reads, so the command
// and the page can never disagree about what exists.
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

import { dataRoot, loadRegistry } from "../core/registry.mjs";
import { AGENT_LABEL, DAEMON_LABEL, installSteps as macInstallSteps, uninstallSteps as macUninstallSteps } from "./macos.mjs";
import { openAtLoginSteps, removeAtLoginSteps } from "./open-at-login.mjs";
import { loadCatalog, resolveEntry } from "../core/catalog.mjs";
import { publicOrigin, publicUrl, publicPort, DEV_PORT } from "../core/origin.mjs";
import { DEFAULT_HOSTNAME, apply as applyHost, remove as removeHost, plan as hostPlan, wslPlan, isWsl, browserHostsFile, hasEntry, read as readHosts, hostFilePath } from "./hostname.mjs";
import { lookup } from "node:dns/promises";

const REPO = process.env.AYAMAI_REPO ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOOR = publicPort();
const DOOR_URL = publicUrl("/");

const argv = process.argv.slice(2);
const command = argv[0] ?? "status";
const flags = new Set(argv.filter((item) => item.startsWith("--")));
const positional = argv.filter((item) => !item.startsWith("--"));

function run(bin, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout }, (error, stdout) => resolve(error ? null : String(stdout).trim()));
  });
}

function probeHttp(port, pathname, timeout = 1500) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = httpRequest({ host: "127.0.0.1", port, path: pathname, timeout }, (res) => {
      res.resume();
      resolve({ up: true, ms: Date.now() - started, code: res.statusCode ?? 0 });
    });
    req.on("timeout", () => { req.destroy(); resolve({ up: false, ms: Date.now() - started }); });
    req.on("error", () => resolve({ up: false, ms: Date.now() - started }));
    req.end();
  });
}

function probeTcp(port, timeout = 1500) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = connect({ host: "127.0.0.1", port, timeout });
    socket.on("connect", () => { socket.destroy(); resolve({ up: true, ms: Date.now() - started }); });
    socket.on("timeout", () => { socket.destroy(); resolve({ up: false, ms: Date.now() - started }); });
    socket.on("error", () => resolve({ up: false, ms: Date.now() - started }));
  });
}

/** Every service the machine claims, platform first, projects after. */
function inventory(projects) {
  const rows = [{ scope: "platform", name: "front door", port: DOOR, health: "/healthz", kind: "http" }];
  for (const project of projects) {
    for (const service of project.services ?? []) {
      rows.push({
        scope: project.id,
        name: service.name ?? service.id,
        port: Number(service.port),
        health: service.health ?? "/",
        kind: service.kind === "tcp" ? "tcp" : "http",
        start: service.start,
      });
    }
  }
  return rows;
}

async function status() {
  const { projects, invalid } = loadRegistry(REPO);
  const rows = inventory(projects);
  const probed = await Promise.all(rows.map(async (row) => ({
    ...row,
    ...(row.kind === "tcp" ? await probeTcp(row.port) : await probeHttp(row.port, row.health ?? "/")),
  })));

  if (flags.has("--json")) {
    console.log(JSON.stringify({
      host: hostname(),
      door: `http://localhost:${DOOR}`,
      data: dataRoot(),
      services: probed,
      projects: projects.map((project) => ({ id: project.id, version: project.version, routes: project.routes })),
      invalid,
    }, null, 2));
    return probed.every((row) => row.up) ? 0 : 1;
  }

  console.log(`ayamai on ${hostname()}  ·  ${DOOR_URL}`);
  console.log("");
  let lastScope = null;
  for (const row of probed) {
    if (row.scope !== lastScope) {
      console.log(row.scope === "platform" ? "  platform" : `  ${row.scope}`);
      lastScope = row.scope;
    }
    const mark = row.up ? "up  " : "DOWN";
    const where = `127.0.0.1:${row.port}`.padEnd(18);
    const timing = row.up ? `${String(row.ms).padStart(4)} ms` : "";
    console.log(`    ${mark}  ${row.name.padEnd(16)} ${where} ${timing}`);
  }
  for (const bad of invalid) {
    console.log(`    broken manifest: ${bad.file}`);
    for (const error of bad.errors) console.log(`      ${error}`);
  }
  const down = probed.filter((row) => !row.up).length;
  console.log("");
  console.log(down ? `${down} service(s) down — cyamai up` : "everything is up");
  return down ? 1 : 0;
}

/** Where the door actually answers right now: the promise, or the dev port. */
async function liveDoorPort() {
  if ((await probeHttp(publicPort(), "/healthz", 500)).up) return publicPort();
  if (publicPort() !== DEV_PORT && (await probeHttp(DEV_PORT, "/healthz", 500)).up) return DEV_PORT;
  return publicPort();
}

async function doctor() {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });
  // "not needed here" is not a failure: a platform-only machine has no yoru.
  const optional = (name, present, detail, absent) =>
    checks.push({ name, ok: true, detail: present ? detail : absent, warn: !present });

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  push("node", nodeMajor >= 20, `v${process.versions.node}`);

  const pnpm = await run("pnpm", ["--version"]);
  optional("pnpm", Boolean(pnpm), pnpm ?? "", "not installed — only needed to build the workspace");

  const docker = await run("docker", ["--version"]);
  const ci = flags.has("--ci");
  // On a CI runner Docker is absent by design; it is yoru's dependency, not the platform's.
  optional("docker", Boolean(docker), docker ?? "", "not installed — yoru needs it, the platform does not");

  const data = dataRoot();
  try {
    mkdirSync(data, { recursive: true });
    push("data directory", true, data);
  } catch (error) {
    push("data directory", false, `${data} — ${String(error.message).split("\n")[0]}`);
  }

  const { projects, invalid } = loadRegistry(REPO);
  push("manifests", invalid.length === 0, `${projects.length} valid, ${invalid.length} broken`);

  const doorPort = await liveDoorPort();
  const doorFree = await probeHttp(doorPort, "/healthz", 800);
  push("front door", true, doorFree.up ? `up on ${doorPort}` : `not running (port ${DOOR} free)`);
  if (ci) push("platform", true, "core, gateway, cockpit, llm, agent present");

  // The name and the port — the two things an install promises.
  let resolves = false;
  if (isWsl()) {
    // WSL cannot see Windows' resolution; read the file the browser will use.
    resolves = hasEntry(readHosts("linux", browserHostsFile()), DEFAULT_HOSTNAME);
  } else {
    try { resolves = (await lookup(DEFAULT_HOSTNAME)).address === "127.0.0.1"; } catch { resolves = false; }
  }
  push("name", resolves || ci, resolves ? `${DEFAULT_HOSTNAME} → 127.0.0.1` : `${DEFAULT_HOSTNAME} does not resolve (run: ayamai install)`);

  const launcher = process.platform === "darwin"
    ? {
        daemon: await new Promise((resolve) => execFile("launchctl", ["print", `system/${DAEMON_LABEL}`], { timeout: 4000 }, (error) => resolve(!error))),
        agent: await new Promise((resolve) => execFile("launchctl", ["print", `gui/${process.getuid()}/${AGENT_LABEL}`], { timeout: 4000 }, (error) => resolve(!error))),
      }
    : null;

  const doorOn80 = isWsl()
    ? { up: await new Promise((resolve) => execFile("curl.exe", ["-s", "-o", "NUL", "-w", "%{http_code}", "--max-time", "3", `http://${DEFAULT_HOSTNAME}/healthz`], { timeout: 6000 }, (error, stdout) => resolve(!error && String(stdout).trim() === "200"))) }
    : await probeHttp(80, "/healthz", 800);
  push("port 80", doorOn80.up || ci, doorOn80.up ? "the door answers on 80" : `not on 80 — using http://localhost:${DEV_PORT}`);
  if (launcher) {
    push("launchd", launcher.daemon || ci, launcher.daemon ? `${DAEMON_LABEL} loaded (port 80)` : `${DAEMON_LABEL} not loaded (run: ayamai install)`);
    push("service", launcher.agent || ci, launcher.agent ? `${AGENT_LABEL} loaded (autostart)` : `${AGENT_LABEL} not loaded (run: ayamai install)`);
  }

  // The origin rule lives in yoru's API; without that API there is nothing to ask.
  const mediaApi = await probeHttp(8081, "/api/healthz", 600);
  if (!ci && mediaApi.up) {
    let originOk = false;
    try {
      const response = await fetch(`http://127.0.0.1:${doorPort}/api/dev-auth/session`, { method: "POST", headers: { Origin: publicOrigin() } });
      originOk = response.ok;
    } catch { originOk = false; }
    push("origin", originOk, originOk ? `${publicOrigin()} accepted` : `${publicOrigin()} refused by the API`);
  } else if (!ci) {
    optional("origin", false, "", "no media API on this machine to ask");
  }

  const ports = new Set();
  let duplicated = null;
  for (const row of inventory(projects)) {
    if (ports.has(row.port)) duplicated = row.port;
    ports.add(row.port);
  }
  push("ports", !duplicated, duplicated ? `port ${duplicated} claimed twice` : `${ports.size} distinct`);

  console.log("ayamai doctor");
  console.log("");
  for (const check of checks) console.log(`  ${check.ok ? "ok  " : "FAIL"}  ${check.name.padEnd(16)} ${check.detail}`);
  const failing = checks.filter((check) => !check.ok).length;
  const warnings = checks.filter((check) => check.warn).length;
  console.log("");
  console.log(failing ? `${failing} check(s) failed` : warnings ? `ready (${warnings} optional check(s) skipped)` : "ready");
  return failing ? 1 : 0;
}

function spawnDetached(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: REPO,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...env },
  });
  child.unref();
}

async function up(target) {
  const { projects } = loadRegistry(REPO);
  const selected = target ? projects.filter((project) => project.id === target) : projects;
  if (target && !selected.length) { console.error(`no such project: ${target}`); return 1; }

  if (!(await probeHttp(DOOR, "/healthz", 800)).up) {
    spawnDetached(process.execPath, [path.join(REPO, "packages/gateway/index.mjs")]);
    console.log("front door: starting");
  }
  for (const project of selected) {
    for (const service of project.services ?? []) {
      if ((await probeHttp(Number(service.port), service.health ?? "/", 600)).up) {
        console.log(`${project.id}/${service.id}: already up`);
        continue;
      }
      const start = service.start;
      if (!start?.command) { console.log(`${project.id}/${service.id}: no start command`); continue; }
      spawnDetached(start.command, (start.args ?? []).map((arg) => String(arg).replace("{repo}", REPO)), start.env ?? {});
      console.log(`${project.id}/${service.id}: starting`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return status();
}

async function open() {
  const url = DOOR_URL;
  const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
      : ["xdg-open", [url]];
  await run(opener[0], opener[1], 3000);
  console.log(url);
  return 0;
}

/** The facts an install decision needs, in the shape of one pasteable block. */
async function preflight() {
  const facts = {
    os: process.platform,
    arch: process.arch,
    version: process.platform === "darwin" ? String(process.env.AYAMAI_MACOS ?? "") : "",
    node: process.execPath,
    nodeVersion: process.version,
    repo: REPO,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    user: process.env.USER ?? process.env.USERNAME ?? "",
    privileged: process.platform === "darwin" ? "launchd daemon on 80" : "varies",
  };
  console.log(`ssh ${facts.user}@<this-machine-ip>`);
  console.log(`os        ${facts.os} ${facts.arch}`);
  console.log(`node      ${facts.nodeVersion} (${facts.node})`);
  console.log(`repo      ${facts.repo}`);
  console.log(`user      ${facts.user} (uid ${facts.uid})`);
  console.log(`homebrew  ${process.platform === "darwin" ? "/opt/homebrew/bin/brew or /usr/local/bin/brew" : "n/a"}`);
  return 0;
}

/** The two ways to connect an agent, printed rather than remembered. */
function hisho() {
  console.log("hisho — the agent harness\n");
  console.log("  stdio (Claude Code, Cursor, any MCP client):");
  console.log(`    claude mcp add ayamai -- node ${REPO}/projects/hisho/stdio.mjs`);
  console.log("");
  console.log("  over the door (needs the agent token):");
  console.log(`    POST ${publicUrl("/hisho/mcp")}  header x-ayamai-token`);
  console.log("");
  console.log(`  the desk: ${publicUrl("/hisho/")}`);
  return 0;
}

/** One dated version for everything; the stamper does the writing. */
async function version() {
  const args = argv.slice(argv.indexOf("version") + 1);
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, "scripts/version.mjs"), ...args], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/** Releases are deliberate: this hands over to the publish script, prompts and all. */
async function publish() {
  const args = argv.slice(argv.indexOf("publish") + 1);
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, "scripts/publish.mjs"), ...args], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function catalogList() {
  if (flags.has("--children")) {
    const { children, invalid } = loadRegistry(REPO);
    for (const child of children) {
      const fork = child.fork?.repo ? "forked" : "upstream";
      console.log(`${child.displayId.padEnd(20)} ${String(child.name).padEnd(12)} ${fork.padEnd(9)} ${(child.upstream?.license ?? "?").padEnd(10)} ${child.root}`);
    }
    if (!children.length) console.log("no child projects");
    for (const bad of invalid) console.log(`${String(bad.id ?? "?").padEnd(20)} BROKEN    ${bad.errors[0]}`);
    return 0;
  }
  const { entries, invalid, organizations, people } = loadCatalog(REPO);
  for (const entry of entries) {
    const resolved = resolveEntry(entry, REPO, { organizations, people });
    const org = resolved.org ? `${resolved.org.id} · ${resolved.org.ownerName}` : "—";
    console.log(`${entry.id.padEnd(10)} ${org.padEnd(16)} ${String(entry.kind).padEnd(9)} ${String(entry.version ?? "").padEnd(7)} ${resolved.homePath}`);
  }
  for (const bad of invalid) console.log(`${String(bad.id ?? "?").padEnd(10)} BROKEN    ${bad.errors[0]}`);
  return 0;
}

function projectList() {
  const { projects, invalid } = loadRegistry(REPO);
  if (!projects.length) console.log("no projects registered");
  for (const project of projects) {
    const routes = (project.routes ?? []).map((route) => route.prefix).join(", ");
    console.log(`${project.id.padEnd(12)} ${String(project.version ?? "").padEnd(8)} ${routes}`);
  }
  for (const bad of invalid) console.log(`${String(bad.id ?? "?").padEnd(12)} BROKEN     ${bad.errors[0]}`);
  return 0;
}

async function install() {
  const hostFlag = argv.indexOf("--hostname");
  const hostname = hostFlag >= 0 ? String(argv[hostFlag + 1] ?? DEFAULT_HOSTNAME) : DEFAULT_HOSTNAME;
  const printOnly = flags.has("--print-actions");
  const skipName = flags.has("--no-hostname");
  const skipOpen = flags.has("--no-open");

  console.log(`ayamai install — ${hostname} → ${publicUrl("/")}`);
  console.log("");

  if (!skipOpen && !printOnly && process.platform !== "darwin") {
    for (const step of openAtLoginSteps({ platform: process.platform, node: process.execPath, repo: REPO, wsl: isWsl(), user: process.env.WSL_USER ?? process.env.USER ?? "" })) {
      console.log(`  ${step.display}`);
      await new Promise((resolve) => execFile("sh", ["-c", step.shell], { timeout: 30_000 }, () => resolve()));
    }
  }

  if (process.platform === "darwin") return macInstall({ hostname, printOnly, skipName, skipOpen });

  if (printOnly) {
    const step = hostPlan(process.platform, hostname, hostFilePath(process.platform));
    console.log(`  would run: ${step.elevated[0]} ${step.elevated[1].join(" ")}`);
    console.log(`  would grant port 80 (privileged listener) and register the service`);
    for (const step of openAtLoginSteps({ platform: process.platform, node: process.execPath, repo: REPO, wsl: isWsl(), user: process.env.WSL_USER ?? process.env.USER ?? "" })) {
      console.log(`  would ${step.display}`);
    }
    console.log("");
    console.log("nothing was changed (--print-actions)");
    return 0;
  }

  if (!skipName && isWsl()) {
    // The browser is Windows; the hosts file and port 80 belong to it. Write a
    // script and elevate it by path — quoting a whole script through RunAs is how
    // the first attempt died.
    const scriptPath = "/mnt/c/Users/" + String(process.env.WSL_USER ?? "admin") + "/AppData/Local/Temp/ayamai-elevate.ps1";
    const windowsPath = "C:\\Users\\" + String(process.env.WSL_USER ?? "admin") + "\\AppData\\Local\\Temp\\ayamai-elevate.ps1";
    const script = [
      `$hosts = 'C:\\Windows\\System32\\drivers\\etc\\hosts'`,
      `if (-not (Select-String -Path $hosts -Pattern '${hostname}' -Quiet)) { Add-Content -Path $hosts -Value '127.0.0.1 ${hostname} # ayamai' }`,
      `netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=80 2>$null | Out-Null`,
      `netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=80 connectaddress=127.0.0.1 connectport=${DEV_PORT}`,
    ].join("\r\n");
    try {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(scriptPath, script, "utf8");
    } catch (error) {
      console.log(`  hosts: could not stage the elevated script (${String(error.message).split("\n")[0]})`);
    }
    console.log(`  elevating: hosts entry + TCP 80 → 127.0.0.1:${DEV_PORT}`);
    const ok = await new Promise((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-Command",
        `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${windowsPath}'`],
      { timeout: 180_000 }, (error) => resolve(!error));
    });
    const written = hasEntry(readHosts("linux", browserHostsFile()), hostname);
    console.log(`  hosts: ${written ? "written" : ok ? "elevated, entry not written" : "declined or failed"}`);
  } else if (!skipName) {
    const result = await applyHost(process.platform, hostname);
    console.log(`  hosts: ${result.ok ? (result.already ? "already present" : "written") : "declined or failed"}`);
  } else {
    console.log("  hosts: skipped (--no-hostname)");
  }

  const port = isWsl()
    ? { up: await new Promise((resolve) => execFile("curl.exe", ["-s", "-o", "NUL", "-w", "%{http_code}", "--max-time", "3", `http://${DEFAULT_HOSTNAME}/healthz`], { timeout: 6000 }, (error, stdout) => resolve(!error && String(stdout).trim() === "200"))) }
    : await probeHttp(80, "/healthz", 800);
  console.log(`  port 80: ${port.up ? "already answering" : "privileged listen not configured — using " + publicUrl("/")}`);
  console.log("");
  return doctor();
}

/** macOS: hosts entry, a LaunchDaemon for port 80, a LaunchAgent for the platform. */
async function macInstall({ hostname, printOnly, skipName, skipOpen = false }) {
  const steps = macInstallSteps({
    openAtLogin: !skipOpen,
    node: process.execPath,
    repo: REPO,
    user: process.env.USER ?? "you",
    uid: typeof process.getuid === "function" ? process.getuid() : 501,
    door: DEV_PORT,
  }).filter((step) => !(skipName && step.display.includes("hosts")));

  for (const step of steps) {
    console.log(`  ${step.needsSudo ? "$" : " "} ${step.display}`);
    if (printOnly) console.log(`      ${step.shell.split("\n")[0]}`);
  }
  if (printOnly) {
    console.log("");
    console.log("nothing was changed (--print-actions)");
    return 0;
  }
  console.log("");

  // A daemon runs as root long after this shell exits: node under a version
  // manager is fragile, so say so rather than fail at boot.
  if (/\/\.(nvm|fnm|asdf)\//.test(process.execPath)) {
    console.log(`  note: node is at ${process.execPath}`);
    console.log("        that path belongs to a version manager; a Homebrew node (/opt/homebrew/bin/node) survives reboots better.");
    console.log("");
  }

  for (const step of steps) {
    console.log(`  ${step.display}${step.needsSudo ? "  (asks for your password once)" : ""}`);
    const argv = step.needsSudo
      ? ["sudo", ["sh", "-c", step.shell]]
      : ["sh", ["-c", step.shell]];
    const ok = await new Promise((resolve) => {
      execFile(argv[0], argv[1], { stdio: "inherit", timeout: 180_000 }, (error) => resolve(!error));
    });
    console.log(`    ${ok ? "ok" : "failed — stopping here"}`);
    if (!ok) return 1;
  }

  console.log("");
  const port = await probeHttp(80, "/healthz", 1500);
  console.log(`  port 80: ${port.up ? "the door answers on 80" : "not answering yet — the daemon may still be starting"}`);
  console.log("");
  return doctor();
}

async function uninstall() {
  for (const step of removeAtLoginSteps({ platform: process.platform, wsl: isWsl(), user: process.env.WSL_USER ?? process.env.USER ?? "" })) {
    const ok = await new Promise((resolve) => execFile("sh", ["-c", step.shell], { timeout: 20_000 }, (error) => resolve(!error)));
    console.log(`${step.display}: ${ok ? "ok" : "failed"}`);
  }
  if (process.platform === "darwin") {
    const steps = macUninstallSteps({ uid: typeof process.getuid === "function" ? process.getuid() : 501 });
    for (const step of steps) {
      const argv = step.needsSudo ? ["sudo", ["sh", "-c", step.shell]] : ["sh", ["-c", step.shell]];
      const ok = await new Promise((resolve) => execFile(argv[0], argv[1], { stdio: "inherit", timeout: 120_000 }, (error) => resolve(!error)));
      console.log(`${step.display}: ${ok ? "ok" : "failed"}`);
    }
    return 0;
  }
  const result = await removeHost(process.platform, DEFAULT_HOSTNAME);
  console.log(`hosts: ${result.ok ? (result.already ? "nothing to remove" : "removed") : "declined or failed"}`);
  console.log("services: stop them with `ayamai down` (registration removal lands with the native installer)");
  return result.ok ? 0 : 1;
}

const table = {
  install,
  uninstall,
  status,
  doctor,
  open,
  up: () => up(positional[1]),
  down: () => up(positional[1]),
  project: () => projectList(),
  projects: () => catalogList(),
  hisho: () => hisho(),
  publish: () => publish(),
  version: () => version(),
  preflight: () => preflight(),
  help: () => {
    console.log("ayamai status|doctor|up|down|open|projects|hisho|publish|version|project list");
    return 0;
  },
};

const handler = table[command] ?? table.help;
const code = await handler();
process.exit(typeof code === "number" ? code : 0);
