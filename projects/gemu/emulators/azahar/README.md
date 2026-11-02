# azahar

A child project of **gemu**: our fork of azahar, or the place where that fork will live.

| | |
|---|---|
| upstream | https://github.com/azahar-emu/azahar |
| license | GPL-3.0 |
| pinned tag | `2127.0-alpha4` |
| fork | https://github.com/ayamaiio/azahar (branch `master`) |
| systems | 3DS |
| installed | `C:\Program Files\Azahar\azahar.exe` |

## Status

Forked from upstream at `2127.0-alpha4` (2026-11-01). The fork is
[markfoster314/azahar](https://github.com/ayamaiio/azahar), branch `master`.

Building it is the next step, and it is not free: Azahar is C++/Qt with
submodules, and a release build wants hours and a lot of disk. That is a job for
the build machine, not this repo.

## Organisation

The fork lives in the org: [ayamaiio/azahar](https://github.com/ayamaiio/azahar).
The earlier personal fork (`markfoster314/azahar`) is superseded and can be
deleted from the account whenever.

## Keeping up with upstream

    gh repo sync markfoster314/azahar --source azahar-emu/azahar --branch master

Sync, then re-pin: set `upstream.tag` to the release you actually built against and
`fork.forkedAt` with it. The page reads both, so the record cannot drift from the
branch.

## Patches

Diffs we carry live in `patches/`, named `<issue>.<what>.patch`, applied in order.

**GPL-3.0**: a fork that is distributed must keep its source available — the fork link above is that obligation, not paperwork.
