// The platform, supervised. Started by launchd at login; keeps the four
// services alive and restarts them if one dies.
//
//   node scripts/platform-up.mjs
//
// Each service runs with the prefix it answers on, so nothing has to rewrite
// paths in flight.
import { spawn } from "node:child_process";
import path from "node:path";

const REPO = process.env.AYAMAI_HOME ?? path.resolve(import.meta.dirname, "..");

export const SERVICES = [
  { name: "gateway", script: "scripts/gateway.mjs", env: {} },
  { name: "gehirn", script: "scripts/gehirn.mjs", env: { BASE_PREFIX: "/gehirn" } },
  { name: "agent", script: "packages/agent/index.mjs", env: {} },
  { name: "seiri", script: "projects/seiri/index.mjs", env: { BASE_PREFIX: "/seiri" } },
  { name: "kata", script: "projects/kata/index.mjs", env: { BASE_PREFIX: "/kata" } },
  { name: "gemu", script: "projects/gemu/server.mjs", env: { BASE_PREFIX: "/gemu" } },
  { name: "hisho", script: "projects/hisho/index.mjs", env: { BASE_PREFIX: "/hisho" } },
  { name: "tsukai", script: "projects/tsukai/server.mjs", env: { BASE_PREFIX: "/tsukai" } },
  { name: "fude", script: "projects/fude/server.mjs", env: { BASE_PREFIX: "/fude" } },
];

const RESTART_MS = 3000;
const children = new Map();
let stopping = false;

function start(service) {
  const child = spawn(process.execPath, [path.join(REPO, service.script)], {
    cwd: REPO,
    env: { ...process.env, ...service.env, AYAMAI_HOME: REPO },
    stdio: "inherit",
  });
  children.set(service.name, child);
  console.log(`[${new Date().toISOString()}] ${service.name} up (pid ${child.pid})`);

  child.on("exit", (code, signal) => {
    children.delete(service.name);
    if (stopping) return;
    console.log(`[${new Date().toISOString()}] ${service.name} down (${signal ?? code}) — restarting in ${RESTART_MS}ms`);
    setTimeout(() => { if (!stopping) start(service); }, RESTART_MS);
  });
}

function stopAll() {
  stopping = true;
  for (const child of children.values()) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 1500);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stopAll);

for (const service of SERVICES) start(service);
console.log(`platform up: ${SERVICES.map((service) => service.name).join(", ")}`);
