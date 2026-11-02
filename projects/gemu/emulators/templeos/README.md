# templeos

TempleOS 5.03, booted from its ISO on this machine.

Not a fork. TempleOS is finished: Terry A. Davis wrote it alone, in HolyC, and it
is in the public domain. Three things are worth keeping separate:

- **the system**: TempleOS 5.03, the ISO in `{vault}/system/TempleOS.ISO`;
- **the machine**: QEMU, GPL-2.0, installed on Windows;
- **the forks**: [ZealOS](https://github.com/Zeal-Operating-System/ZealOS) is the
  fork still maintained, and Shrine is a separate C++ interpretation in the same
  spirit. Neither is here; choosing whether to fork ZealOS is a filed follow-up,
  because a fork is a commitment to a toolchain, not a page.

## Why not the browser

The first attempt was [v86](https://github.com/copy/v86), the x86 emulator in wasm:
~3 MB, BSD-2, no install. It boots as far as SeaBIOS and then stops with

    TempleOS requires a 64-bit capable processor.

v86 is 32-bit only — [copy/v86#133](https://github.com/copy/v86/issues/133) has been
open since 2017 — and TempleOS runs in long mode. So the machine has to be real.
QEMU is the smallest honest answer.

## Running it

```
winget install SoftwareFreedomConservancy.QEMU     # once
open http://ayamai.local/gemu/system/templeos/            # press launch
```

The window opens outside the browser; that is what makes it a machine rather than
a picture of one. Verified: the live CD reaches its own prompt and asks whether to
install onto a hard drive.

If a browser runtime ever becomes viable, JSLinux is the one that already does
x86_64 — [TempleOS Playground](https://ring0.holyc.xyz/) is built on it.
