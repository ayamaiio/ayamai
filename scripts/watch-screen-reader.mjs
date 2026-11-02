#!/usr/bin/env node
// Real NVDA speech verification; never opens an account or private media.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { Local } = require("browserstack-local");
const browser = process.env.WATCH_SR_BROWSER ?? "Chrome";
if (!["Chrome", "Firefox"].includes(browser)) throw new Error("WATCH_SR_BROWSER must be Chrome or Firefox.");
for (const key of ["BROWSERSTACK_USERNAME", "BROWSERSTACK_ACCESS_KEY"]) {
  if (!process.env[key]) throw new Error(`Missing ${key} in workspace secrets.`);
}
const appUrl = new URL(process.env.WATCH_SR_APP_URL ?? "http://bs-local.com:25221/__watch-lifecycle");
if (appUrl.protocol !== "http:" || appUrl.hostname !== "bs-local.com" ||
  appUrl.pathname !== "/__watch-lifecycle" || appUrl.search || appUrl.username || appUrl.password) {
  throw new Error("WATCH_SR_APP_URL must target the BrowserStack Local /__watch-lifecycle fixture, without query parameters.");
}
const hub = "https://hub-cloud.browserstack.com/wd/hub";
const auth = `Basic ${Buffer.from(`${process.env.BROWSERSTACK_USERNAME}:${process.env.BROWSERSTACK_ACCESS_KEY}`).toString("base64")}`;
const identifier = `watch-speech-${process.pid}`;
const tunnel = new Local();
const evidence = { browser, os: "Windows 11", screenReader: "BrowserStack-provisioned NVDA (build not exposed)", steps: [] };
let sessionId;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function redact(value) {
  for (const key of ["BROWSERSTACK_USERNAME", "BROWSERSTACK_ACCESS_KEY"]) {
    value = value.replaceAll(process.env[key], "[redacted]");
  }
  return value;
}
async function request(path, method, body) {
  const response = await fetch(`${hub}${path}`, {
    method, headers: { authorization: auth, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.value?.error) {
    throw new Error(redact(payload.value?.message ?? payload.message ?? response.statusText));
  }
  return payload.value ?? payload;
}
const command = (path, body, method = "POST") => request(`/session/${sessionId}${path}`, method, body);
const script = source => command("/execute/sync", { script: source, args: [] });
const executor = (action, args = {}) => script(`browserstack_executor: ${JSON.stringify({ action, arguments: args })}`);
const key = value => command("/actions", { actions: [{ type: "key", id: "keyboard", actions: [
  { type: "keyDown", value }, { type: "keyUp", value },
] }] });
const state = () => script(`const slider=document.querySelector('[role="slider"]'), video=document.querySelector('video'); return {
  focused: !!slider && document.activeElement===slider, position:video?.currentTime,
  duration:video?.duration, ready:video?.readyState, paused:video?.paused,
  value:slider?.getAttribute('aria-valuenow'), text:slider?.getAttribute('aria-valuetext'),
  label:slider?.getAttribute('aria-label'), scroll:document.querySelector('main')?.scrollTop,
  preview:document.querySelector('[data-testid="watch-seek-preview"]')?.textContent
};`);
const clock = time => `${Math.floor(time / 60)}:${String(Math.floor(time) % 60).padStart(2, "0")}`;
function spoken(time) {
  const minutes = Math.floor(time / 60), seconds = Math.floor(time) % 60;
  return `${minutes ? `${minutes} minute${minutes === 1 ? "" : "s"} ` : ""}${seconds} second${seconds === 1 ? "" : "s"}`;
}
async function capture(label, expected) {
  await sleep(expected ? 500 : 7000);
  const utterances = [];
  // The provider returns transient last-spoken chunks, not a full transcript.
  for (let attempt = 0; attempt < (expected ? 6 : 1); attempt++) {
    utterances.push(await executor("screenReaderSpokenDescription"));
    if (!expected || utterances.some(text => String(text).includes(expected))) break;
    await sleep(700);
  }
  const entry = { label, state: await state(), utterances };
  evidence.steps.push(entry);
  console.log(redact(JSON.stringify(entry)));
  if (expected) assert.ok(utterances.some(text => String(text).includes(expected)), `Missing actual speech: ${expected}`);
  return entry.state;
}
try {
  await mkdir("generated-artifacts", { recursive: true });
  await new Promise((resolve, reject) => tunnel.start({
    key: process.env.BROWSERSTACK_ACCESS_KEY, localIdentifier: identifier, onlyAutomate: "true",
  }, error => error ? reject(error) : resolve()));
  const session = await request("/session", "POST", { capabilities: { alwaysMatch: {
    browserName: browser, browserVersion: "latest",
    "bstack:options": {
      os: "Windows", osVersion: "11", sessionName: `Watch keyboard speech — ${browser}`,
      buildName: "Watch accessibility verification", local: true, localIdentifier: identifier,
      video: false, debug: false, networkLogs: false, consoleLogs: "disable",
    },
  } } });
  sessionId = session.sessionId;
  evidence.browserVersion = session.capabilities?.browserVersion;
  await command("/url", { url: appUrl.href });
  let loaded = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const snapshot = await state();
    if (snapshot.duration > 0 && snapshot.ready >= 2) { loaded = true; break; }
    await sleep(750);
  }
  assert.ok(loaded, "Synthetic clip did not load.");
  await script("document.querySelector('video').pause(); document.querySelector('video').currentTime=0;");
  await executor("screenReader", { enable: "true" });
  await sleep(1500);
  for (let attempt = 0; attempt < 18; attempt++) {
    await key("\uE004"); // Tab, not focus() or a synthetic DOM event.
    if ((await state()).focused) break;
  }
  const initial = await capture("Tab to slider");
  assert.ok(initial.focused, "Keyboard traversal did not reach the slider.");
  assert.match(initial.label, /Video position/);
  const maximum = initial.duration - Math.min(0.05, initial.duration);
  let position = 0;
  for (const [label, value, target] of [
    ["ArrowRight", "\uE014", () => Math.min(position + 5, maximum)],
    ["ArrowLeft", "\uE012", () => Math.max(position - 5, 0)],
    ["End", "\uE010", () => maximum],
    ["Home", "\uE011", () => 0],
    ["ArrowRight repeated", "\uE014", () => Math.min(position + 5, maximum)],
    ["ArrowLeft repeated", "\uE012", () => Math.max(position - 5, 0)],
  ]) {
    position = target();
    await key(value);
    const expected = `Video position: ${spoken(position)} of ${spoken(initial.duration)}.`;
    const snapshot = await capture(label, expected);
    assert.ok(snapshot.focused, `${label} moved focus.`);
    assert.ok(Math.abs(snapshot.position - position) < 0.001, `${label} did not seek correctly.`);
    assert.ok(Math.abs(Number(snapshot.value) - position) < 0.001);
    assert.equal(snapshot.text, `${clock(position)} of ${clock(initial.duration)}`);
    assert.equal(snapshot.paused, true);
    assert.equal(snapshot.scroll, initial.scroll);
  }
  await key("\uE014");
  await sleep(500);
  const rect = await script(`const r=document.querySelector('[role="slider"]').getBoundingClientRect();
    return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
  const pointer = actions => command("/actions", { actions: [
    { type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions },
  ] });
  await pointer([
    { type: "pointerMove", origin: "viewport", ...rect, duration: 0 },
    { type: "pointerDown", button: 0 }, { type: "pause", duration: 500 },
  ]);
  evidence.preview = await state();
  assert.ok(evidence.preview.preview, "Seek preview did not appear.");
  assert.equal(evidence.preview.preview, evidence.preview.text.replace(" of ", " / "));
  const screenshot = await command("/screenshot", undefined, "GET");
  await writeFile(`generated-artifacts/watch-sr-${browser.toLowerCase()}.png`, Buffer.from(screenshot, "base64"));
  await pointer([{ type: "pointerUp", button: 0 }]);
  evidence.passed = true;
} catch (error) {
  evidence.error = redact(error.message);
  console.error(evidence.error);
  process.exitCode = 1;
} finally {
  if (sessionId) {
    await executor("screenReader", { enable: "false" }).catch(error => console.warn(redact(error.message)));
    await request(`/session/${sessionId}`, "DELETE").catch(error => {
      console.error("Could not close remote session:", redact(error.message));
      process.exitCode = 1;
    });
  }
  if (tunnel.isRunning()) await new Promise(resolve => tunnel.stop(error => {
    if (error) { console.error("Could not close tunnel:", redact(error.message)); process.exitCode = 1; }
    resolve();
  }));
  await writeFile(`generated-artifacts/watch-sr-windows-${browser.toLowerCase()}.json`, redact(JSON.stringify(evidence, null, 2)));
}
