#!/usr/bin/env node
// shot - screenshot a page of the local app, authenticated as the local founder.
//
//   node scripts/shot.mjs <path> <out.png> [--wait 4000] [--width 1440] [--height 900] [--full]
//
// Drives headless Chrome over CDP. No dependencies: node's WebSocket, chrome's
// own debug port. The dev session is created from inside the page, so the cookie
// lands on the right origin.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const pagePath = argv[0] ?? "/";
const out = argv[1] ?? "shot.png";
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : def; };
const width = opt("--width", 1440);
const height = opt("--height", 900);
const waitMs = opt("--wait", 4000);
const full = argv.includes("--full");
const evalIndex = argv.indexOf("--eval");
const evalJs = evalIndex >= 0 ? argv[evalIndex + 1] : null;
const base = process.env.APP_URL ?? "http://localhost:25222";
const target = pagePath.startsWith("http") ? pagePath : base + pagePath;
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn("google-chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu",
  "--hide-scrollbars", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required",
  `--window-size=${width},${height}`, "about:blank",
], { stdio: "ignore" });

let ws;
let nextId = 1;
const pending = new Map();
const listeners = new Map();

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 30000);
  });
}

function once(event, timeout = 15000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeout);
    const fn = (params) => { clearTimeout(timer); listeners.get(event)?.delete(fn); resolve(params); };
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
  });
}

async function main() {
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = (await res.json()).filter((t) => t.type === "page");
      if (targets.length) break;
    } catch {}
    await sleep(200);
  }
  if (!targets?.length) throw new Error("chrome did not expose a page target");

  ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      data.error ? reject(new Error(data.error.message)) : resolve(data.result);
    } else if (data.method) {
      listeners.get(data.method)?.forEach((fn) => fn(data.params));
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

  // First load: whatever the app does without a session.
  const loaded = once("Page.loadEventFired");
  await send("Page.navigate", { url: target });
  await loaded;
  await sleep(800);

  // Create the local-founder session from the page origin, then load for real.
  await send("Runtime.evaluate", {
    expression: `fetch("/api/dev-auth/session", { method: "POST", headers: { Origin: location.origin } }).then(r => r.status)`,
    awaitPromise: true,
  });

  const reloaded = once("Page.loadEventFired");
  await send("Page.navigate", { url: target });
  await reloaded;
  await sleep(waitMs);
  if (evalJs) { await send("Runtime.evaluate", { expression: evalJs }); await sleep(3000); }

  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
  writeFileSync(out, Buffer.from(data, "base64"));

  const { result } = await send("Runtime.evaluate", {
    expression: `JSON.stringify({ url: location.href, title: document.title, h: document.documentElement.scrollHeight, text: document.body.innerText.slice(0, 300) })`,
    returnByValue: true,
  });
  console.log(result.value);
}

main()
  .catch((err) => { console.error(`shot failed: ${err.message}`); process.exitCode = 1; })
  .finally(async () => { try { ws?.close(); } catch {} chrome.kill("SIGKILL"); });
