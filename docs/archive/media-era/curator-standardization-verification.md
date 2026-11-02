# Curator standardization — verification and handoff

Owner authorized implementation on 2026-10-31 and separately approved local
scoped token authentication and schema testing in a new disposable database.
Prelaunch ordinary breakage is acceptable; preserve originals and existing labels.
[Why we build](philosophy/WHY-WE-BUILD.md) remains foundational.

## Outcome

Local implementation is integrated on `codex/curator-standardization-20261031`,
base `8e9982b03a4a5b109172e30947f3450c9124ba7e`, worktree
`/home/markfoster314/ayamai-curator-standardized`. Production activation,
production migrations, real provider keys and existing database upgrades are excluded.
Foundation 1.0 remains the current main release; do not confuse this branch with main.

Source now lives in `apps/curator` and launches with API/web/MAGI through `pnpm dev`.
Founder ports: Curator 4319, API 8081, web 25222, MAGI 6006, PostgreSQL 5434.
The verification checkout used offset 500: 4819/8581/25722/6506/5934.
Synthetic image/configuration and placeholder Clerk keys were used, never founder secrets.

## Checks

- `pnpm install --frozen-lockfile`: passed; new dependency-free workspace importer only.
- `pnpm test:local-dev`: 16 passed, including Curator collision guards.
- `pnpm test:curator`: 14 passed: queue concurrency/retry/recovery, bounded tar reads,
  and folder labeling/final item/restart/undo/collection isolation/stale submissions.
- `python3 scripts/tests/local_schema_postgres.py`: 35-table initialization,
  data-preserving repeat and occupied table/schema refusals passed.
- `python3 scripts/tests/curator_postgres.py`: API integration passed, including
  actual standalone synthetic image -> scoped token -> database label -> undo,
  account isolation, revocation, denied token reads/minting and delayed retry receipts.
- Founder/membership regressions: 26 passed; imports: 26 passed, optional real R2 test skipped; label datasets: 5 passed; frontend: 150 passed.
- `pnpm typecheck`: passed.
- Full `pnpm build` with CI-style PORT/BASE_PATH/public synthetic key: passed;
  existing bundle size warnings remain.
- `pnpm dev`: started all four services; launcher verified API/web health,
  MAGI index and Curator health on isolated ports.
- Browser: synthetic image metadata, Keep and Undo exercised. Narrow-layout
  wrapping and completed-collection feedback corrected after browser review.

Additional founder/import/label/frontend regression results are recorded in the
final task report. Required checks must pass before integration.

## Security, data and recovery

Curator backend registration is enabled only for a development API bound to
127.0.0.1. New tokens can only POST label batches; they cannot read/export or
manage tokens. Tokens are hashed in PostgreSQL; local pairing stores its fresh
token under ignored private `.local/curator/data`. Requests still require active
membership. Personal external items are account-scoped, avoiding folder-ID collisions.
Production routes remain disabled; no production migration is part of startup/release.

Reviewed SQL in `lib/db/migrations/20261031_curator.sql` is an additive proposal,
not an executed live migration. Fresh local bootstrap was regenerated from Drizzle
schema and pinned source/SQL hashes. Existing schemas are refused, never erased.
All synthetic databases/volumes are retained. Curator sync journal/history are
retained; no automatic media cleanup or original deletion was introduced.

Original standalone source/data and all dirty founder Windows/WSL worktrees were
preserved. No existing token/configuration/private image was copied.
Do not run their legacy kill-by-port shutdown script.

## Boundaries and next action

This is verified local dataset labeling and preference collection, not a trained
model. Public Hugging Face shard range probe returned HTTP 206 (one byte only). Full live labeling, real Clerk agent pairing and cloud storage are not verified. Duels/observations remain local; labels sync to Ayamai.
The server-side export is bounded; large dataset export/pagination needs a later
focused task before treating it as a complete training-dataset exporter.

Review the full branch diff and CI. Merge/release and any production access/schema
changes require authority for those exact actions; do not claim this branch is deployed.
Startup: see [Curator README](../apps/curator/README.md). Stop task-owned services
with `pnpm dev:stop`, then `python3 scripts/local-dev.py db-stop`; retain volumes.

Initial broad checks exposed missing synthetic Clerk/SESSION_SECRET harness settings; corrected without reading existing secrets. One linked-test fixture path was corrected before the passing run.

## Exact changed paths

- `.github/workflows/ci.yml`
- `README.md`
- `apps/curator/README.md`
- `apps/curator/config.example.json`
- `apps/curator/lib/api.mjs`
- `apps/curator/lib/collections.mjs`
- `apps/curator/lib/collections.test.mjs`
- `apps/curator/lib/danbooru.mjs`
- `apps/curator/lib/features.mjs`
- `apps/curator/lib/store.mjs`
- `apps/curator/lib/store.test.mjs`
- `apps/curator/lib/tar.mjs`
- `apps/curator/package.json`
- `apps/curator/pair.mjs`
- `apps/curator/public/index.html`
- `apps/curator/server.mjs`
- `apps/curator/tests/workflow.test.mjs`
- `artifacts/api-server/src/lib/curator-auth.ts`
- `artifacts/api-server/src/lib/curator-labels.ts`
- `artifacts/api-server/src/lib/curator.test.ts`
- `artifacts/api-server/src/lib/tag-key.ts`
- `artifacts/api-server/src/middlewares/membershipBoundary.ts`
- `artifacts/api-server/src/routes/curator.ts`
- `artifacts/api-server/src/routes/index.ts`
- `docs/curator-execution-brief.md`
- `docs/curator-standardization-verification.md`
- `docs/unified-local-development.md`
- `lib/db/migrations/20261031_curator.sql`
- `lib/db/src/schema/curator.ts`
- `lib/db/src/schema/index.ts`
- `package.json`
- `pnpm-lock.yaml`
- `product/operations/CURRENT-STATE.md`
- `product/operations/SESSION-HANDOFF.md`
- `scripts/local-dev.py`
- `scripts/local-schema/bootstrap.sql`
- `scripts/local-schema/manifest.json`
- `scripts/tests/curator_postgres.py`
- `scripts/tests/local_schema_postgres.py`
- `scripts/tests/test_local_dev.py`
