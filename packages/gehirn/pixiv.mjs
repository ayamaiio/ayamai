// The pixiv sweep, as one action.
//
// The agent needs your Brave profile to itself, so the honest sequence is:
// make sure the browser is out of the way, start the agent, confirm it is
// signed in, then resume the bookmark run. Each step reports what it found.
import { execFile } from "node:child_process";

const AGENT_DIR = "C:\\Users\\admin\\ayamai-agent";
const AGENT = "http://127.0.0.1:8099";
const USER_ID = "112299374";

// The agent listens on Windows. WSL cannot reach its loopback, so ask Windows
// to do the HTTP for us — curl.exe ships with the OS.
function winGet(url, timeout = 6000) {
  return new Promise((resolve) => {
    execFile("curl.exe", ["-s", "--max-time", String(Math.ceil(timeout / 1000)), url], { timeout: timeout + 2000 }, (error, stdout) =>
      resolve(error ? null : String(stdout ?? "")));
  });
}

function powershell(command, timeout = 30_000) {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-Command", command], { timeout }, (error, stdout) =>
      resolve({ ok: !error, out: String(stdout ?? "").trim(), error: error ? String(error.message) : null }));
  });
}

export function braveCountFrom(text) {
  const match = String(text).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export async function braveRunning() {
  const result = await powershell("(Get-Process brave -ErrorAction SilentlyContinue | Measure-Object).Count");
  return result.ok ? braveCountFrom(result.out) : 0;
}

export async function closeBrave() {
  await powershell("Get-Process brave -ErrorAction SilentlyContinue | Stop-Process -Force");
  for (let i = 0; i < 15; i += 1) {
    if ((await braveRunning()) === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

export async function agentStatus(timeout = 6000) {
  const raw = await winGet(`${AGENT}/status`, timeout);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function sweepStatus(timeout = 6000) {
  const raw = await winGet(`${AGENT}/bookmarks/status`, timeout);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function startAgent() {
  await powershell(`Start-Process node -ArgumentList 'agent-service.mjs' -WorkingDirectory '${AGENT_DIR}' -WindowStyle Hidden`);
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = await agentStatus();
    if (status) return status;
  }
  return null;
}

export async function startSweep(minutes = 180) {
  const raw = await winGet(`${AGENT}/bookmarks/start?minutes=${minutes}`, 30_000);
  if (!raw) return { ok: false, message: "agent did not answer on 8099" };
  try {
    return { ok: true, run: JSON.parse(raw) };
  } catch {
    return { ok: false, message: `agent answered with something odd: ${raw.slice(0, 120)}` };
  }
}

/**
 * One press: get the machine into a state where the sweep is running.
 * `force` is the second press — it closes Brave rather than asking.
 */
export async function sweep({ force = false, minutes = 180 } = {}) {
  const status = await agentStatus();
  const sweepRun = await sweepStatus();

  if (status?.signedIn) {
    if (sweepRun?.running) {
      return { ok: true, code: 200, state: "already running", sweep: sweepRun };
    }
    const started = await startSweep(minutes);
    if (!started.ok) return { ok: false, code: 502, message: started.message };
    return { ok: true, code: 202, state: "sweep started", sweep: started.run };
  }

  if (status && !status.signedIn) {
    return {
      ok: false,
      code: 409,
      state: "agent signed out",
      message: "the agent's browser is signed out — sign in to pixiv in the window it opened, then press again",
    };
  }

  const brave = await braveRunning();
  if (brave > 0 && !force) {
    return {
      ok: false,
      code: 409,
      state: "brave is open",
      needsBraveClosed: true,
      brave,
      message: `Brave has ${brave} processes open. The agent needs the profile to itself.`,
    };
  }
  if (brave > 0) {
    const closed = await closeBrave();
    if (!closed) {
      return { ok: false, code: 409, state: "brave would not close", message: "Brave is still running; quit it from the tray and press again" };
    }
  }

  const agent = await startAgent();
  if (!agent) {
    return { ok: false, code: 502, state: "agent did not start", message: "the agent never answered on 8099 — check agent.err" };
  }
  if (!agent.signedIn) {
    return {
      ok: false,
      code: 409,
      state: "agent signed out",
      message: "the agent started but pixiv shows signed out — sign in in the window that opened, then press again",
    };
  }

  const started = await startSweep(minutes);
  if (!started.ok) return { ok: false, code: 502, message: started.message };
  return { ok: true, code: 202, state: "sweep started", sweep: started.run };
}

export const __meta = { AGENT_DIR, USER_ID };
