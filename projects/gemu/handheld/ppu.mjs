// The PPU: 160x144, background, window, sprites, and the mode timing that
// drives STAT and VBlank interrupts. One scanline is drawn as it leaves mode 3.
//
// A line is 456 dots: mode 2 (OAM) for 80, mode 3 (transfer) for 172, mode 0
// (HBlank) for 204. Lines 144-153 are VBlank.

export const SCREEN_W = 160;
export const SCREEN_H = 144;

// The DMG's four greens, lightest first. Shade 0 is the background.
export const PALETTE = [
  [0x9b, 0xbc, 0x0f],
  [0x8b, 0xac, 0x0f],
  [0x30, 0x62, 0x30],
  [0x0f, 0x38, 0x0f],
];

const MODE_HBLANK = 0, MODE_VBLANK = 1, MODE_OAM = 2, MODE_TRANSFER = 3;

export class PPU {
  constructor(mmu) {
    this.mmu = mmu;
    this.lcdc = 0x91; this.stat = 0x00; this.scy = 0; this.scx = 0;
    this.ly = 0; this.lyc = 0; this.bgp = 0xfc; this.obp0 = 0xff; this.obp1 = 0xff;
    this.wy = 0; this.wx = 0;
    this.mode = MODE_OAM;
    this.dot = 0;
    this.framebuffer = new Uint8Array(SCREEN_W * SCREEN_H);
    this.bgColor = new Uint8Array(SCREEN_W * SCREEN_H);
    this.frameReady = false;
    this.frames = 0;
  }

  readRegister(addr) {
    switch (addr) {
      case 0xff40: return this.lcdc;
      case 0xff41: return 0x80 | (this.stat & 0x78) | (this.mode & 3) | (this.ly === this.lyc ? 0x04 : 0);
      case 0xff42: return this.scy;
      case 0xff43: return this.scx;
      case 0xff44: return this.ly;
      case 0xff45: return this.lyc;
      case 0xff47: return this.bgp;
      case 0xff48: return this.obp0;
      case 0xff49: return this.obp1;
      case 0xff4a: return this.wy;
      case 0xff4b: return this.wx;
      default: return 0xff;
    }
  }

  writeRegister(addr, value) {
    switch (addr) {
      case 0xff40: {
        const wasOff = (this.lcdc & 0x80) === 0;
        this.lcdc = value;
        if (wasOff && (value & 0x80)) { this.ly = 0; this.dot = 0; this.mode = MODE_OAM; }
        if (!(value & 0x80)) { this.ly = 0; this.dot = 0; this.mode = MODE_HBLANK; this.framebuffer.fill(0); }
        break;
      }
      case 0xff41: this.stat = (this.stat & 0x07) | (value & 0x78); break;
      case 0xff42: this.scy = value; break;
      case 0xff43: this.scx = value; break;
      case 0xff45: this.lyc = value; break;
      case 0xff47: this.bgp = value; break;
      case 0xff48: this.obp0 = value; break;
      case 0xff49: this.obp1 = value; break;
      case 0xff4a: this.wy = value; break;
      case 0xff4b: this.wx = value; break;
      default: break;
    }
  }

  modeLength() {
    switch (this.mode) {
      case MODE_OAM: return 80;
      case MODE_TRANSFER: return 172;
      case MODE_HBLANK: return 204;
      default: return 456;
    }
  }

  step(cycles) {
    if (!(this.lcdc & 0x80)) return 0;
    let irq = 0;
    this.dot += cycles;

    for (let guard = 0; guard < 4; guard++) {
      const limit = this.modeLength();
      if (this.dot < limit) break;
      this.dot -= limit;
      irq |= this.advanceMode();
    }
    return irq;
  }

  advanceMode() {
    let irq = 0;
    if (this.mode === MODE_OAM) {
      this.mode = MODE_TRANSFER;
      return irq;
    }
    if (this.mode === MODE_TRANSFER) {
      this.mode = MODE_HBLANK;
      if (this.ly < SCREEN_H) this.renderScanline();
      if (this.stat & 0x08) irq |= 0x02;             // HBlank interrupt
      return irq;
    }

    // End of a line: either another visible line, or VBlank, or a wrap.
    this.ly += 1;
    irq |= this.lycCheck();

    if (this.ly === SCREEN_H) {
      this.mode = MODE_VBLANK;
      this.frameReady = true;
      this.frames += 1;
      irq |= 0x01;                                    // VBlank interrupt
      if (this.stat & 0x10) irq |= 0x02;
    } else if (this.ly > 153) {
      this.ly = 0;
      this.mode = MODE_OAM;
      irq |= this.lycCheck();
      if (this.stat & 0x20) irq |= 0x02;
    } else if (this.ly < SCREEN_H) {
      this.mode = MODE_OAM;
      if (this.stat & 0x20) irq |= 0x02;
    }
    return irq;
  }

