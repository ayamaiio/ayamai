# Unified local environment verification

Historical PR-only report. Its schema/integration gates are superseded by the
[verified Foundation 1.0 completion](foundation-1.0-verification.md).

2026-10-31. Implement/PR-only endpoint. No merge, deployment, production
access, migrations, schema push, snapshot restore, auth changes or Curator import.
Foundational reference: [Why we build](philosophy/WHY-WE-BUILD.md).

## Revision and scope

Worktree: /home/markfoster314/ayamai-unified-dev

Branch: feat/unified-local-dev, based on MAGI #24 commit
fd8fccbf36cf79d22ce593f6fa8c16715ca32e02. PR targets feat/magi-foundation so
the review contains only this milestone. #25 remains independent. Nothing on
main or either dependency branch was changed. Feature-branch commits/pushes
are the only GitHub write effects of this task.

Changed paths:

- scripts/local-dev.py
- scripts/tests/test_local_dev.py
- package.json
- .github/workflows/ci.yml
- .gitignore
- README.md
- docs/unified-local-development.md
- docs/unified-local-verification.md
- product/operations/SESSION-HANDOFF.md

## Executed checks

| Command/check | Result |
| --- | --- |
| python3 scripts/local-dev.py setup --agent --port-offset 100 | Passed twice; locked dependencies, private config and isolated DB |
| pnpm test:local-dev | 12 passed |
| pnpm typecheck | Passed, including web/API/MAGI |
| pnpm --filter @workspace/api-server build | Passed |
| start --service magi | Passed on 6106; repeated start refused while running |
| GET http://127.0.0.1:6106/index.json | HTTP 200 |
| status / stop --service magi / status | Owned running then stopped |
| db-stop / db-start | Passed; data volume retained |
| preflight without Clerk test keys | Refused with configuration guidance |
| API preflight with synthetic test placeholders | Actual read-only DB probe refused empty schema |
| git diff --check | Passed |

Tests cover credential/environment filtering, rejection of remote/wrong DBs,
live keys and unknown config, port collision refusal, dotenv refusal, fixed
founder boundary and agent DB identity, stale PID and unrelated-process
protection, real owned-process shutdown, schema-gate behavior, and partial
launch cleanup that preserves an existing sibling.

The synthetic placeholders were used only to reach the read-only database
probe; no real Clerk secrets were fetched and no authentication was tested.
The empty DB was not initialized. API/web full runtime, sign-in, import jobs,
capture, labels/exports, media playback and all 32 Storybook stories were not
retested. The API build and HTTP Storybook index do not establish those results.
No application code changed; broad application test suites/full build were
not rerun. CI adds the launcher tests, but this stacked PR's feature-branch base
does not match the existing main-only pull_request trigger. No CI pass claimed.

## Preserved environment and remaining gate

The dirty WSL feat/brand-lab checkout at /home/markfoster314/ayamai was inspected
before and after; its tracked/untracked change list is unchanged, including
Curator, PAT auth and unapplied migration. The dirty Windows main checkout was
also left unchanged. No configuration was copied from either checkout.

Founder defaults remain web 25222, API 8081, MAGI 6006, Postgres 5434.
Verification used 25322/8181/6106/5534 and a worktree-specific DB identity.
This task's MAGI process and DB container were stopped at completion; generated
local config, empty DB volume and media directory are retained. Existing port
6006 and unrelated Postgres 5432 remained listening throughout.

**Partial acceptance:** tooling is implemented and reviewed locally; clone to
fully usable API/web is gated on separately approved local schema provisioning.
The explicit no-migration constraint prevents resolving that gate in this task.
Concurrent agent API/web additionally need intentionally supplied Clerk test
keys, since extending founder auth would change an excluded security boundary.
See [quickstart and controls](unified-local-development.md).
