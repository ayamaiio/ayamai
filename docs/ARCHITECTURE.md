# Architecture

How the pieces fit. Product context is [PRODUCT.md](PRODUCT.md); running it is [OPERATIONS.md](OPERATIONS.md).

## The shape

```
browser ──► http://ayamai.local  ──► gateway (the door)
                                     ├── /            welcome page
                                     ├── /ui/         the design kit: brand, stylesheets, icons
                                     ├── /gehirn      gehirn, the control panel
                                     ├── /agent       the task API tools talk to
                                     ├── /yoru        yoru's app     ┐
                                     ├── /api         yoru's API     │
                                     ├── /seiri /kata /hisho         ├ from projects/<id>/project.json
                                     ├── /gemu /tsukai /fude         ┘
                                     ├── /curator /storybook         (media-era, still mounted)
                                     └── /healthz
```

Old addresses (`/board`, `/arcade`, `/gb`, `/app`, `/cockpit`) 308 to their new
home; they are redirects, not routes.

The door is a **router, not a rewriter**: it matches the longest prefix and pipes the request through untouched. Each surface is started knowing the prefix it lives under (`BASE_PATH=/yoru`, `BASE_PREFIX=/board`), so no HTML is rewritten in flight.

## Packages

| package | role | entry |
|---|---|---|
| `@ayamai/core` | registry, catalog, origin, data directory — the facts everything shares | `packages/core/*.mjs` |
| `@ayamai/gateway` | the one door: path routing, websockets, health, the welcome page | `packages/gateway/index.mjs` |
| `@ayamai/gehirn` | the control panel: projects, services, actions, model console, docs and code viewers | `packages/gehirn/entry.mjs` |
| `@ayamai/agent` | `/agent/task`: named intents, token-gated | `packages/agent/index.mjs` |
| `@ayamai/llm` | providers, key store, one request, no SDK | `packages/llm/index.mjs` |
| `@ayamai/cli` | `ayamai status · doctor · up · down · open · projects · hisho · publish · version` | `packages/cli/index.mjs` |

`scripts/gehirn.mjs` and `scripts/gateway.mjs` are shims so the familiar commands keep working.

## Projects on the platform

Every project below belongs to the **ayamai** organization, owned by **ikari**.

| project | route | port | what |
|---|---|---|---|
| yoru | `/yoru` | 25322 + 8081 | the media library |
| seiri | `/seiri` | 4460 | the work in order: plans, repos, uncommitted files |
| kata | `/kata` | 4600 | the design library: tokens, components, the editor |
| hisho | `/hisho` | 4650 | the agent harness: briefs, claims, MCP |
| tsukai | `/tsukai` | 4655 | the browser extension, and how to load it |
| fude | `/fude` | 4656 | the editor extension, and how to run it |
| gemu | `/gemu` | 4660 | everything playable: emulators, ROMs, Steam, Epic, GOG, itch |

Each is a manifest in `projects/<id>/project.json`; the gateway builds its route table from them, so adding one needs no gateway change.

## Manifests and the registry

`projects/yoru/project.json` (`$schema: ayamai/project@1`) declares routes and services. `packages/core/registry.mjs` validates it — slug ids, reserved prefixes (`/`, `/gehirn`, `/agent`, `/healthz`), no service on the door's port — and returns invalid manifests separately, so one broken project cannot take the machine down.

The gateway's route table is `platform routes + projectRoutes(registry.projects)`. Adding a project is writing a manifest; no gateway change.

## The catalog

`catalog.json` (`$schema: ayamai/catalog@2`) defines three layers: **people**,
**organizations** and **projects**. An organization names its `owner` (a person);
an entry names its `org`. The loader refuses an entry pointing at a missing
organization and an organization pointing at a missing person, so the model cannot
drift into dangling references. A `@1` file still loads — entries simply have no
organization.

`catalog.json` (`$schema: ayamai/catalog@1`) lists the projects we build, with paths, docs and links. `packages/core/catalog.mjs` validates and resolves them into what gehirn renders and `ayamai projects` prints. Docs may be relative to the entry's path or repo-relative when they start with `docs/`.

Health is joined at render time: an entry with a `registryProject` borrows the liveness of that project's services.

## The agent API

```
GET  /agent/capabilities      what can be asked for
GET  /agent/context           a compact machine brief
POST /agent/task              { intent, input } → { id, status, result }
GET  /agent/task/:id
```

Intents are names, not free text: `llm.prompt`, `project.status`, `page.capture`. Every call carries `x-ayamai-token`, generated on first run at `{data}/agent-token` (0600). The agent holds the model key; the tools never do. `projects/tsukai` and `projects/fude` are the shipped clients.

