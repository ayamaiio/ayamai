# platform — the ecosystem

The platform project of the **ayamai** organization, owned by **ikari**.

The platform everything else hangs off. Catalog entry: `ayamai`, kind `platform`.

## What it is

One door at `ayamai.local`, one install, one place for model keys, and a local API that tools can ask to do things. It exists so a machine can be reproducced: `ayamai install` and the environment is the same as the last one.

## What it owns

- the door: `packages/gateway` — prefix routing, websockets, `/healthz`, the welcome page
- the agent: `packages/agent` — `/agent/task`, named intents, token-gated
- the model plumbing: `packages/llm` — providers, key store, one request
- the facts: `packages/core` — registry, catalog, origin, data directory
- the command: `packages/cli` — `ayamai status · doctor · up · down · open · projects · install`
- the tools: `tools/browser-extension`, `tools/vscode-extension`

## Where it lives

Repository root. `~/.ayamai` (or the platform data directory) holds keys, the agent token, captures.

## State

Installs and runs on three operating systems in CI; installs on this machine with the hosts entry and port 80; the panel is `gehirn`.

## Next

- service registration at login on all three OSes
- publishing `@ayamai/cli` once the release tarball path is settled
- the first non-yoru project
