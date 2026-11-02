# The pixiv agent, finally in the repository

`service.mjs` is the agent that runs on the Windows side of this machine. It is
one Brave window, signed in, and it fetches what the box in WSL cannot: pixiv only
hands `original` URLs to a signed-in browser.

Until now this file existed in exactly one place, on one disk, unversioned. It is
here verbatim, with its sha256 in `service.sha256`, and
`scripts/pixiv-agent-sync.mjs` is how it gets to where it runs.

## What it serves

`127.0.0.1:8099`, on Windows only, no auth (loopback).

| route | does |
|---|---|
| `GET /status` | `{ signedIn, user }` - is the browser signed in to pixiv |
| `GET /bookmarks/status` | `{ running, done, failed, total, last, startedAt }` |
| `GET /bookmarks/start?minutes=N` | walk your bookmarks for N minutes |
| `POST /grab {url}` | one artwork, all pages, into the vault |
| `GET /login` | the window, and what to do with it |
| `GET /open` | bring the window back to pixiv |

## The sweep

Your bookmarks are curation you already did; the sweep brings them home.

1. it pages the bookmark list 48 at a time (`/ajax/user/.../illusts/bookmarks`);
2. it asks yoru's API which ids are already home (`/api/capture/existing`) and
   skips those - **the library is the ledger**, so a second run is a diff;
3. for each remaining id it fetches the artwork JSON, downloads every page into
   the inbox folder, then posts the folder to `/api/capture/import`, which consumes
   it and writes objects into the vault.

A post that cannot be fetched is one of three things, and only one is a failure:

| what | why | what we do |
|---|---|---|
| `ugoira` | an animation; there is no still | skip |
| restricted | the original is withheld | fall back to `large`/`regular`, marked `(smaller)` |
| `gone` | deleted or private | skip, and say so |

## What it needs from the machine

- Brave, with a profile signed in to pixiv (`AGENT_PROFILE` overrides the path);
- `playwright-core` next to it in its runtime directory;
- yoru's API on `127.0.0.1:8081`.

## Known state

**The string literals in this file are encoding-damaged.** Somewhere in its
history it was written through a chain of wrong encodings, so Japanese titles and
even the middle dot appear mangled in its log lines, and one line carries ~118 KB
of it. The code is fine and `node --check` passes; the damage is in the strings.
It is recorded here rather than quietly rewritten: a clean re-authoring is filed
as its own task, and until then this is the exact artifact that runs.

## Syncing

    node scripts/pixiv-agent-sync.mjs --check     # repo vs the running copy
    node scripts/pixiv-agent-sync.mjs             # copy the repo's version into place

The runtime directory is the Windows folder that holds `playwright-core`, because
that is where gehirn starts it from. The repository is the source of truth; the
sync is one file, verified by hash.
