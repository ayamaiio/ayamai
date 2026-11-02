// Memory map, cartridges (MBC1/2/3/5), the timer, the joypad, and I/O dispatch.
//
// The cartridge is the only part with real variety: four different mappers, each
// with its own idea of what "bank" means. Everything above 0x8000 is just RAM and
// registers, so it lives in the MMU.

const RAM_SIZES = [0, 0x800, 0x2000, 0x8000, 0x20000, 0x10000];

export class Cartridge {
  constructor(rom) {
    this.rom = rom;
    this.type = rom[0x147] ?? 0;
    this.romBanks = Math.max(2, Math.ceil(rom.length / 0x4000));
    this.ramSize = RAM_SIZES[rom[0x149] ?? 0] ?? 0;
    this.ram = new Uint8Array(this.ramSize || 0x2000);   // some mappers need a scratch page

    this.ramEnabled = false;
    this.bankLow = 1;      // 0x2000-0x3fff: low bank bits
    this.bankHigh = 0;     // 0x4000-0x5fff: high bits / RAM bank / RTC select
    this.mode = 0;         // MBC1 banking mode
    this.rtc = { s: 0, m: 0, h: 0, dl: 0, dh: 0 };
    this.rtcLatch = { ...this.rtc };
  }

  get hasRam() { return this.ramSize > 0; }
  get isMBC1() { return this.type === 0x01 || this.type === 0x02 || this.type === 0x03; }
  get isMBC2() { return this.type === 0x05 || this.type === 0x06; }
  get isMBC3() { return this.type === 0x0f || this.type === 0x10 || this.type === 0x11 || this.type === 0x12 || this.type === 0x13; }
  get isMBC5() { return this.type >= 0x19 && this.type <= 0x1e; }

  /** Which bank answers at 0x4000-0x7fff right now. */
  romBank() {
    let bank;
    if (this.isMBC1) bank = ((this.bankHigh & 3) << 5) | this.bankLow;
    else if (this.isMBC2) bank = this.bankLow & 0x0f;
    else if (this.isMBC5) bank = ((this.bankHigh & 1) << 8) | this.bankLow;
    else bank = this.bankLow;                    // MBC3: 7 bits
    if (this.romBanks <= 32) bank &= 0x1f;
    return bank % this.romBanks;
  }

  lowBank() {
    if (this.isMBC1 && this.mode === 1) return ((this.bankHigh & 3) << 5) % this.romBanks;
    return 0;
  }

  read(addr) {
    if (addr < 0x4000) {
      const at = this.lowBank() * 0x4000 + addr;
      return at < this.rom.length ? this.rom[at] : 0xff;
    }
    if (addr < 0x8000) {
      const at = this.romBank() * 0x4000 + (addr - 0x4000);
      return at < this.rom.length ? this.rom[at] : 0xff;
    }
    // 0xa000-0xbfff: cartridge RAM, or an RTC register on MBC3.
    if (!this.ramEnabled) return 0xff;
    if (this.isMBC3 && this.bankHigh >= 0x08 && this.bankHigh <= 0x0c) {
      const key = ["s", "m", "h", "dl", "dh"][this.bankHigh - 0x08];
      return this.rtcLatch[key] ?? 0xff;
    }
    if (!this.hasRam) return 0xff;
    const bank = this.isMBC1 && this.mode === 0 ? 0 : (this.bankHigh & (this.isMBC5 ? 0x0f : 0x03));
    return this.ram[bank * 0x2000 + (addr - 0xa000)] ?? 0xff;
  }

  write(addr, value) {
    if (addr < 0x2000) { this.ramEnabled = (value & 0x0f) === 0x0a; return; }

    if (addr < 0x4000) {
      if (this.isMBC2) { if (!(addr & 0x0100)) this.bankLow = value & 0x0f; return; }
      if (this.isMBC5) { this.bankLow = value; return; }
      if (this.isMBC3) { this.bankLow = value & 0x7f; if (this.bankLow === 0) this.bankLow = 1; return; }
      this.bankLow = value & 0x1f;
      if (this.bankLow === 0) this.bankLow = 1;
      return;
    }

    if (addr < 0x6000) {
      if (this.isMBC1) { this.bankHigh = value & 0x03; return; }
      if (this.isMBC5) { this.bankHigh = value & 0x01; return; }
      // MBC3: RAM bank (0-3) or RTC register select (8-12)
      this.bankHigh = value & 0x0f;
      return;
    }

    // 0x6000-0x7fff
    if (this.isMBC1) { this.mode = value & 1; return; }
    if (this.isMBC3) {
      if (value === 0x00) this.rtcLatch = { ...this.rtc };
      else if (value === 0x01) this.rtcLatch = { ...this.rtc };
      return;
    }
  }

  writeRam(addr, value) {
    if (!this.ramEnabled) return;
    if (this.isMBC3 && this.bankHigh >= 0x08 && this.bankHigh <= 0x0c) {
      const key = ["s", "m", "h", "dl", "dh"][this.bankHigh - 0x08];
      this.rtc[key] = value;
      return;
    }
    if (!this.hasRam) return;
    const bank = this.isMBC1 && this.mode === 0 ? 0 : (this.bankHigh & (this.isMBC5 ? 0x0f : 0x03));
    this.ram[bank * 0x2000 + (addr - 0xa000)] = value;
  }
}

