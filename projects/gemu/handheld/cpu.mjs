// The CPU: a Sharp LR35902 (SM83), the 8-bit core inside the Game Boy.
//
// Everything here is one instruction at a time, in T-states (4 ticks each).
// The decoder is ordered by opcode family, which is how the instruction map
// actually works: 0x40-0x7f is LD r,r', 0x80-0xbf is ALU A,r, and the
// eight INC/DEC/LD r,n registers fall out of (opcode >> 3) & 7.

const Z = 0x80, N = 0x40, H = 0x20, C = 0x10;

export class CPU {
  constructor(mmu) { this.mmu = mmu; this.reset(); }

  reset() {
    this.a = 0x01; this.f = 0xb0; this.b = 0x00; this.c = 0x13; this.d = 0x00; this.e = 0xd8;
    this.h = 0x01; this.l = 0x4d; this.sp = 0xfffe; this.pc = 0x0100;
    this.ime = false; this.imeDelay = 0; this.halted = false; this.haltBug = false;
    this.stopped = false; this.cycles = 0;
  }

  // ---- registers ---------------------------------------------------------
  get bc() { return (this.b << 8) | this.c; } set bc(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
  get de() { return (this.d << 8) | this.e; } set de(v) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
  get hl() { return (this.h << 8) | this.l; } set hl(v) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
  get af() { return (this.a << 8) | this.f; }

  read(addr) { return this.mmu.read(addr); }
  write(addr, value) { this.mmu.write(addr, value); }
  fetch() { const v = this.read(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
  fetch16() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
  push(v) {
    this.sp = (this.sp - 1) & 0xffff; this.write(this.sp, (v >> 8) & 0xff);
    this.sp = (this.sp - 1) & 0xffff; this.write(this.sp, v & 0xff);
  }
  pop() {
    const lo = this.read(this.sp); this.sp = (this.sp + 1) & 0xffff;
    const hi = this.read(this.sp); this.sp = (this.sp + 1) & 0xffff;
    return lo | (hi << 8);
  }

  setFlag(mask, on) { if (on) this.f |= mask; else this.f &= ~mask; this.f &= 0xff; }
  test(mask) { return (this.f & mask) !== 0; }

  // ---- 8-bit arithmetic --------------------------------------------------
  add8(v, carry = 0) {
    const r = this.a + v + carry;
    this.f = 0;
    this.setFlag(Z, (r & 0xff) === 0);
    this.setFlag(H, ((this.a & 0xf) + (v & 0xf) + carry) > 0xf);
    this.setFlag(C, r > 0xff);
    this.a = r & 0xff;
  }
  sub8(v, carry = 0, store = true) {
    const r = this.a - v - carry;
    this.f = N;
    this.setFlag(Z, (r & 0xff) === 0);
    this.setFlag(H, ((this.a & 0xf) - (v & 0xf) - carry) < 0);
    this.setFlag(C, r < 0);
    if (store) this.a = r & 0xff;
    return r & 0xff;
  }
  and8(v) { this.a &= v; this.f = H | (this.a === 0 ? Z : 0); }
  xor8(v) { this.a ^= v; this.f = this.a === 0 ? Z : 0; }
  or8(v) { this.a |= v; this.f = this.a === 0 ? Z : 0; }
  cp8(v) { this.sub8(v, 0, false); }

  inc8(v) {
    const r = (v + 1) & 0xff;
    this.f = (this.f & C) | (r === 0 ? Z : 0) | (((v & 0xf) + 1) > 0xf ? H : 0);
    return r;
  }
  dec8(v) {
    const r = (v - 1) & 0xff;
    this.f = (this.f & C) | N | (r === 0 ? Z : 0) | ((v & 0xf) === 0 ? H : 0);
    return r;
  }
  add16(v) {
    const r = this.hl + v;
    this.f = (this.f & Z) | (((this.hl & 0xfff) + (v & 0xfff)) > 0xfff ? H : 0) | (r > 0xffff ? C : 0);
    this.hl = r & 0xffff;
  }
  /** ADD SP,e / LD HL,SP+e share flags: (SP&0xf)+(e&0xf) carry, (SP&0xff)+(e&0xff) carry. */
  addSpSigned() {
    const e = this.fetch();
    const u = e < 0x80 ? e : e - 256;
    this.f = (((this.sp & 0xf) + (e & 0xf)) > 0xf ? H : 0) | (((this.sp & 0xff) + e) > 0xff ? C : 0);
    return u;
  }

  r8(i) {
    switch (i) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return this.h; case 5: return this.l; case 6: return this.read(this.hl); default: return this.a;
    }
  }
  w8(i, v) {
    switch (i) {
      case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
      case 4: this.h = v; break; case 5: this.l = v; break; case 6: this.write(this.hl, v); break; default: this.a = v;
    }
  }

  // ---- interrupts --------------------------------------------------------
  serviceInterrupt() {
    // Priority: VBlank, STAT, timer, serial, joypad.
    this.halted = false;
    const order = [0x01, 0x02, 0x04, 0x08, 0x10];
    for (const bit of order) {
      if ((this.mmu.ie & bit) && (this.mmu.iflag & bit)) {
        this.ime = false;
        this.mmu.iflag &= ~bit;
        this.push(this.pc);
        this.pc = 0x40 + { 0x01: 0, 0x02: 8, 0x04: 16, 0x08: 24, 0x10: 32 }[bit];
        return 20;
      }
    }
    return 0;
  }

  step() {
    // EI takes effect after the instruction that follows it.
    if (this.imeDelay > 0) { this.imeDelay -= 1; if (this.imeDelay === 0) this.ime = true; }
    if (this.stopped) { this.cycles += 4; return 4; }
    if (this.ime && (this.mmu.ie & this.mmu.iflag & 0x1f)) {
      const taken = this.serviceInterrupt();
      if (taken) { this.cycles += taken; return taken; }
    }
    if (this.halted) {
      this.cycles += 4;
      if (this.mmu.ie & this.mmu.iflag & 0x1f) this.halted = false;
      return 4;
    }

    const op = this.fetch();
    let used = 4;
    if (this.haltBug) { this.pc = (this.pc - 1) & 0xffff; this.haltBug = false; }

    used += op === 0xcb ? this.executeCB(this.fetch()) : this.execute(op);
    this.cycles += used;
    return used;
  }

  // ---- the decoder -------------------------------------------------------
  execute(op) {
    // 0x40-0x7f: LD r,r' (0x76 is HALT, handled first).
    if (op >= 0x40 && op <= 0x7f) {
      if (op === 0x76) {
        if (!this.ime && (this.mmu.ie & this.mmu.iflag & 0x1f)) this.haltBug = true;
        else this.halted = true;
        return 0;
      }
      const dst = (op >> 3) & 7, src = op & 7;
      this.w8(dst, this.r8(src));
      return dst === 6 || src === 6 ? 4 : 0;
    }

    // 0x80-0xbf: ALU A,r
    if (op >= 0x80 && op <= 0xbf) {
      this.alu((op >> 3) & 7, this.r8(op & 7));
      return (op & 7) === 6 ? 4 : 0;
    }

    // 0x04/0x0c/0x14/...: INC r ; 0x05/...: DEC r ; 0x06/...: LD r,n
    const lo = op & 7;
    if (op < 0x40 && lo === 4) { const r = (op >> 3) & 7; this.w8(r, this.inc8(this.r8(r))); return r === 6 ? 8 : 4; }
    if (op < 0x40 && lo === 5) { const r = (op >> 3) & 7; this.w8(r, this.dec8(this.r8(r))); return r === 6 ? 8 : 4; }
    if (op < 0x40 && lo === 6) { const r = (op >> 3) & 7; this.w8(r, this.fetch()); return r === 6 ? 8 : 4; }

    switch (op) {
      case 0x00: return 0;                                    // NOP
      case 0x10: this.fetch(); return 0;                      // STOP (treat as a 2-byte NOP)
      case 0xf3: this.ime = false; this.imeDelay = 0; return 0;   // DI
      case 0xfb: this.imeDelay = 2; return 0;                 // EI (delayed by one instruction)

      // 16-bit loads
      case 0x01: this.bc = this.fetch16(); return 8;
      case 0x11: this.de = this.fetch16(); return 8;
      case 0x21: this.hl = this.fetch16(); return 8;
      case 0x31: this.sp = this.fetch16(); return 8;
      case 0xf9: this.sp = this.hl; return 4;                 // LD SP,HL
      case 0xf8: {                                            // LD HL,SP+e
        const e = this.fetch();
        this.f = (((this.sp & 0xf) + (e & 0xf)) > 0xf ? H : 0) | (((this.sp & 0xff) + e) > 0xff ? C : 0);
        this.hl = (this.sp + (e < 0x80 ? e : e - 256)) & 0xffff;
        return 8;
      }
      case 0x08: {                                            // LD (nn),SP
        const addr = this.fetch16();
        this.write(addr, this.sp & 0xff);
        this.write((addr + 1) & 0xffff, this.sp >> 8);
        return 16;
      }

      // 8-bit loads to/from memory
      case 0x02: this.write(this.bc, this.a); return 4;
      case 0x12: this.write(this.de, this.a); return 4;
      case 0x22: this.write(this.hl, this.a); this.hl = (this.hl + 1) & 0xffff; return 4;
      case 0x32: this.write(this.hl, this.a); this.hl = (this.hl - 1) & 0xffff; return 4;
      case 0x0a: this.a = this.read(this.bc); return 4;
      case 0x1a: this.a = this.read(this.de); return 4;
      case 0x2a: this.a = this.read(this.hl); this.hl = (this.hl + 1) & 0xffff; return 4;
      case 0x3a: this.a = this.read(this.hl); this.hl = (this.hl - 1) & 0xffff; return 4;
      case 0x36: this.write(this.hl, this.fetch()); return 8;
      case 0xe0: this.write(0xff00 + this.fetch(), this.a); return 8;    // LDH (n),A
      case 0xf0: this.a = this.read(0xff00 + this.fetch()); return 8;    // LDH A,(n)
      case 0xe2: this.write(0xff00 + this.c, this.a); return 4;          // LD (C),A
      case 0xf2: this.a = this.read(0xff00 + this.c); return 4;          // LD A,(C)
      case 0xea: this.write(this.fetch16(), this.a); return 12;          // LD (nn),A
      case 0xfa: this.a = this.read(this.fetch16()); return 12;          // LD A,(nn)

      // 8-bit ALU with an immediate
      case 0xc6: this.alu(0, this.fetch()); return 4;
      case 0xce: this.alu(1, this.fetch()); return 4;
      case 0xd6: this.alu(2, this.fetch()); return 4;
      case 0xde: this.alu(3, this.fetch()); return 4;
      case 0xe6: this.alu(4, this.fetch()); return 4;
      case 0xee: this.alu(5, this.fetch()); return 4;
      case 0xf6: this.alu(6, this.fetch()); return 4;
      case 0xfe: this.alu(7, this.fetch()); return 4;

      // 16-bit arithmetic
      case 0x03: this.bc = (this.bc + 1) & 0xffff; return 4;
      case 0x13: this.de = (this.de + 1) & 0xffff; return 4;
      case 0x23: this.hl = (this.hl + 1) & 0xffff; return 4;
      case 0x33: this.sp = (this.sp + 1) & 0xffff; return 4;
      case 0x0b: this.bc = (this.bc - 1) & 0xffff; return 4;
      case 0x1b: this.de = (this.de - 1) & 0xffff; return 4;
      case 0x2b: this.hl = (this.hl - 1) & 0xffff; return 4;
      case 0x3b: this.sp = (this.sp - 1) & 0xffff; return 4;
      case 0x09: this.add16(this.bc); return 4;
      case 0x19: this.add16(this.de); return 4;
      case 0x29: this.add16(this.hl); return 4;
      case 0x39: this.add16(this.sp); return 4;
      case 0xe8: {                                            // ADD SP,e
        const e = this.read(this.pc); this.pc = (this.pc + 1) & 0xffff;
        this.f = (((this.sp & 0xf) + (e & 0xf)) > 0xf ? H : 0) | (((this.sp & 0xff) + e) > 0xff ? C : 0);
        this.sp = (this.sp + (e < 0x80 ? e : e - 256)) & 0xffff;
        return 12;
      }

      // rotates / misc on A
      case 0x07: { const c = (this.a >> 7) & 1; this.a = ((this.a << 1) | c) & 0xff; this.f = c ? C : 0; return 0; }
      case 0x0f: { const c = this.a & 1; this.a = (this.a >> 1) | (c << 7); this.f = c ? C : 0; return 0; }
      case 0x17: { const c = (this.a >> 7) & 1; this.a = ((this.a << 1) | (this.test(C) ? 1 : 0)) & 0xff; this.f = c ? C : 0; return 0; }
      case 0x1f: { const c = this.a & 1; this.a = (this.a >> 1) | ((this.test(C) ? 1 : 0) << 7); this.f = c ? C : 0; return 0; }
      case 0x27: this.daa(); return 0;
      case 0x2f: this.a = (~this.a) & 0xff; this.f |= N | H; return 0;   // CPL
      case 0x37: this.f = (this.f & (Z | N)) | C; return 0;               // SCF
      case 0x3f: this.f = (this.f & (Z | N)) | ((this.f & C) ? 0 : C); return 0; // CCF

      // control flow
      case 0xc3: this.pc = this.fetch16(); return 12;
      case 0xc2: { const addr = this.fetch16(); if (!this.test(Z)) { this.pc = addr; return 12; } return 8; }
      case 0xca: { const addr = this.fetch16(); if (this.test(Z)) { this.pc = addr; return 12; } return 8; }
      case 0xd2: { const addr = this.fetch16(); if (!this.test(C)) { this.pc = addr; return 12; } return 8; }
      case 0xda: { const addr = this.fetch16(); if (this.test(C)) { this.pc = addr; return 12; } return 8; }
      case 0xe9: this.pc = this.hl; return 0;                             // JP HL
      case 0x18: { const v = this.fetch(); this.pc = (this.pc + (v < 0x80 ? v : v - 256)) & 0xffff; return 8; }
      case 0x20: { const v = this.fetch(); if (!this.test(Z)) { this.pc = (this.pc + (v < 0x80 ? v : v - 256)) & 0xffff; return 8; } return 4; }
      case 0x28: { const v = this.fetch(); if (this.test(Z)) { this.pc = (this.pc + (v < 0x80 ? v : v - 256)) & 0xffff; return 8; } return 4; }
      case 0x30: { const v = this.fetch(); if (!this.test(C)) { this.pc = (this.pc + (v < 0x80 ? v : v - 256)) & 0xffff; return 8; } return 4; }
      case 0x38: { const v = this.fetch(); if (this.test(C)) { this.pc = (this.pc + (v < 0x80 ? v : v - 256)) & 0xffff; return 8; } return 4; }
      case 0xcd: { const addr = this.fetch16(); this.push(this.pc); this.pc = addr; return 20; }
      case 0xc4: { const addr = this.fetch16(); if (!this.test(Z)) { this.push(this.pc); this.pc = addr; return 20; } return 8; }
      case 0xcc: { const addr = this.fetch16(); if (this.test(Z)) { this.push(this.pc); this.pc = addr; return 20; } return 8; }
      case 0xd4: { const addr = this.fetch16(); if (!this.test(C)) { this.push(this.pc); this.pc = addr; return 20; } return 8; }
      case 0xdc: { const addr = this.fetch16(); if (this.test(C)) { this.push(this.pc); this.pc = addr; return 20; } return 8; }
      case 0xc9: this.pc = this.pop(); return 12;
      case 0xc0: if (!this.test(Z)) { this.pc = this.pop(); return 16; } return 4;
      case 0xc8: if (this.test(Z)) { this.pc = this.pop(); return 16; } return 4;
      case 0xd0: if (!this.test(C)) { this.pc = this.pop(); return 16; } return 4;
      case 0xd8: if (this.test(C)) { this.pc = this.pop(); return 16; } return 4;
      case 0xd9: this.pc = this.pop(); this.ime = true; return 12;         // RETI
      case 0xc7: case 0xcf: case 0xd7: case 0xdf: case 0xe7: case 0xef: case 0xf7: case 0xff:
        this.push(this.pc); this.pc = op & 0x38; return 12;                 // RST
      case 0xc5: this.push(this.bc); return 12;
      case 0xd5: this.push(this.de); return 12;
      case 0xe5: this.push(this.hl); return 12;
      case 0xf5: this.push(this.af); return 12;
      case 0xc1: this.bc = this.pop(); return 8;
      case 0xd1: this.de = this.pop(); return 8;
      case 0xe1: this.hl = this.pop(); return 8;
      case 0xf1: { const v = this.pop(); this.a = (v >> 8) & 0xff; this.f = v & 0xf0; return 8; }

      default:
        throw new Error(`undefined opcode 0x${op.toString(16)} at 0x${(this.pc - 1).toString(16)}`);
    }
  }

  alu(kind, v) {
    switch (kind) {
      case 0: this.add8(v); break;
      case 1: this.add8(v, this.test(C) ? 1 : 0); break;
      case 2: this.sub8(v); break;
      case 3: this.sub8(v, this.test(C) ? 1 : 0); break;
      case 4: this.and8(v); break;
      case 5: this.xor8(v); break;
      case 6: this.or8(v); break;
      case 7: this.cp8(v); break;
    }
  }

  daa() {
    let a = this.a;
    if (!this.test(N)) {
      if (this.test(H) || (a & 0x0f) > 9) a += 0x06;
      if (this.test(C) || a > 0x9f) a += 0x60;
    } else {
      if (this.test(H)) a -= 0x06;
      if (this.test(C)) a -= 0x60;
    }
    this.f &= ~(Z | H);
    if (a > 0xff) this.f |= C;
    this.a = a & 0xff;
    if (this.a === 0) this.f |= Z;
  }

  executeCB(op) {
    const r = op & 7;
    const bit = (op >> 3) & 7;
    const extra = r === 6 ? 8 : 0;
    let v = this.r8(r);

    if (op < 0x40) {
      const kind = (op >> 3) & 7;
      let out;
      switch (kind) {
        case 0: { const c = (v >> 7) & 1; out = ((v << 1) | c) & 0xff; this.f = (out === 0 ? Z : 0) | (c ? C : 0); break; }        // RLC
        case 1: { const c = v & 1; out = (v >> 1) | (c << 7); this.f = (out === 0 ? Z : 0) | (c ? C : 0); break; }                 // RRC
        case 2: { const c = (v >> 7) & 1; out = ((v << 1) | (this.test(C) ? 1 : 0)) & 0xff; this.f = (out === 0 ? Z : 0) | (c ? C : 0); break; } // RL
        case 3: { const c = v & 1; out = (v >> 1) | ((this.test(C) ? 1 : 0) << 7); this.f = (out === 0 ? Z : 0) | (c ? C : 0); break; }      // RR
        case 4: { out = (v << 1) & 0xff; this.f = (out === 0 ? Z : 0) | ((v >> 7) ? C : 0); break; }                                 // SLA
        case 5: { out = (v >> 1) | (v & 0x80); this.f = (out === 0 ? Z : 0) | ((v & 1) ? C : 0); break; }                            // SRA
        case 6: { out = ((v & 0x0f) << 4) | ((v >> 4) & 0x0f); this.f = out === 0 ? Z : 0; break; }                                  // SWAP
        default: { out = v >> 1; this.f = (out === 0 ? Z : 0) | ((v & 1) ? C : 0); break; }                                          // SRL
      }
      this.w8(r, out);
      return 4 + extra;
    }
    if (op < 0x80) {                          // BIT b,r
      this.f = (this.f & C) | H | ((v >> bit) & 1 ? 0 : Z);
      return 4 + extra;
    }
    if (op < 0xc0) { this.w8(r, v & ~(1 << bit)); return 4 + extra; }   // RES
    this.w8(r, v | (1 << bit)); return 4 + extra;                        // SET
  }
}
