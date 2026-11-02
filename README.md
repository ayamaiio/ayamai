# ayamai

A local-first agent platform. It installs on a machine, opens one door at
**http://ayamai.local**, holds your model keys, and gives tools — a browser
extension, an editor extension, one day our own browser — a single local API for
getting a model to do something on this computer.

Three projects:

| | | |
|---|---|---|
| **ayamai** | the ecosystem | one door, the agent, the tools, the install |
| **gehirn** ゲヒルン | the control panel | `/gehirn`: projects, services, actions, the model console |
| **yoru** 夜 | the first project | the media library, mounted at `/yoru` |

## Start

```bash
./scripts/install.sh            # or scripts\install.ps1 on Windows
ayamai up                       # the door and its projects
ayamai doctor                   # node, docker, manifests, name, port 80, origin
```

Then open **http://ayamai.local**. The welcome page leads into gehirn.

## Layout

| path | what |
|---|---|
| `packages/` | the platform: `core`, `gateway`, `gehirn`, `agent`, `llm`, `cli` |
| `tools/` | browser and VS Code extensions |
| `projects/yoru/` | the first project: app, api, db, curator, design system |
| `toys/` | board, arcade, game boy, plan — allowed to break |
| `catalog.json` | the projects we build |
| `docs/` | the documentation |

## Documentation

Start with [docs/PRODUCT.md](docs/PRODUCT.md) — what we are building.
Then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/OPERATIONS.md](docs/OPERATIONS.md). Agents read [AGENTS.md](AGENTS.md)
first. Design language: [DESIGN.md](DESIGN.md). History lives in
[docs/archive/](docs/archive/README.md).
