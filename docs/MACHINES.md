# Machines

Every environment has a manifest in `machines/<id>.json`. Two commands read them:
`ayamai bootstrap <id>` renders the file that machine runs, and `ayamai handoff`
says what the machine you are not sitting at needs.

```bash
node packages/cli/index.mjs bootstrap macbook      # writes machines/macbook.command + .txt
node packages/cli/index.mjs handoff                # what each machine is behind on
```

The rendered files are **generated and committed**. Edit the manifest, re-render;
a test fails when a committed file no longer matches its render.

## A Mac that has not been used in years

The common blocker is not ayamai — it is Homebrew, which needs Command Line
Tools, which is the loop an old Mac gets stuck in.

**ayamai does not need Xcode.** There are no native modules in the workspace:
`sharp` uses prebuilt darwin binaries and nothing uses `node-gyp`. Xcode buys
`python3` (for api, curator and storybook), `git` upgrades, and Homebrew — all
optional. Those services report themselves absent until they exist, which the
platform already treats as correct.

### 1. Ask the machine

```bash
cd <repo> && git pull && ./machines/preflight.command
```

It prints the macOS version and build, the model and architecture, free disk, the
Command Line Tools state, what node/pnpm/git/python3 are installed, and whether
nodejs.org is reachable — then **one verdict**: which Node installer this macOS
can actually launch.

The rule it applies, because Node's macOS floor moved:

| Node line | macOS |
|---|---|
| 24 | 13.5 and newer |
| 22 | 11.0 and newer |
| 20 | older still (ayamai's floor is 20.11) |
| — | below 10.15: no Node release runs; upgrade macOS or use another machine |

### 2. Install Node only

From the directory preflight names (`https://nodejs.org/dist/latest-vXX.x/`), take
either the `.pkg` or the `darwin-arm64` / `darwin-x64` tarball for the machine's
architecture. No sudo beyond the installer's own.

```bash
corepack enable && corepack prepare pnpm@10 --activate
# or, if corepack is missing: npm i -g pnpm@10
```

### 3. Run the machine file

```bash
./machines/macbook.command
```

It checks the floor again, installs the workspace, does the `ayamai.local` step
(optional sudo: `/etc/hosts` and a launchd job on port 80), starts the platform,
and ends on `ayamai doctor`. Without the sudo step the panel answers on
`http://localhost:25222` and nothing else changes.

## What each machine can run

The vault is one machine's disk. On the MacBook it is absent by design, so yoru
and uta report themselves empty and everything else runs. Music lives in
`{vault}/music/`; uta says which path it looked at when it is missing.

## Upgrading macOS itself

Worth doing, but it is not a prerequisite for ayamai:

1. Back up first — Time Machine, or copy the vault elsewhere.
2. Point releases: System Settings → General → Software Update.
3. Major versions: the App Store, and check the model is supported.
4. Budget 20–40 GB free; the installer needs room to unpack.
5. Old Xcode can be deleted (`/Applications/Xcode.app`) if disk is tight —
   Command Line Tools is all any of this needs.

A machine that cannot reach 11.0 should be upgraded before Node 22 or 24 make
sense; until then `preflight` will keep saying so.
