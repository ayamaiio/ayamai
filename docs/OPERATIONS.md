# Operations

How to install it, run it, and what to do when it will not. Product is [PRODUCT.md](PRODUCT.md); internals are [ARCHITECTURE.md](ARCHITECTURE.md).

## Install

```sh
# a checkout
./scripts/install.sh              # unix
powershell -ExecutionPolicy Bypass -File scripts\install.ps1    # windows

# a release (the repository is private: the plain releases URL needs a token,
# so fetch the asset with gh — the installer itself is the same)
gh release download --repo ayamaiio/ayamai --pattern install.sh --dir /tmp/ayamai
sh /tmp/ayamai/install.sh
```

The installer verifies node ≥ 20 and pnpm, installs the workspace, then hands over to `ayamai doctor`. `--check` verifies without installing.

The privileged part — one prompt — writes the hosts entry and grants port 80 so that `ayamai.local` needs no port:

- **Windows / WSL**: writes `127.0.0.1 ayamai.local` into the Windows hosts file and adds `netsh portproxy 80 → 127.0.0.1:25222`.
- **Linux**: the systemd user unit gets `CAP_NET_BIND_SERVICE`.
- **macOS**: a launchd daemon runs the door on 80.

**macOS** is the same shape but with launchd instead of a port-forwarding sysctl:

- `local.ayamai.door` — a **LaunchDaemon** running `scripts/forward.mjs 80 25222` as root, at boot, before anyone logs in.
- `local.ayamai.platform` — a **LaunchAgent** running `scripts/platform-up.mjs`, which supervises gateway, gehirn, seiri and kata for your user and restarts whichever dies.

`ayamai install --print-actions` prints all five steps (hosts, daemon, daemon load, agent, agent load) before anything runs. `ayamai uninstall` removes both jobs and the hosts line. `ayamai doctor` reports whether the daemon is loaded.

If you decline, everything still works at `http://ayamai.local:25222` and `doctor` says why.

## First ten minutes

```sh
./scripts/install.sh        # node, pnpm, the workspace, the hosts entry
ayamai doctor               # every check, named, with the fix where there is one
ayamai up                   # the door and the services that are configured
```

Then open **http://ayamai.local/**. The welcome page leads into gehirn, which is
where you watch and operate the machine:

1. **gehirn** (`/gehirn/`) — the platform view: this machine, its services, the
   projects beneath. Click a project to make it the page you are looking at; its
   children expand in place.
2. **the model console** at the bottom of gehirn — paste a key once, and it is
   stored at `{data}/llm.json` with mode 0600. Nothing else in the platform needs
   a key of its own.
3. **`/gemu/?view=play`** — a product with two states, in case you want to see
   what "information first, content first" means in practice.
4. **`/seiri/`** — the board: what is planned, what is dirty, what to do next.

Before you change anything, read [CONTRIBUTING.md](../CONTRIBUTING.md): work goes
to the local mirror, and publishing needs a human.

## When a service is down

The door answers a dead upstream with a 502 page that names the service, the port,
the error and the command that starts it — and a **start it** button. The button
posts to `/_door/start`, which runs the route's own start command and nothing else:

- **loopback only** — a request from anywhere but `127.0.0.1`/`::1` is refused;
- **the page's header only** — `x-door: 1` must be present, so a cross-site post cannot
  run anything;
- **the route's command, never the caller's** — the body names a route
  (`{"name":"hisho:app"}`), which is looked up in the route table; an unknown name is
  a 400 and the door itself can never be started this way.

Project routes carry their start spec from the manifest (`services[].start`), env
included, so a service started from the button is configured exactly as the manifest
says. After starting, the page polls `/_door/ping` and lands on the service when it
answers.

## A service is its process

Editing a file changes nothing until the process running it restarts. `ayamai
doctor` reports **code freshness**: for every service that is up, it compares the
process start time with the modification time of the files that service serves, and
fails when the process is older. gehirn shows the same fact as a `stale` badge on
the service's row.

Restart with `ayamai down <id>` then `ayamai up <id>`, or the run command the row
prints. The comparison lives in `packages/core/process.mjs` (`isStale`), so the
panel and the doctor cannot disagree.

## The command

```
ayamai status [--json]     what is running, what is not
ayamai doctor              node, pnpm, docker, data dir, manifests, name, port 80, origin
ayamai up [project]        start the door and registered services
ayamai down [project]
ayamai open                open the door
ayamai projects            the catalog: three layers of people, orgs, entries
ayamai hisho [--stdio]     the agent harness (MCP)
ayamai version [--bump]    the dated version, written into every manifest
ayamai publish [--dry-run] [--yes] [--site]   the release gate
ayamai install | uninstall [--print-actions] [--no-hostname]
```

