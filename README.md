# ayamai

A local-first AI agent platform. It installs on a machine you own, opens one door
at **http://ayamai.local**, holds the model keys, and gives every tool — a
browser extension, an editor extension, an agent — a single local API for getting
things done. No account, no cloud, no telemetry.

Private and invite-only. Source becomes public at release under
[FSL-1.1-MIT](LICENSE.md): read it, run it, change it, share it — just don't turn
it into a competing service. Two years after each release it becomes MIT.

## Start

```bash
./scripts/install.sh        # or scripts\install.ps1 on Windows
ayamai up                   # the door and its projects
ayamai doctor               # node, docker, manifests, the name, port 80, origin
```

Then open **http://ayamai.local**. The welcome page leads into gehirn.

## What is in here

The platform (`packages/`) and the eight products it runs (`projects/`). The
platform is the door, the agent, the model client and the CLI; a product is a
manifest, a directory and a route.

| | | |
|---|---|---|
| **gehirn** ゲヒルン | the control panel | `/gehirn` — projects, services, actions, the model console |
| **yoru** 夜 | the media library | `/yoru` — the first project that ran on the platform |
| **seiri** 整理 | the board | `/seiri` — plans, repositories, ideas in, work out |
| **kata** 型 | the design library | `/kata` — tokens, components, the editor that writes them |
| **hisho** 秘書 | the agent harness | `/hisho` — a brief, a claim, a record |
| **gemu** ゲーム | everything playable | `/gemu` — emulators, ROMs, Steam; the eight emulators are child projects |
| **tsukai** 使い | the browser extension | `/tsukai` — make a page, keep the good part |
| **fude** 筆 | the editor extension | `/fude` — write where the work already lives |

## Layout

| path | what |
|---|---|
| `packages/` | the platform: `core`, `gateway`, `gehirn`, `agent`, `llm`, `cli` |
| `projects/` | the products; each has a `project.json` manifest |
| `ui/` | the design kit: tokens, the surface stylesheet, the logo (`ui/brand/`) |
| `site/` | the public page at ayamai.io, deployed to Cloudflare Pages |
| `scripts/` | install, run, publish, deploy, and the shell of the platform |
| `docs/` | the documentation; media-era material is archived in `docs/archive/` |
| `catalog.json` | which projects are ours: names, kinds, paths, owners |
| `extensions/browser-capture/` | the protocol yoru's capture runs on — media-era, still in use |
| `infrastructure/shared-media-edge/` | the media edge worker and its canaries — media-era, still in use |
| `apps/magi/` | storybook, where components are developed (`pnpm magi`) |

## Working on it

```bash
pnpm install
pnpm test          # every suite; `pnpm test products` runs one group
pnpm typecheck
pnpm check:docs    # no dead links
```

Work goes to the local mirror (`git push box packaged`). The org repository is
release-only: `ayamai publish` squashes the tree into one commit and cuts a
release. A pre-push hook refuses anything else. See
[docs/OPERATIONS.md](docs/OPERATIONS.md).

## Documentation

The full map is [docs/README.md](docs/README.md). Start with
[docs/PRODUCT.md](docs/PRODUCT.md) — what this is and who it is for.
Then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit, and
[docs/OPERATIONS.md](docs/OPERATIONS.md) for running, releasing and deploying.
Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Agents start at
[AGENTS.md](AGENTS.md). Design language: [DESIGN.md](DESIGN.md). History:
[docs/archive/](docs/archive/README.md).