  lycCheck() {
    if (this.ly === this.lyc && (this.stat & 0x40)) return 0x02;
    return 0;
  }

  renderScanline() {
    const y = this.ly;
    const row = y * SCREEN_W;
    const vram = this.mmu.vram;
    const lcdc = this.lcdc;

    if (!(lcdc & 0x01)) {
      this.framebuffer.fill(0, row, row + SCREEN_W);
      this.bgColor.fill(0, row, row + SCREEN_W);
      return;
    }

    const unsignedTiles = (lcdc & 0x10) !== 0;
    const bgMap = (lcdc & 0x08) ? 0x1c00 : 0x1800;
    const winMap = (lcdc & 0x40) ? 0x1c00 : 0x1800;
    const winX = this.wx - 7;
    const winActive = (lcdc & 0x20) !== 0 && y >= this.wy && this.wx <= 166;

    for (let x = 0; x < SCREEN_W; x++) {
      let tileIndex, fineY, fineX, map, px, py;

      if (winActive && x >= winX) {
        map = winMap;
        px = x - winX;
        py = y - this.wy;
      } else {
        map = bgMap;
        px = (x + this.scx) & 0xff;
        py = (y + this.scy) & 0xff;
      }

      tileIndex = vram[map + ((py >> 3) & 31) * 32 + ((px >> 3) & 31)];
      const tileBase = unsignedTiles ? tileIndex * 16 : 0x1000 + ((tileIndex << 24 >> 24) * 16);
      fineY = py & 7;
      const lo = vram[(tileBase + fineY * 2) & 0x1fff];
      const hi = vram[(tileBase + fineY * 2 + 1) & 0x1fff];
      fineX = 7 - (px & 7);
      const color = (((hi >> fineX) & 1) << 1) | ((lo >> fineX) & 1);

      this.bgColor[row + x] = color;
      this.framebuffer[row + x] = (this.bgp >> (color * 2)) & 3;
    }

    if (lcdc & 0x02) this.renderSprites(y, row);
  }

  renderSprites(y, row) {
    const tall = (this.lcdc & 0x04) !== 0;
    const height = tall ? 16 : 8;
    const oam = this.mmu.oam;
    const vram = this.mmu.vram;

    const candidates = [];
    for (let i = 0; i < 40; i++) {
      const sy = oam[i * 4] - 16;
      if (y < sy || y >= sy + height) continue;
      candidates.push({ i, sx: oam[i * 4 + 1] - 8, sy });
    }
    if (candidates.length === 0) return;

    // Ten per line, chosen by X then OAM order; drawn far-to-near so the
    // lowest OAM index wins ties.
    candidates.sort((a, b) => a.sx - b.sx || a.i - b.i);
    const visible = candidates.slice(0, 10).sort((a, b) => a.sx - b.sx || b.i - a.i);

    for (const s of visible) {
      const tile = oam[s.i * 4 + 2];
      const flags = oam[s.i * 4 + 3];
      let line = y - s.sy;
      if (flags & 0x40) line = height - 1 - line;      // vertical flip
      const tileNumber = tall ? (tile & 0xfe) + (line >= 8 ? 1 : 0) : tile;
      const addr = (tileNumber * 16 + (line & 7) * 2) & 0x1fff;
      const lo = vram[addr];
      const hi = vram[addr + 1];
      const palette = (flags & 0x10) ? this.obp1 : this.obp0;

      for (let px = 0; px < 8; px++) {
        const x = s.sx + px;
        if (x < 0 || x >= SCREEN_W) continue;
        const bit = (flags & 0x20) ? px : 7 - px;      // horizontal flip
        const color = (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1);
        if (color === 0) continue;
        if ((flags & 0x80) && this.bgColor[row + x] !== 0) continue;  // BG priority
        this.framebuffer[row + x] = (palette >> (color * 2)) & 3;
      }
    }
  }

  rgbFrame() {
    const out = new Uint8Array(SCREEN_W * SCREEN_H * 3);
    for (let i = 0; i < this.framebuffer.length; i++) {
      const [r, g, b] = PALETTE[this.framebuffer[i] & 3];
      out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
    }
    return out;
  }
}
