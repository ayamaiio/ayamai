// Acting on the machine: validated, serialized, and logged in the open.
//
// Nothing here trusts the browser. A request must come from this page, carry
// the cockpit header, and name a service that exists — then it runs the argv
// the catalog already declared. No shell, no interpolation.
import { spawn, execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { SERVICES, commandFor, pidOnPort, ssDump, startOrder, probe as probeService } from "./services.mjs";
import { isAllowedOrigin, allowedOrigins } from "../core/origin.mjs";

const LOG_DIR = path.join(homedir(), "ayamai-deepseek", ".local");
const LOG_FILE = path.join(LOG_DIR, "cockpit.log");

/** Kept for the tests; the decision itself lives in core. */
export const ALLOWED_ORIGINS = allowedOrigins();

/** Pure: does this look like our own page? */
export function isTrustedRequest(headers = {}) {
  const header = (name) => headers[name] ?? headers[name.toLowerCase()];
  if (header("x-cockpit") !== "1") return false;
  const origin = header("origin");
  if (!origin) return true; // curl and local tools have no origin
  return isAllowedOrigin(String(origin));
}

const inFlight = new Set();
const recent = [];

export function logAction(line) {
  const stamp = new Date().toTimeString().slice(0, 8);
  const text = `${stamp}  ${line}`;
  recent.push(text);
  while (recent.length > 40) recent.shift();
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, `${new Date().toISOString()}  ${line}\n`);
  } catch { /* the log is a courtesy, not the state */ }
}

export function recentActions() {
  return recent.slice(-8).reverse();
}

function spawnDetached(command, args) {
  const child = spawn(command, args, {
    cwd: process.env.AYAMAI_REPO ?? path.resolve(import.meta.dirname, "../.."),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return child;
}

function killPid(pid) {
  try { process.kill(pid, "SIGTERM"); return true; } catch { return false; }
}

function windowsKill(port) {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-Command",
      `$p=(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess; if($p){Stop-Process -Id $p -Force; 'killed'}else{'none'}`],
    { timeout: 8000 }, (error, stdout) => resolve(!error && stdout.includes("killed")));
  });
}

/**
 * Run one action. Returns {ok, message} — the caller turns that into a status
 * code. `start` is fire-and-forget (the poller notices); `stop` waits for the
 * process to be gone so the row does not flicker.
 */
export async function act(id, action) {
  const service = SERVICES.find((entry) => entry.id === id);
  if (!service) return { ok: false, code: 400, message: `unknown service: ${id}` };
  if (service.self) return { ok: false, code: 400, message: "the cockpit does not control itself" };
  if (action !== "start" && action !== "stop" && action !== "restart") {
    return { ok: false, code: 400, message: `unknown action: ${action}` };
  }
  if (inFlight.has(id)) return { ok: false, code: 409, message: `${service.name} is already changing` };

  // restart is what you want when the process is older than its code
  if (action === "restart") {
    const stopped = await act(id, "stop");
    if (!stopped.ok) return stopped;
    await new Promise((resolve) => setTimeout(resolve, 400));
    const started = await act(id, "start");
    return started.ok ? { ok: true, code: 202, message: "restarted", command: started.command } : started;
  }

  const argv = commandFor(id, action);
  inFlight.add(id);
  try {
    if (action === "start") {
      if (!argv) return { ok: false, code: 400, message: `${service.name} has no launcher` };
      spawnDetached(argv[0], argv[1]);
      const line = `${action} ${service.name}`;
      logAction(`${line} → ${argv[0]} ${argv[1].join(" ")}`);
      return { ok: true, code: 202, message: "started", command: [argv[0], ...argv[1]].join(" ") };
    }

    // stop
    if (argv) {
      spawnDetached(argv[0], argv[1]);
      logAction(`stop ${service.name} → ${argv[0]} ${argv[1].join(" ")}`);
      return { ok: true, code: 202, message: "stopping", command: [argv[0], ...argv[1]].join(" ") };
    }
    if (service.host === "windows") {
      const killed = await windowsKill(service.port);
      logAction(`stop ${service.name} → taskkill on ${service.port} ${killed ? "ok" : "none listening"}`);
      return { ok: true, code: 202, message: killed ? "killed" : "nothing listening" };
    }
    const pid = pidOnPort(await ssDump(), service.port);
    if (!pid) {
      logAction(`stop ${service.name} → nothing listening on ${service.port}`);
      return { ok: true, code: 202, message: "nothing listening" };
    }
    const killed = killPid(pid);
    logAction(`stop ${service.name} → kill ${pid} ${killed ? "ok" : "denied"}`);
    return { ok: killed, code: killed ? 202 : 500, message: killed ? `killed ${pid}` : `could not kill ${pid}` };
  } finally {
    inFlight.delete(id);
  }
}

/**
 * Start, stop or restart every service a project owns, in dependency order —
 * one button instead of five. Stops run in reverse, so the app goes before the
 * database it was using.
 */
const VERB = { start: "started", stop: "stopped", restart: "restarted" };

export async function actProject(projectId, action) {
  if (action !== "start" && action !== "stop" && action !== "restart") {
    return { ok: false, code: 400, message: `unknown action: ${action}` };
  }
  const mine = SERVICES.filter((service) => service.project === projectId);
  if (!mine.length) return { ok: false, code: 400, message: `unknown project: ${projectId}` };

  const usable = mine.filter((service) => !service.self && commandFor(service.id, "start"));
  if (!usable.length) {
    return { ok: false, code: 409, message: `${projectId} has nothing gehirn can start` };
  }

  const order = startOrder(usable.map((service) => service.id));
  const sequence = action === "stop" ? [...order].reverse() : order;
  const results = [];

  for (const id of sequence) {
    const service = usable.find((candidate) => candidate.id === id);
    const step = action === "restart" ? await act(id, "restart") : await act(id, action);
    results.push({ id, name: service.name, ok: step.ok, message: step.message });
    logAction(`project ${action} ${projectId} → ${id}: ${step.message}`);
    // a start that fails leaves the rest alone; the caller sees exactly where it stopped
    if (!step.ok && action !== "stop") break;
  }

  const failed = results.filter((result) => !result.ok);

  // A launcher that exits zero is not a service that answers. Wait for the ports.
  if (action !== "stop") {
    for (let attempt = 0; attempt < 10 && results.some((result) => result.ok && !result.up); attempt++) {
      for (const result of results) {
        if (!result.ok || result.up) continue;
        const service = usable.find((candidate) => candidate.id === result.id);
        const answer = await probeService(service);
        if (answer.up) result.up = true;
      }
      if (results.every((result) => !result.ok || result.up)) break;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    for (const result of results) {
      if (result.ok && !result.up) result.message = `started, but it is not answering (${result.message})`;
    }
  }

  const cameUp = results.filter((result) => result.ok && (action === "stop" || result.up)).length;
  const ok = failed.length === 0 && (action === "stop" || cameUp === results.length);
  return {
    ok,
    code: ok ? 202 : 207,
    message: failed.length
      ? `${projectId}: ${failed.map((result) => `${result.id} ${result.message}`).join(", ")}`
      : action === "stop"
        ? `${projectId}: ${VERB[action]} ${results.length} service${results.length === 1 ? "" : "s"}`
        : `${projectId}: ${cameUp} of ${results.length} up after ${action}`,
    results,
  };
}
