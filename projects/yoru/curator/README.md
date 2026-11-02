# Curator — local dataset labeling

Part of the Ayamai pnpm monorepo. Foundational reference:
[Why we build](../../docs/philosophy/WHY-WE-BUILD.md).
Imported from the founder's standalone `/home/markfoster314/danbooru-curator`;
only source files were copied. Existing data, configuration and credentials remain untouched.

## Standard workflow (Ubuntu WSL)

From the repository root, in a fresh checkout with free founder ports:

```bash
pnpm run setup
pnpm dev
```

Open http://localhost:4319. Ayamai is at http://localhost:25222 and MAGI at
http://localhost:6006. `pnpm dev:status`, `pnpm dev:logs`, and `pnpm dev:stop`
include Curator. `python3 scripts/local-dev.py db-stop` retains the database volume.
Never use the old standalone `stop.sh`, which killed by port.

Setup creates private `.local/curator/config.json`; edit its collections to choose
Danbooru tar shards or a local folder. `config.example.json` documents the public
sample. Original tar images are range-read; no full shard download is required.
Startup prefetches an image. Live availability and gated Hugging Face access are
provider-dependent; the default example does not obtain credentials.

On first combined founder launch, pairing happens automatically before Curator starts.
For a separately started API, run `pnpm curator:pair` then restart Curator.
Pairing uses the existing guarded local-founder session and creates a fresh,
revocable submission-only token. It never prints it or reads existing tokens.
API sync starts disabled; pairing enables it after Curator restarts. Existing
agent mode requires an intentionally supplied development session/token; the
launcher does not bypass Clerk. Agent port offsets also apply to Curator.

Existing 28-table databases are never upgraded automatically. Use a fresh
checkout/worktree with its own empty database and free ports. Preserve existing
databases and media. The reviewed 35-table bootstrap is only for new owned volumes.

## Label and resume

Keep: Y/right arrow. Pass: N/left arrow. Skip: S/space. Neutral: M.
Cannot judge: C. Undo: U. Duel: D; 1/2/T choose left/right/tie.
Zoom: Z/click/wheel. Tab toggles metadata; ? shows help.

Each collection has separate cursor and kept-image storage. Labels, provenance,
events and duel records remain in `.local/curator/data`. Kept images are copies;
undo removes only the copied keep and never the source image. Dataset IDs must be
unique safe collection names; no user media or labels are committed to Git.

Label writes and queue appends are fsynced. A stable event ID and sync journal
allow replay after interruption; the API retains receipt history so old retries
cannot overwrite corrections. Rejections and offline requests stay queued, with
periodic retries. Undo syncs a `skip` correction; original history remains. Skip
and cannot-judge are not positive/negative training labels.

Duels/events remain local; label sync, personal export and coverage are integrated.
No model training or automatic media import occurs. This is a local prelaunch tool,
not an anonymously accessible or production-hosted service. Backend routes require
an explicit enable flag, development mode and a loopback-bound API; production
activation is disabled even if the flag is accidentally set.

## Verification

```bash
pnpm test:curator
python3 scripts/tests/curator_postgres.py
```

The second command requires setup and creates a separate synthetic database inside
this checkout's verified owned container. It never accepts an ambient database URL,
retains its test database, and tests the real standalone-to-API label/undo workflow.
See [completion evidence](../../docs/curator-standardization-verification.md).
