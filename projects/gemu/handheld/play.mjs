#!/usr/bin/env node
// play - run a ROM and serve it to a browser on loopback. Zero dependencies.
//
//   node toys/gb/play.mjs <rom.gb> [port]
//
// The page is a 160x144 canvas at 3x on the shared surface kit. The emulator runs
// on a fixed 60 Hz timer; the page polls /frame for the latest PNG and posts
// button presses to /press. Same data, two views: run.mjs is the headless one.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { GameBoy, BUTTONS } from "./gb.mjs";
import { SCREEN_W, SCREEN_H } from "./ppu.mjs";
import { encodePNG } from "./png.mjs";

const [romPath, portArg] = process.argv.slice(2);
if (!romPath) { console.error("usage: node toys/gb/play.mjs <rom.gb> [port]"); process.exit(1); }
const PORT = Number(portArg ?? process.env.GB_PORT ?? 4480);
// Served at the root or under the front door's prefix.
const BASE = (process.env.BASE_PREFIX ?? "").replace(/\/$/, "");

const KIT = readFileSync(new URL("../../../ui/ui.css", import.meta.url), "utf8");
const rom = new Uint8Array(readFileSync(romPath));
const gb = new GameBoy(rom);

let png = encodePNG(SCREEN_W, SCREEN_H, gb.ppu.rgbFrame());
let dirty = true;
const held = new Map();   // button name -> frames remaining

setInterval(() => {
  let mask = 0;
  for (const [name, frames] of held) {
    mask |= BUTTONS[name] ?? 0;
    if (frames <= 1) held.delete(name); else held.set(name, frames - 1);
  }
  gb.setButtons(mask);
  gb.runFrame();
  dirty = true;
}, 1000 / 59.7275).unref();

setInterval(() => {
  if (!dirty) return;
  png = encodePNG(SCREEN_W, SCREEN_H, gb.ppu.rgbFrame());
  dirty = false;
}, 1000 / 30).unref();

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ayamai / gb</title>
<link rel="stylesheet" href="/ui/brand.css">
<style>${KIT}
  main { display: grid; place-items: center; gap: 20px; padding: 40px 20px; min-height: calc(100vh - 58px); }
  canvas { width: ${SCREEN_W * 3}px; height: ${SCREEN_H * 3}px; image-rendering: pixelated; background: #000;
    border: 1px solid var(--line); border-radius: 10px;
    box-shadow: 0 0 0 1px rgba(169,183,232,.06), 0 50px 140px -50px rgba(169,183,232,.45); }
  .keys { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center;
    font-family: var(--mono); font-size: 11px; color: var(--dim); }
  .keys kbd { color: var(--eva); font-family: var(--mono); }
</style></head>
<body>
<header class="bar">
  <a class="brand" href="${BASE}/"><span class="word">ayamai</span><span class="slash">/</span><span class="tool">gb</span></a>
  <span class="clock" id="state">booting</span>
</header>
<main>
  <canvas id="c" width="${SCREEN_W}" height="${SCREEN_H}"></canvas>
  <div class="keys">
    <span><kbd>arrows</kbd> d-pad</span>
    <span><kbd>z</kbd> A</span>
    <span><kbd>x</kbd> B</span>
    <span><kbd>enter</kbd> start</span>
    <span><kbd>shift</kbd> select</span>
  </div>
</main>
<script>
  const c = document.getElementById("c").getContext("2d");
  const img = new Image();
  const state = document.getElementById("state");

  async function frame() {
    try {
      const r = await fetch("${BASE}/frame");
      const b = await r.blob();
      img.src = URL.createObjectURL(b);
      await img.decode();
      c.drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      state.textContent = "running";
    } catch { state.textContent = "disconnected"; }
    setTimeout(frame, 33);
  }
  frame();

  const map = { ArrowUp:"up", ArrowDown:"down", ArrowLeft:"left", ArrowRight:"right",
                z:"a", Z:"a", x:"b", X:"b", Enter:"start", Shift:"select" };
  addEventListener("keydown", (e) => {
    const b = map[e.key];
    if (!b) return;
    e.preventDefault();
    fetch("${BASE}/press?btn=" + b + "&frames=6", { method: "POST" });
  });
</script>
</body></html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (BASE && url.pathname.startsWith(BASE)) url.pathname = url.pathname.slice(BASE.length) || "/";
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  if (url.pathname === "/ui.css") {
    res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    res.end(KIT);
    return;
  }
  if (url.pathname === "/frame") {
    res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
    res.end(png);
    return;
  }
  if (url.pathname === "/press" && req.method === "POST") {
    const btn = url.searchParams.get("btn");
    const frames = Math.min(60, Number(url.searchParams.get("frames") ?? 6));
    if (btn in BUTTONS) held.set(btn, frames);
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === "/state") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ...gb.state(), pressed: gb.mmu.pressed, held: [...held.keys()] }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`gb: ${romPath}\n    http://127.0.0.1:${PORT}`);
});
