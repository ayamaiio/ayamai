// Acting on the machine: validated, serialized, and logged in the open.
//
// Nothing here trusts the browser. A request must come from this page, carry
// the cockpit header, and name a service that exists — then it runs the argv
// the catalog already declared. No shell, no interpolation.
import { spawn, execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { SERVICES, commandFor, pidOnPort, ssDump } from "./services.mjs";
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
  if (action !== "start" && action !== "stop") return { ok: false, code: 400, message: `unknown action: ${action}` };
  if (inFlight.has(id)) return { ok: false, code: 409, message: `${service.name} is already changing` };

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
