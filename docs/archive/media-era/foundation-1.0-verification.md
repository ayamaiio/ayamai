# Foundation 1.0 verification

2026-10-31, America/New_York. Status: **Foundation 1.0 complete**. Local acceptance, approved PR integration,
CI and the code release deployment have been verified.
Foundational reference: [Why we build](philosophy/WHY-WE-BUILD.md).

## Authority and scope

The owner explicitly authorized local schema provisioning, complete developer
verification, approved PR integration and deployment verification. This supersedes
the earlier schema and PR-only gates in the historical unified-local report.
Curator/PAT, auth changes, live migrations, production snapshots and private-media
testing remain excluded. #24 MAGI and #25 coordination were already merged:
ac5111b321528a8a440aea1cc952ad3c85e07e9e and
69217be3538c29a7c7c40b8ace7eda941be5cb0a. Initial main and public /REVISION
were 69217be; its CI and Deploy Lightsail runs succeeded.

## Local evidence

All work used isolated WSL worktrees; no founder config was copied.

| Check | Actual result |
| --- | --- |
| `pnpm run setup` in fresh ayamai-foundation-final | Locked install, new owned Postgres :5434/ayamai_local, 28-table bootstrap passed |
| Repeat setup | Fingerprint verified; no schema writes |
| `pnpm test:local-dev` | 16 safety tests passed |
| `python3 scripts/tests/local_schema_postgres.py` | Real empty initialization, data-preserving repeat, nonempty table/custom-schema refusals and transaction rollback passed |
| `pnpm typecheck` | Passed web, API, libraries and MAGI |
| Frontend `pnpm --filter @workspace/private-media-library test` | 150 tests, 28 files passed |
| `pnpm test:imports` | 26 passed; optional real R2 test skipped |
| `pnpm test:label-datasets` | 5 passed, including private queue/export integration |
| local-dev-auth.test.ts | 4 passed |
| `PORT=25221 BASE_PATH=/ NODE_ENV=production VITE_CLERK_PUBLISHABLE_KEY=<synthetic-test-key> pnpm build` | Passed all configured packages including MAGI |
| API start and web start on founder defaults | Passed :8081 and :25222 |
| POST /api/dev-auth/session | 200 using existing guarded local founder session |
| Authenticated GET /api/membership, /api/access/me, /api/media, /api/imports, /api/social/labels, /api/social/label-queue, /api/social/label-exports | All 200 against new local DB |
| GET web /library | 200, React root served |
| Existing MAGI :6006 /index.json | 200, 48 story/docs entries; pre-existing process preserved |
| Fresh ayamai-foundation-fresh: `pnpm run setup --agent --port-offset 200`, then `pnpm dev` | Passed all three services at web 25422, API 8281, MAGI 6206, isolated PG 5634 |
| Agent keys | Synthetic CI placeholders only; startup/readiness checked, real Clerk auth untested |

Tests requiring PostgreSQL used a separate uniquely named synthetic database inside
the verified owned container. No real provider credentials or media were used.
The first imports invocation without DATABASE_URL failed; it passed after using
that disposable test database. The first full build lacked PORT; it passed with
the repository's CI build environment. These were configuration corrections,
not application changes. PR CI initially exposed a noninteractive nested-install
prompt after environment sanitization; setup now supplies CI=true only to its
locked install, while continuing to strip ambient credentials.

Plain `pnpm setup` invokes pnpm's built-in shell installer. Use
`pnpm run setup`; the one shell block appended during discovery was removed.
The exact founder `pnpm dev` refused occupied port 6006 safely; the existing
MAGI worktree/process was preserved. Founder API/web were then started separately.
The full combined launcher passed in the second genuinely fresh agent worktree.

Intake remains the API's existing startImportWorker path. Durable worker,
ownership, retry, synthetic provider, labels and exports passed their integration
suites. No separate worker or auth bypass was added. Existing MAGI visual
validation remains in its completion report; this task changes no UI and does
not claim new all-story browser screenshots. Real Clerk sign-in, external
connectors, R2 and production authenticated media behavior remain untested.

## Safety and recovery

Schema creation is restricted by checkout config/container identity, loopback
port, named volume and a private container-ID creation ticket. Existing volumes
are not adopted. Reviewed generated SQL and schema source hashes must match.
Empty-object guard, advisory transaction lock, DDL and marker commit atomically.
Nonempty/unmarked or changed schemas are refused; setup never upgrades them.
CI now runs these safety tests and actual disposable Postgres bootstrap checks.
No bootstrap is in the production deployment path.

Dirty WSL /home/markfoster314/ayamai (feat/brand-lab, Curator) and dirty
ayamai-github-main were preserved. Dirty Windows C:/Users/admin/CodeProjects/ayamai
at 0728f97251c9e3402f39bba4d0612c227f7db004 was preserved. They cannot be safely
fast-forwarded automatically. No stash/reset/clean or Curator merge was used.

Task-owned API/web/MAGI processes and both databases were stopped after validation;
the pre-existing MAGI process was left running.

Local processes can be stopped with `pnpm dev:stop`; database stop is
`python3 scripts/local-dev.py db-stop`. Volumes, synthetic test DBs and local
config are retained. No destructive database cleanup is provided.
The combined #26 diff was reviewed against unchanged main 69217be; all PR CI
and Socket checks passed before the expected-head-SHA merge.
Production activation rolls code/frontend back together on failed health/revision
checks; it never runs migrations. Initial verified rollback revision is 69217be.
See [Lightsail recovery](../product/operations/LIGHTSAIL-DEPLOYMENT.md).


## Integration and production evidence

- #24 MAGI merged at ac5111b321528a8a440aea1cc952ad3c85e07e9e.
- #25 coordination merged at 69217be3538c29a7c7c40b8ace7eda941be5cb0a.
- #26 launcher/bootstrap amended, retargeted to main, and merged at
  a1548e77ff75b079d4015615958b71fb82f24250.
- Final PR source e4de2f73dc717ec63fa1d0b602fe420be540514e passed
  [PR CI](https://github.com/markfoster314/ayamai/actions/runs/41259929928).
- Merged code passed [main CI](https://github.com/markfoster314/ayamai/actions/runs/41260183900)
  and [Lightsail verification, activation and public smoke checks](https://github.com/markfoster314/ayamai/actions/runs/41260184004).
- Independent public checks after deployment: /REVISION exactly
  a1548e77ff75b079d4015615958b71fb82f24250; /api/healthz returned HTTP 200
  with status ok; /library returned HTTP 200 with the React root.
- Only the normal matched code/frontend release was deployed. No production
  schema/auth changes, snapshots, private media or consequential production writes.

This completion record follows the verified code release. Its documentation-only
merge will trigger another normal CI/deployment run; consult Actions and the
public /REVISION for that later documentation revision.

The complete #26 path scope is .github/workflows/ci.yml, .gitignore, README.md,
docs/foundation-1.0-verification.md, docs/unified-local-development.md,
docs/unified-local-verification.md, package.json,
product/operations/SESSION-HANDOFF.md, scripts/local-dev.py,
scripts/local-schema/README.md, scripts/local-schema/bootstrap.sql,
scripts/local-schema/manifest.json, scripts/tests/local_schema_postgres.py and
scripts/tests/test_local_dev.py. This completion update changes only documentation.

Real Clerk authentication and live external connectors remain configuration-
dependent and untested, as explicitly separated from the local Foundation
acceptance. No all-default combined launch is claimed while the preserved
MAGI process occupies 6006; separate founder services and the complete fresh
agent launch supply the runtime evidence.
