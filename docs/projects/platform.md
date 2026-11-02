# platform — the ecosystem

The platform project of the **ayamai** organization, owned by **ikari**.
Catalog entry: `ayamai`, kind `platform`.

## What it is

One door at `ayamai.local`, one install, one place for model keys, and a local API
that tools can ask to do things. It exists so a machine can be reproduced:
`ayamai install` and the environment is the same as the last one.

## What it owns

- the door: `packages/gateway` — prefix routing, websockets, `/healthz`, the
  welcome page, and the design kit at `/ui/`
- the agent: `packages/agent` — `/agent/task`, named intents, token-gated
- the model plumbing: `packages/llm` — providers, key store, one request
- the facts: `packages/core` — registry, catalog, origin, data directory, the
  release rules (`publish.mjs`) and the calendar version (`version.mjs`)
- the command: `packages/cli` — `ayamai status · doctor · up · down · open ·
  projects · hisho · publish · version`
- the brand: `ui/brand/` — the logo, the favicon, and `ui/brand.mjs`
- the public page: `site/`, deployed to Cloudflare Pages as `ayamai-io`

## Versions and releases

Versions are calendar dates — `2026.11.02.4` — written by `ayamai version` into
`catalog.json` and every manifest, and checked by `ayamai publish` before it
sends anything. A release is **one squashed commit** on
`github.com/ayamaiio/ayamai`, tagged `release/YYYY.MM.DD-N`, plus a GitHub
release carrying the tarball and `install.sh`. Work goes to the local mirror;
`origin` is cold storage, and a pre-push hook enforces it.

## Where it lives

Repository root. The platform data directory holds keys, the agent token,
captures, the cover cache and the publish record.

## State

Installs and runs on Linux, macOS and Windows. The host entry and port 80 are
installed by `./scripts/install.sh`; `ayamai doctor` checks them. Eight products
run behind the door.

## Next

- service registration at login on all three operating systems
- the domain: `ayamai.io` still points at the old invite page until the
  nameservers move to Cloudflare
- publishing `@ayamai/cli` once the release tarball path is settled