Run it as `pnpm ayamai <command>` or `node packages/cli/index.mjs <command>`.

## What you see

```
http://ayamai.local/           the welcome page — one button into gehirn
http://ayamai.local/gehirn/    the panel: projects, services, actions, the model console
http://ayamai.local/yoru/      the media project
http://ayamai.local/seiri/     the board: plans, repos, uncommitted files
http://ayamai.local/kata/      the design library
http://ayamai.local/hisho/     the agent harness — connect MCP clients here
http://ayamai.local/tsukai/    the browser extension: load it unpacked from here
http://ayamai.local/fude/      the editor extension: run it from here
http://ayamai.local/gemu/      everything playable, with a launch button
```

Gehirn shows one block per project with its path, docs, a code browser, and buttons that open VS Code or Explorer at the right place. Every service row has `open`, `run`/`stop`, and — for the pixiv agent — `sweep`.

## The phone

`http://<pc-lan-ip>:25223/` forwards to the same door with the origin rewritten. The URL is printed in gehirn's footer and by `ayamai doctor`.

## Troubleshooting

Everything here actually happened on this machine.

| symptom | cause | fix |
|---|---|---|
| `local-dev.py` dies with a docker error | Docker Desktop is not running | start Docker Desktop, then retry |
| `Port 5434 occupied` / container won't start | WSL's own Postgres holds 5434 | `wsl -u root pg_ctlcluster 16 main stop`, then start the container |
| The panel shows the agent as down | gehirn runs in WSL; the agent listens on Windows | it calls `curl.exe`; check `curl.exe -s http://127.0.0.1:8099/status` from WSL |
| Agent won't start: "profile has been closed" | Brave holds the profile | close Brave; the agent's window is your browser while it runs |
| A page loads unstyled | an asset path is relative and resolved one directory too deep | assets are absolute (`/gehirn/…`); check the served HTML |
| `vscode` button does nothing | the `vscode://` handler opens no window on this machine | the button runs the VS Code CLI with `--folder-uri`; if it fails it reports the error |
| Vite answers 403 for `/yoru/` | it refuses unknown `Host` headers | `allowedHosts` derives from `AYAMAI_PUBLIC_ORIGIN` |
| A button loops back to the page you came from | a legacy redirect still points at the old root | check `REDIRECTS` / `MOVED_PREFIXES` in the gateway |
| `ECONNREFUSED 127.0.0.1:8080` | Vite started without `API_PROXY_TARGET` | set it to `http://127.0.0.1:8081` |
| API edits have no effect | the API runs the built bundle | rebuild, then restart, then poll `/api/healthz` |

## Diagnostics

```bash
curl -s localhost:25222/healthz          # every upstream, up or down
bash scripts/smoke-frontdoor.sh          # every path, with expected codes
curl -s localhost:25222/gehirn/api/catalog
ayamai doctor                            # the whole promise, one screen
```

Logs live in `.local/` per service (`api.log`, `web.log`, `gehirn.log`, `curator.log`) and each service also writes to the ACTIONS panel.

## Ownership and releases

The project belongs to the **ayamaiio** organization, owned by the ikari account.
GitHub is cold storage: it receives **one squashed commit per release**, never the
working history.

| remote | where | rule |
|---|---|---|
| `box` | the local bare mirror (`/mnt/y/git/ayamai.git`) | work goes here; push freely |
| `work` | `github.com/markfoster314/ayamai-work` (private) | the same branch on other machines; `git push work packaged` |
| `origin` | `github.com/ayamaiio/ayamai` | releases only — `ayamai publish` |
| `github-old` | `github.com/markfoster314/ayamai` | frozen, kept for history |

## The vault's folders

`/mnt/y/ayamai` holds `media/` (yoru's images and video), `music/` (uta's audio), `system/` (TempleOS.ISO, and whatever else needs a machine), `itch/` (games and the zip inbox),
`state/` (indices and caches), `backups/` and `harvest/`. Each product owns its
folder and scans nothing else; `AYAMAI_VAULT` moves the root, and `UTA_LIBRARY`
moves uta's folder on its own.

## Machines

Every environment has a manifest in `machines/<id>.json` — its OS, its role, and the
notes that only apply there. `ayamai bootstrap <id>` renders two files from it:

| file | for |
|---|---|
| `machines/<id>.command` / `.sh` / `.ps1` | running on that machine — extension follows the OS, and the `.command` is double-clickable in Finder |
| `machines/<id>.txt` | reading and pasting, with the notes |

