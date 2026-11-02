# Operations

How to install it, run it, and what to do when it will not. Product is [PRODUCT.md](PRODUCT.md); internals are [ARCHITECTURE.md](ARCHITECTURE.md).

## Install

```sh
# a checkout
./scripts/install.sh              # unix
powershell -ExecutionPolicy Bypass -File scripts\install.ps1    # windows

# a release
curl -fsSL https://github.com/ayamaiio/ayamai/releases/latest/download/install.sh | sh
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

## The command

```
ayamai status [--json]     what is running, what is not
ayamai doctor              node, pnpm, docker, data dir, manifests, name, port 80, origin
ayamai up [project]        start the door and registered services
ayamai down [project]
ayamai open                open the door
ayamai projects            the catalog: ayamai, gehirn, yoru
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
| `box` | the local bare mirror | work goes here; push freely |
| `origin` | `github.com/ayamaiio/ayamai` | releases only — `ayamai publish` |
| `github-old` | `github.com/markfoster314/ayamai` | frozen, kept for history |

`ayamai publish` is the only door to `origin`:

```bash
node scripts/publish.mjs --dry-run   # what would go out
node scripts/publish.mjs             # type the release name to confirm
```

It refuses a dirty tree, shows the commits and file count since the last release,
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

## The domain

`ayamai.io` moves from Replit to Cloudflare. The repo does not depend on this;
it is a ten-minute checklist for the person with the accounts:

1. Cloudflare → Add site → `ayamai.io` (free plan).
2. At the registrar, replace the nameservers with the two Cloudflare gives.
3. Records: `ayamai.io` → the Pages project; `www` → 301 to apex; delete anything
   pointing at Replit.
4. Pages → connect `ayamaiio/ayamai.io` (a small static repo: the landing
   composition and `ui/tokens.css`), deploy from `main`.
5. Replit → delete the app; keep the domain registration where it is.

## Development loop

```bash
python3 scripts/local-dev.py start        # api + web (+ magi, curator) with the workspace env
python3 scripts/local-dev.py status
python3 scripts/local-dev.py logs --lines 50
node --test packages/*/*.test.mjs         # the platform's own suite
node scripts/check-docs.mjs               # no dead links in the docs
```

Node must be the nvm one (`~/.nvm/versions/node/v24.11.0/bin`); the system node here is v18 and the installer refuses it.
