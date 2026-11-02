// The machine: one CPU, one memory map, one PPU, one timer, 59.7 frames a second.
import { CPU } from "./cpu.mjs";
import { MMU, Cartridge, Timer } from "./mmu.mjs";
import { PPU, SCREEN_W, SCREEN_H } from "./ppu.mjs";

export const CYCLES_PER_FRAME = 70224; // 4194304 Hz / 59.7275 fps

export const BUTTONS = {
  right: 0x01, left: 0x02, up: 0x04, down: 0x08,
  a: 0x10, b: 0x20, select: 0x40, start: 0x80,
};

export class GameBoy {
  constructor(rom) {
    this.cart = new Cartridge(rom);
    this.ppu = new PPU(null);
    this.timer = new Timer(null);
    this.mmu = new MMU(this.cart, this.ppu, this.timer);
    this.ppu.mmu = this.mmu;
    this.timer.mmu = this.mmu;
    this.cpu = new CPU(this.mmu);
    this.frames = 0;
    this.pixels = new Uint8Array(SCREEN_W * SCREEN_H);
  }

  /** Bitmask of held buttons; see BUTTONS. */
  setButtons(mask) { this.mmu.pressed = mask & 0xff; }

  tap(name, frames = 2) {
    this.hold = { mask: BUTTONS[name] ?? 0, frames };
  }

  runFrame() {
    const target = this.cpu.cycles + CYCLES_PER_FRAME;
    this.ppu.frameReady = false;

    if (this.hold) {
      this.setButtons(this.hold.mask);
      if (--this.hold.frames <= 0) { this.hold = null; this.setButtons(0); }
    }

    while (this.cpu.cycles < target) {
      const used = this.cpu.step();
      const irq = this.ppu.step(used);
      if (irq) this.mmu.requestInterrupt(irq);
      this.timer.step(used);
    }
    this.pixels.set(this.ppu.framebuffer);
    this.frames += 1;
  }

  runFrames(n) { for (let i = 0; i < n; i++) this.runFrame(); }

  /** Share of the screen that is not the lightest shade. */
  coverage() {
    let lit = 0;
    for (const p of this.ppu.framebuffer) if (p !== 0) lit += 1;
    return lit / this.ppu.framebuffer.length;
  }

  state() {
    return {
      pc: this.cpu.pc, cycles: this.cpu.cycles, frames: this.frames,
      ly: this.ppu.ly, mode: this.ppu.mode,
      lcdc: this.ppu.lcdc, stat: this.ppu.stat,
      ie: this.mmu.ie, iflag: this.mmu.iflag,
      halted: this.cpu.halted, ime: this.cpu.ime,
    };
  }
}