export class MMU {
  constructor(cart, ppu, timer) {
    this.cart = cart;
    this.ppu = ppu;
    this.timer = timer;
    this.vram = new Uint8Array(0x2000);
    this.wram = new Uint8Array(0x2000);
    this.oam = new Uint8Array(0xa0);
    this.hram = new Uint8Array(0x7f);
    this.ie = 0;
    this.iflag = 0;
    this.joySelect = 0x30;
    this.pressed = 0;      // bit 0 right, 1 left, 2 up, 3 down, 4 A, 5 B, 6 select, 7 start
    this.dma = 0xff;
    this.soundOn = true;
  }

  read(addr) {
    if (addr < 0x8000) return this.cart.read(addr);
    if (addr < 0xa000) return this.vram[addr - 0x8000];
    if (addr < 0xc000) return this.cart.read(addr);
    if (addr < 0xe000) return this.wram[addr - 0xc000];
    if (addr < 0xfe00) return this.wram[addr - 0xe000];
    if (addr < 0xfea0) return this.oam[addr - 0xfe00];
    if (addr < 0xff00) return 0x00;
    if (addr < 0xff80) return this.io(addr);
    if (addr < 0xffff) return this.hram[addr - 0xff80];
    return this.ie;
  }

  write(addr, value) {
    if (addr < 0x8000) { this.cart.write(addr, value); return; }
    if (addr < 0xa000) { this.vram[addr - 0x8000] = value; return; }
    if (addr < 0xc000) { this.cart.writeRam(addr, value); return; }
    if (addr < 0xe000) { this.wram[addr - 0xc000] = value; return; }
    if (addr < 0xfe00) { this.wram[addr - 0xe000] = value; return; }
    if (addr < 0xfea0) { this.oam[addr - 0xfe00] = value; return; }
    if (addr < 0xff00) return;
    if (addr < 0xff80) { this.io(addr, value); return; }
    if (addr < 0xffff) { this.hram[addr - 0xff80] = value; return; }
    this.ie = value;
  }

  /** P1: two select lines, active low. Returned bits are active low as well. */
  readJoypad() {
    let low = 0x0f;
    if ((this.joySelect & 0x10) === 0) low &= ~(this.pressed & 0x0f);
    if ((this.joySelect & 0x20) === 0) low &= ~((this.pressed >> 4) & 0x0f);
    return 0xc0 | (this.joySelect & 0x30) | low;
  }

  io(addr, value) {
    if (value === undefined) {
      switch (addr) {
        case 0xff00: return this.readJoypad();
        case 0xff04: return (this.timer.clock >> 8) & 0xff;
        case 0xff05: return this.timer.tima;
        case 0xff06: return this.timer.tma;
        case 0xff07: return this.timer.tac | 0xf8;
        case 0xff0f: return this.iflag | 0xe0;
        case 0xff40: case 0xff41: case 0xff42: case 0xff43: case 0xff44:
        case 0xff45: case 0xff47: case 0xff48: case 0xff49: case 0xff4a: case 0xff4b:
          return this.ppu.readRegister(addr);
        case 0xff26: return (this.soundOn ? 0x80 : 0x00) | 0x70;   // NR52: on, no channels active
        case 0xff24: return 0x77;                                  // NR50
        case 0xff25: return 0xf3;                                  // NR51
        case 0xff46: return this.dma;
        default:
          if (addr >= 0xff30 && addr <= 0xff3f) return 0x00;       // wave RAM
          return 0xff;
      }
    }
    switch (addr) {
      case 0xff00: this.joySelect = value & 0x30; break;
      case 0xff04: this.timer.resetDiv(); break;
      case 0xff05: this.timer.tima = value; break;
      case 0xff06: this.timer.tma = value; break;
      case 0xff07: this.timer.tac = value & 0x07; break;
      case 0xff0f: this.iflag = value & 0x1f; break;
      case 0xff46:
        this.dma = value;
        for (let i = 0; i < 0xa0; i++) this.oam[i] = this.read((value << 8) + i);
        break;
      case 0xff40: case 0xff41: case 0xff42: case 0xff43: case 0xff45:
      case 0xff47: case 0xff48: case 0xff49: case 0xff4a: case 0xff4b:
        this.ppu.writeRegister(addr, value); break;
      default: break;
    }
  }

  requestInterrupt(bit) { this.iflag |= bit; }
}

// The timer counts T-cycles in one monotonic clock. DIV is its top byte; TIMA
// ticks on the falling edge of one of four bits, so the period is 2^(bit+1).
export class Timer {
  constructor(mmu) {
    this.mmu = mmu;
    this.clock = 0;
    this.tima = 0;
    this.tma = 0;
    this.tac = 0;
  }

  resetDiv() { this.clock = 0; }

  step(cycles) {
    const before = this.clock;
    this.clock += cycles;
    if (!(this.tac & 0x04)) return;

    const bit = [9, 3, 5, 7][this.tac & 3];
    const period = 1 << (bit + 1);
    const edges = Math.floor(this.clock / period) - Math.floor(before / period);
    for (let i = 0; i < edges; i++) {
      if (this.tima === 0xff) { this.tima = this.tma; this.mmu.requestInterrupt(0x04); }
      else this.tima += 1;
    }
  }
}