Both are **generated and committed**. Do not edit them: change the manifest and run
`ayamai bootstrap <id>` again. A test fails when a committed file no longer matches
its render, so a stale script cannot be merged.

The script refuses the wrong OS, checks node ≥ 20.11 and pnpm, installs the
workspace only when it is missing or stale, does the privileged name step only
when the manifest says `sudo: true` (skipped entirely with `sudo: false`), starts
the platform, and ends on `ayamai doctor`. Running it twice reads as "already done".

`ayamai handoff [<id>]` answers the other half: what the machine you are *not*
sitting at needs. It reads the local history to see how long ago the files that
shape a bootstrap changed, and says whether the other machine needs the script or
only a pull and a restart. It never claims to know what that machine has actually
pulled.

## The second machine

`work` is a private repository that exists only so another machine can hold the
same `packaged` branch. It is not a release and carries no promise: the Mac fetches
from it, and nothing publishes from it.

On this machine, after committing:

```bash
git push work packaged
```

On the Mac, holding an existing copy:

```bash
git fetch work
git checkout -B packaged work/packaged
```

The Mac's history and `origin`'s history are unrelated — `origin` holds one
squashed commit per release, `work` holds the real history. Never merge the two;
`packaged` is the branch that exists on both machines, and `origin` is written to
only by `ayamai publish`.

`ayamai publish` is the only door to `origin`:

```bash
node scripts/publish.mjs --dry-run   # what would go out
node scripts/publish.mjs             # type the release name to confirm
```

The repository is **private**, so GitHub's plain `releases/latest/download` URL
answers 404 without credentials; the API asset endpoint works with a token
(`gh release download`). Flipping the repo to public makes the one-line install
work as written — and exposes only release snapshots, never the working history.

It refuses a dirty tree, derives the version from the tag it is about to cut and
stamps it into every manifest (so the release and the version cannot drift), shows the
commits and file count since the last release,
squashes the tree into one parentless commit, force-with-lease pushes it to
`main`, tags it `release/YYYY.MM.DD-N`, and cuts a GitHub release. Every publish
is appended to `{data}/publish.jsonl`.

A pre-push hook refuses any other push to an `ayamaiio` remote:

```bash
node scripts/install-hooks.mjs      # once per checkout
```

## Dated versions

Every project carries the same calendar version, `YYYY.MM.DD` (UTC) — they ship as
one snapshot, so they share one number.

```bash
ayamai version            # what is out there, and where it disagrees
ayamai version --bump     # today, or today.N if the day is taken
```

The stamper writes `catalog.json` and every `projects/**/project.json`; nothing
else should ever edit a version by hand. `ayamai publish` refuses a tree whose
versions disagree.

## Changing the logo

- the image: `ui/brand/mark.png` (and the favicons beside it);
- the type: `ui/brand.css`;
- the markup: `ui/brand.mjs` — `brand({ tool, jp })`.

Every surface references `/ui/brand.css` and `/ui/brand/mark.png` through the
door, so a change lands everywhere after a restart. The public page is the one
exception: `scripts/deploy-site.mjs` copies the files into `site/brand/` at
deploy time.

## The public page

`site/` is the page at ayamai.io — one static HTML file, no JavaScript, no
analytics. It is deployed to Cloudflare Pages, project `ayamai-io`:

```bash
node scripts/deploy-site.mjs --dry-run   # files, version, target
node scripts/deploy-site.mjs             # upload
node scripts/publish.mjs --site          # release, then deploy the page
```

Credentials go in `.local/cloudflare.env` (gitignored, `0600`), never in the
repo and never pasted into a chat — the file is opened in the editor and filled
by hand:

```
CLOUDFLARE_API_TOKEN=...    # Account → Cloudflare Pages → Edit
CLOUDFLARE_ACCOUNT_ID=...
```

Changing any of the pacing below is [art mode](ART-MODE.md) work: the schedule
lives in one block at the top of `site/index.html`, and the preview switches are
in `scripts/site-preview.mjs`.