## State: where things live

| what | where |
|---|---|
| data root | `%APPDATA%\ayamai` · `~/Library/Application Support/ayamai` · `$XDG_DATA_HOME/ayamai` (override `AYAMAI_DATA`) |
| model keys | `{data}/llm.json`, mode 0600, never read by a page |
| agent token | `{data}/agent-token` |
| page captures | `{data}/captures/*.json` |
| catalog / manifests | `catalog.json`, `projects/*/project.json` |
| vault (yoru) | `/mnt/y/ayamai`, its own disk |
| logs | `.local/*.log` per service |

## Authentication and guards

The platform is loopback-first. There are three separate guards and none of them is decoration:

1. **The door's origin rule** — the API answers `http://ayamai.local`, any `*.localhost`, and the loopback pair, derived in `packages/core/origin.mjs`. Local-founder sessions are refused from anything else.
2. **The panel's action guard** — a `POST` to gehirn's action routes must carry `x-cockpit: 1` *and* an allowed origin. The header name is historical; it is a protocol, not a brand.
3. **The agent token** — `x-ayamai-token`, compared in constant time, required for every `/agent` call.

Process-launching routes (open editor / reveal) sit behind the action guard, because they run programs on the machine.

## Ports

| public | path | internal |
|---|---|---|
| 25222 (or 80 via `ayamai.local`) | `/` welcome | — |
| | `/gehirn` | 4490 |
| | `/agent` | 4491 |
| | `/api` | 8081 |
| | `/yoru` | 25322 |
| | `/board` `/arcade` `/gb` | 4460 / 4470 / 4480 |
| | `/curator` | 4319 |
| | `/storybook` | 6006 (302: it insists on a root path) |
| — | postgres | 5434 |
| — | pixiv agent (Windows) | 8099 |
| — | LAN door for the phone | 25223 → 25222 |

## Two states

A product may have two faces: **develop** (information first) and **play**
(content first). `packages/core/view.mjs` is the convention:

- `?view=play` in the URL wins for that visit;
- otherwise the browser remembers the last choice per project (`localStorage`,
  key `ayamai.view.<id>`);
- `develop` is the default and never appears in a URL, so `/gemu` is always the
  canonical developer page.

gemu is the first product with both. yoru keeps its own feed until it adopts the
convention.

## Releases, not deployments

Versions are calendar dates (`2026.11.02`), one shared number, stamped by
`ayamai version`. `site/` holds the public page, deployed by
`scripts/deploy-site.mjs`.

There is no hosted production. The machine is the product; a release is a
squashed snapshot pushed to `ayamaiio/ayamai` by `ayamai publish` and published
as a GitHub release. The Lightsail deployment and its Clerk keys are retired.

## The logo

One logo, one wordmark. `ui/brand/mark.png` is the art, `ui/brand.css` is its
type, `ui/brand.mjs` renders the markup — and the door serves all of it at
`/ui/...` so no two pages can drift. The public page keeps its own copy under
`site/brand/`, placed there by the deploy.

## Choices worth knowing about

- **Prefixes, not subdomains.** Subdomains would dodge the path work but split cookies and origins, which the founder guard would then have to learn about.
- **The panel is its own process.** A proxy fault cannot take the panel down with it.
- **Storybook gets a redirect, not a lie.** It cannot be mounted under a prefix, so `/storybook` 302s to its port.
- **The agent runs on Windows.** WSL cannot reach a Windows loopback port, so gehirn talks to it through `curl.exe`. Do not "fix" that back to `fetch`.


## Modes, faces, views

Three words, three scopes. Getting them mixed up is how "play" came to mean three
different things at once.

| word | scope | where it lives | who reads it |
|---|---|---|---|
| **mode** — `play` \| `dev` | the machine | `{data}/state/mode.json` | the door, gehirn, every product |
| **face** — a URL per mode | the product, declared | `project.json` → `faces` | the door's shelf, gehirn's cards |
| **view** — presentation inside a face | the surface | a URL param and `localStorage` | the product itself |

- a product that declares a **play face** is a play product: that declaration is
  what puts it on `/play/`, not a list somewhere in the platform;
- the mode chooses each product's face. gemu's own toggle is a **view** — the mode
  seeds it, a person may override it, and a reset returns it to following the mode;
- **`/play/` is a surface, not a page in the door**: `packages/play` is a
  service like any other, listed in the catalog and routed by the door. It holds
  no product list — it asks the registry for whoever declared a play face and
  probes their ports for the dots;
- yoru's `?play=1` is its **consume view**, and it is the face yoru declares for
  play mode. The parameter keeps its old name because links exist; the code does
  not.
