#!/usr/bin/env node
// Run a ROM headlessly for N frames and write the last frame as a PNG.
//
//   node gb/run.mjs <rom.gb> [frames] [out.png] [--press start@180] [--at 240]
//
// --press <button>@<frame>  tap a button on that frame (repeatable)
// --at <frame>              capture the frame at that point instead of the end
import { readFileSync } from "node:fs";
import { GameBoy, BUTTONS } from "./gb.mjs";
import { SCREEN_W, SCREEN_H } from "./ppu.mjs";
import { writePNG } from "./png.mjs";

const argv = process.argv.slice(2);
const positional = [];
const presses = [];
let captureAt = null;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--press") {
    const [name, frame] = String(argv[++i]).split("@");
    if (!(name in BUTTONS)) { console.error(`unknown button: ${name}`); process.exit(2); }
    presses.push({ mask: BUTTONS[name], frame: Number(frame ?? 0) });
  } else if (arg === "--at") {
    captureAt = Number(argv[++i]);
  } else {
    positional.push(arg);
  }
}

const [romPath, framesArg, outArg] = positional;
if (!romPath) {
  console.error("usage: node gb/run.mjs <rom.gb> [frames] [out.png] [--press start@180] [--at 240]");
  process.exit(1);
}

const frames = Number(framesArg ?? 180);
const out = outArg ?? "frame.png";
const rom = new Uint8Array(readFileSync(romPath));
const gb = new GameBoy(rom);

let shot = null;
const started = Date.now();

for (let i = 0; i < frames; i++) {
  for (const p of presses) if (p.frame === i) gb.tap(Object.keys(BUTTONS).find((k) => BUTTONS[k] === p.mask), 2);
  gb.runFrame();
  if (captureAt !== null && i === captureAt) shot = gb.ppu.rgbFrame();
}

const elapsed = Date.now() - started;
writePNG(out, SCREEN_W, SCREEN_H, shot ?? gb.ppu.rgbFrame());

const s = gb.state();
console.log(JSON.stringify({
  rom: romPath,
  title: String.fromCharCode(...rom.slice(0x134, 0x143)).replace(/\0.*$/, "").trim(),
  cartType: `0x${rom[0x147].toString(16).padStart(2, "0")}`,
  frames,
  seconds: Number((frames / 59.7275).toFixed(2)),
  tookMs: elapsed,
  fps: Number((frames / (elapsed / 1000)).toFixed(1)),
  pc: `0x${s.pc.toString(16)}`,
  ly: s.ly,
  mode: s.mode,
  coverage: Number(gb.coverage().toFixed(4)),
  halted: s.halted,
  lcdc: `0x${s.lcdc.toString(16)}`,
  out,
}, null, 2));