The page is one section — header, the statement with its one button, footer — and
it opens on two overlays before it appears. First the brand: `AYAMAI` alone in
the middle of the screen, then the mark and `アヤマイ` together — the mark above,
the kana below in the soft blue — each fading over a second and a half. It
holds, then the whole composition dissolves slowly into black, and after a beat
of nothing the Terry Davis line rises. The
attribution comes in two beats — `Terry A. Davis`, a pause, then `creator of
TempleOS` — and then both leave. The black
backdrop that held both overlays then clears, about fourteen seconds in: the
header and the footer are simply there, and only the section assembles itself — `A`, then `local-first`
typed a letter at a time behind a caret, then `AI agent platform.`, then the
slogan row, the red slash drawing itself, the stance line, and the button, each
a little quicker than the last. Every beat is an offset from `--intro-end` in
the stylesheet, so re-timing the opening moves the whole schedule with it. The
page takes about twenty-six seconds end to end, deliberately. It is CSS only, no JavaScript, and
`prefers-reduced-motion: reduce` skips all of it: both overlays are removed and
the page is visible immediately.

The footer version is stamped from `catalog.json` at deploy time, so the page
cannot claim a release that does not exist. Until the domain moves it lives at
`https://ayamai-io.pages.dev`.

## The domain

**State on 2026-11-02, verified from this machine:**

| host | what answers | why |
|---|---|---|
| `www.ayamai.io` | the new page, via Cloudflare (200) | `www` is delegated to its own Cloudflare zone (`norah`/`houston.ns.cloudflare.com`), CNAME → `ayamai-io.pages.dev`; the Pages domain reads **active** |
| `ayamai.io` | the old Replit page, "By invitation", `34.111.179.208` | the apex is still on name.com's nameservers, so the Cloudflare zone `9f0c1126858938f18cd6e23686fba0b5` stays **pending** and the apex Pages domain stays **pending** |

The whole gap is one DNS change at the registrar, and nobody with panel access has
made it yet.

**The step (registrar → DNS → nameservers, for `ayamai.io`):**

| replace | with |
|---|---|
| `ns1cny.name.com` | `galilea.ns.cloudflare.com` |
| `ns2ckr.name.com` | `sid.ns.cloudflare.com` |
| `ns3jkl.name.com` | |
| `ns4hny.name.com` | |

Propagation is minutes, up to a day. Confirm with
`node -e 'require("dns").resolveNs("ayamai.io",console.log)'` (expect the two
Cloudflare names) and then `curl -I https://ayamai.io` — the Replit page
disappears on its own once the zone is live, because the proxied apex `CNAME` to
`ayamai-io.pages.dev` is already in place.

**If the panel only lets you edit records, not nameservers** — which is the case
when the domain is held in a reseller account — the two alternatives are, in
order: a **URL forward** at the registrar, `ayamai.io` → `https://www.ayamai.io`
(one click, no propagation), or a support request asking the holder to delegate
the nameservers to the two Cloudflare hosts above.

**After the apex works**, the flip is one command:

```bash
node scripts/site-host.mjs apex      # canonical, og:url, og:image, sitemap, robots
node scripts/deploy-site.mjs         # refuses unless that host serves this page
```

`deploy-site.mjs` fetches the canonical host before uploading and stops if it does
not return this page — because the apex currently answers with the old Replit site,
and a canonical pointing there is worse than none. `--force` overrides it.

The `www` → apex redirect is **not** a `_redirects` file: Pages only rewrites paths,
not hosts. Once the apex zone is live, it is a Redirect Rule in the zero-`ayamai.io`
Cloudflare zone (`www.ayamai.io/*` → `https://ayamai.io/:splat`, 301). The separate
`www` zone that exists today belongs to another account — only `ayamai.io` is on this
one — so that rule cannot be created from here until the delegation is gone.

### What the site ships

`site/` builds to five files plus four brand assets: `index.html`, `img/card.jpg`,
`robots.txt`, `sitemap.xml` and `404.html`. The 404 matters more than it looks —
before it existed, Pages answered every unknown path with the landing page and a
200, which is a duplicate page in every crawler's eyes. `_redirects` is absent on
purpose: there is no client-side routing, so nothing needs a fallback.

## Development loop

```bash
python3 scripts/local-dev.py start        # api + web (+ magi, curator) with the workspace env
python3 scripts/local-dev.py status
python3 scripts/local-dev.py logs --lines 50
node --test packages/*/*.test.mjs         # the platform's own suite
node scripts/check-docs.mjs               # no dead links in the docs
```

Node must be the nvm one (`~/.nvm/versions/node/v24.11.0/bin`); the system node here is v18 and the installer refuses it.

## Two kinds of old

`packages/core/staleness.mjs` is the only place that decides what "old" means, so
one screen cannot say two different things:

| word | means | what to do |
|---|---|---|
| **stale** | a running process started before the code it serves | restart it |
| **neglected** | a project has not been touched in 14 days | look at it, or retire it |

The panel shows both, the doctor checks both (`code freshness`, `attention`), and
neither is inferred twice.
