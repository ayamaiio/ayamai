# gēmu — ゲーム

Everything playable on this machine, in one place. Catalog entry: `gemu`, kind
`project`; manifest `projects/gemu/project.json`. The id is `gemu` because routes
are slugs; the page says **gēmu ゲーム**.

## What it reads

| source | how | what it gives |
|---|---|---|
| Steam | `libraryfolders.vdf` → every `appmanifest_*.acf` | every installed title, with size |
| Epic | `LauncherInstalled.dat` | installed games; Unreal Engine components are filtered out |
| GOG | `goggame-*.info` files | id, name, exe |
| itch | the client's `apps/` folders | the folder is the title, the exe is the target |
| emulators | `state/emulators.json`, written by `scripts/scan-emulators.ps1` | every emulator the scanner recognises, and the systems each covers |
| ROMs | `Z:\Roms`, counts from `state/arcade-index.json` | per-system counts, browsable one directory at a time |

A source that is not installed contributes nothing and renders nothing. Results
are cached for five minutes; `rescan` forces a fresh scan and reuses an in-flight
one rather than starting a second.

## Child projects — our emulators

Each emulator the scanner finds can become a **child project** under
`projects/gemu/emulators/<id>/`: a manifest, a README, an empty `patches/`, and a
page at `/gemu/<id>/` showing its upstream, license, pinned tag, fork status and
the patches we carry.

    node projects/gemu/sync.mjs           # create what is missing
    node projects/gemu/sync.mjs --check   # say what it would do

`sync` never overwrites: once a child exists, the manifest is yours. `fork.repo`
empty is a visible state — `not forked yet` — and setting it is the act of taking
the emulator over. The registry reads children separately from projects, so they
never appear in the gateway's route table, and `ayamai projects --children` lists
them.

A child is not a server: no routes, no services, no port. The parent serves its
pages.

## Adding an emulator

`scripts/scan-emulators.ps1` holds the `known` list: a key, a display name, and the
systems it covers. Add an entry, run the script on Windows, and `gemu` picks it up
on the next rescan. Azahar was added this way — `C:\Program Files\Azahar\azahar.exe`,
system `3DS` — which turned 158 files from browsable into playable.

## Launching

`POST /gemu/api/launch` (guarded by `x-cockpit` and an allowed origin) takes a
kind and an id — never a path from the browser — looks the entry up in the
library it just scanned, and builds the argv in `launch.mjs`:

| kind | runs |
|---|---|
| `steam` | `cmd.exe /c start "" steam://run/<appid>` |
| `epic` | `cmd.exe /c start "" com.epicgames.launcher://apps/<id>?action=launch&silent=true` |
| `gog`, `itch` | the exe beside the metadata |
| `emulator` | `cmd.exe /c start "" <exe>` |
| `rom` | `cmd.exe /c start "" <exe> <rom>` — refused outside the ROM library |

`launchCommand()` is pure, so the refusals are tested without spawning anything.

## States

`/gemu` is the **develop** state: a dense list of everything found, with source
counts and the launch buttons. `/gemu?view=play` is the **play** state: a wall of
tiles grouped by source, one click from starting.

- The toggle in the header switches in place; the URL updates with
  `replaceState`; the choice is remembered per browser.
- Steam tiles use the catalogue image, fetched once from
  `cdn.cloudflare.steamstatic.com` and cached in `{data}/gemu/covers/<appid>.jpg`.
  The second visit makes no outbound request, and a title with no art falls back
  to a typographic tile rather than a broken image.
- Emulators and ROM systems are typographic tiles: there is no art to borrow, and
  pretending otherwise would mean web searches for box scans.

## Handheld

`toys/gb` moved here as `projects/gemu/handheld/` and is mounted at
`/gemu/handheld/` by a small proxy inside this server. It keeps its own process,
its own frame loop, and its keyboard controls.

## Retired

`/arcade` and `/gb` 308 to `/gemu` and `/gemu/handheld`. The arcade's launcher
lives on in `launch.mjs`; its page does not.
