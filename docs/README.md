# Documentation

The map. Every page here describes what the project does now; anything that
describes a retired product is under [archive/](archive/README.md) and says so.

## Start here

| | |
|---|---|
| [PRODUCT.md](PRODUCT.md) | what ayamai is, who it is for, the principle behind it |
| [ARCHITECTURE.md](ARCHITECTURE.md) | the door, the packages, the manifests, the catalog |
| [OPERATIONS.md](OPERATIONS.md) | install, run, diagnose, release, deploy the public page |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | how to work in this repository |
| [../AGENTS.md](../AGENTS.md) | the operating policy every agent follows |

## The products

| | |
|---|---|
| [projects/platform.md](projects/platform.md) | the platform itself: the door, the agent, the model, the CLI, releases |
| [projects/gehirn.md](projects/gehirn.md) | the control panel, and its two levels |
| [projects/yoru.md](projects/yoru.md) | the media library — the first product |
| [projects/seiri.md](projects/seiri.md) | the board: plans, repositories, ideas |
| [projects/kata.md](projects/kata.md) | the design library and the token source |
| [projects/hisho.md](projects/hisho.md) | the agent harness (MCP) |
| [projects/gemu.md](projects/gemu.md) | everything playable: emulators, ROMs, Steam |
| [projects/tsukai.md](projects/tsukai.md) | the browser extension |
| [projects/fude.md](projects/fude.md) | the editor extension |

## Decisions and history

| | |
|---|---|
| [philosophy/WHY-WE-BUILD.md](philosophy/WHY-WE-BUILD.md) | why this exists, and the simplicity rule |
| [ART-MODE.md](ART-MODE.md) | how we work when the surface is the point: taste, pacing, evidence |
| [design/](design/) | design records; the media-era ones carry a historical banner |
| [archive/README.md](archive/README.md) | the media era, kept for reference and not maintained |
| [../LICENSE.md](../LICENSE.md) | FSL-1.1-MIT: source-available, MIT after two years |

## Keeping it honest

`pnpm check:docs` fails on a dead link; `node --test docs/*.test.mjs` fails when a
registered project has no page, when a page stops naming its route, or when the
README stops listing a product. If you change behaviour, change the page that
describes it in the same commit.
