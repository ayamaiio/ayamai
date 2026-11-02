# Unified local development

Authorized 2026-10-31. Keep the existing pnpm monorepo and directories.
Intake is the API's existing import worker, capture, annotation and export
routes. There is no independent worker to launch. Curator/PAT work is excluded.

## Quickstart: Ubuntu / WSL

Prerequisites: Node 24.11.0, pnpm 10.34.9, Python 3, Docker with WSL
integration, ffmpeg and ffprobe. Put Linux Node/pnpm on PATH, for example with
`nvm use 24.11.0`. Setup checks versions; it does not install system packages.

```bash
git clone https://github.com/markfoster314/ayamai.git
cd ayamai
pnpm run setup
python3 scripts/local-dev.py preflight
pnpm dev
```

Setup installs locked dependencies and creates private ignored `.local/`
configuration, a local media directory, and a labeled Postgres 16 container
with a retained named volume. It generates local-only credentials; it never
copies another checkout's config, retrieves cloud secrets or pulls snapshots.

**Use `pnpm run setup`:** `pnpm setup` is pnpm's built-in shell installer
and does not invoke this repository's script.

Setup initializes the 28-table schema only in a newly created empty local
Postgres volume owned by this checkout. A private container-ID provenance ticket,
loopback port, checkout label and named-volume identity are required. A single
transaction checks for existing user objects, applies the reviewed bootstrap SQL
and records its fingerprint. Any failure rolls back all initialization DDL.
Repeat setup verifies the fingerprint and performs no schema writes.
Existing unmarked/nonempty databases, retained orphan volumes and changed
fingerprints are refused, never adopted, upgraded or erased. Start is read-only
with respect to schema. No production URL, snapshot or migration is used.

The owner authorized this local-only provisioning on 2026-10-31, superseding
the earlier first-clone schema gate. Application auth/security is unchanged.

| Service | Founder address |
| --- | --- |
| Web | http://localhost:25222 |
| API, including Intake worker | http://localhost:8081 |
| MAGI Storybook | http://localhost:6006 |
| PostgreSQL | 127.0.0.1:5434 / ayamai_local |

`pnpm dev` checks ports, starts this worktree's stopped DB, runs preflight,
builds API and starts API/web/MAGI in the background. It checks API health,
the web API proxy and Storybook index. HTTP readiness does not prove sign-in,
imports or playback. Web has Vite HMR; API changes require an API restart.
No ports are silently reassigned and no pre-existing process is stopped.

## Controls and shutdown

```bash
pnpm dev:status
pnpm dev:logs
pnpm dev:stop
python3 scripts/local-dev.py db-stop
python3 scripts/local-dev.py db-start
python3 scripts/local-dev.py start --service magi
python3 scripts/local-dev.py stop --service magi
python3 scripts/local-dev.py restart --service api
python3 scripts/local-dev.py logs --service api --lines 100
pnpm test:local-dev
```

Logs are private local output: do not paste credentials or signed URLs.
`--service api|web|magi` applies to start/stop/status/restart/preflight/logs.
Web-only readiness needs API running. Intake follows API; labeling follows
API/web. Do not stop API while imports are active. Failed launches stop only
services started by that launch, retaining existing managed siblings.

Stop verifies boot ID, process start identity, process group and checkout cwd.
It refuses unfamiliar processes and never force kills or kills by port.
Lifecycle operations serialize per checkout. Services survive terminal closure
while WSL remains alive; WSL shutdown stops them. Status reports owned process
liveness, not health. Stop retains DB/media; db-stop retains the named volume.
No volume deletion or cleanup command is provided.

Setup is repeatable for its own configuration/container. If local env files
predate dev.json, setup refuses to overwrite them: use a fresh worktree.
Existing configured worktrees remain preserved.

## Concurrent agents

Reserve unique explicit offsets with other active agents and use a worktree:

```bash
git worktree add -b feat/my-task ../ayamai-my-task main
cd ../ayamai-my-task
python3 scripts/local-dev.py setup --agent --port-offset 100
python3 scripts/local-dev.py start --service magi
```

Offset 100 gives web 25322, API 8181, MAGI 6106 and DB 5534. Each worktree has
its own container/volume/database identity derived from its absolute path,
plus config, logs, process state and media. Choose another offset per concurrent
worktree. Never share the founder DB or move an initialized worktree casually.

Agent API/web use existing Clerk test authentication. Intentionally supply
approved development keys in `.local/dev.env`. No keys are fetched automatically. Remote DB URLs and live keys
are refused. Existing founder auth requires web origin 25222 and DB
5434/ayamai_local; this launcher does not extend that security boundary.
MAGI-only needs no Clerk keys or database schema. OAuth folder integrations
remain shelved without credentials.

The launcher reads only allowlisted local env entries and strips ambient cloud
credentials and NODE_OPTIONS. UI subprocesses never receive DB/server secrets.

## Scope and verification

MAGI #24, agent coordination #25 and unified launcher/bootstrap #26 are merged.
Foundation 1.0 code release, CI and Lightsail deployment are verified.
Curator/PAT, production schema and auth changes are excluded.
See [Foundation verification](foundation-1.0-verification.md) for actual results
and limitations, and [bootstrap maintenance](../scripts/local-schema/README.md).

## Curator extension

This branch adds Curator on founder port 4319 (plus the explicit agent offset).
Setup initializes private `.local/curator/config.json`; the launcher owns its
start/status/logs/stop alongside API/web/MAGI. Backend functionality is local-only.
See [Curator](../apps/curator/README.md) and its
[verification report](curator-standardization-verification.md).
The fresh bootstrap now includes 35 tables. Older schema fingerprints are refused;
use a fresh worktree/database rather than automatically upgrading retained data.
