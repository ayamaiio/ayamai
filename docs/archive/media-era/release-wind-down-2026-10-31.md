# Release consolidation and wind-down — 2026-10-31

Foundational reference: [Why we build](philosophy/WHY-WE-BUILD.md).

Owner instruction: ship finished changes to aws.ayamai.io, use the exact current
localhost logo, stop local development and recurring agent monitoring, keep the
AWS application/database/private storage running. Product direction returns to
the owner and Ayamai Product Strategy. This supersedes the earlier logo PR-only
and styling Implement-only endpoints for the consolidated release.

## Release contents

- The logo-only corrected PR #23 baseline at e6b37c9, with its older simplified
  mark replaced by the selected recovered pale-blue raster assets from WSL.
- Finished [Design System Standardization 001](design/standardization-001.md):
  semantic colors, feedback contrast, typography, focus/hover states and shared
  component consistency. Existing landing composition and application behavior
  are preserved.
- Asset provenance limitation remains: the recovered composite cannot be proved
  identical to the originally named attachment. Raster SVG wrappers are not
  editable vector masters. The owner explicitly chose the current local result.

## Verification before PR

- Fresh Windows `pnpm typecheck`: passed.
- `node --test artifacts/ayamai-design-system/scripts/tokens.test.mjs`: 2 passed.
- `pnpm --filter @workspace/private-media-library test`: 28 files, 150 passed.
- `pnpm build` with PORT=25229, BASE_PATH=/: passed, existing chunk-size warning.
- Matching Windows native build packages supplied through temporary NODE_PATH;
  repository dependencies and lockfile unchanged.
- Existing standardization browser fixture evidence is linked in its report.
  Live sign-in, private playback and persisted uploads were not exercised.
- Before release: public REVISION and health returned 200; unauthenticated
  /api/access/me returned 401. GitHub main and serving REVISION both identified
  51994887c5f456e10eea47a2553b0f4bead4a8e6, the verified rollback reference.
- GitHub CI and deployment must complete before the release is reported shipped.

## Preserved work and quiet state

- Windows: consolidated feature branch. Exact file inventory is the PR diff.
- WSL /home/markfoster314/ayamai-github-main: dirty main at 5199488, containing
  selected logo assets plus unrelated legal edits and temp-review page. Left
  intact; cannot safely fast-forward this dirty checkout automatically.
- WSL /home/markfoster314/ayamai: dirty feat/brand-lab at 3d03b95, behind main,
  with curator/auth/schema/migration work. Excluded; needs a separate brief and
  security/migration review before delivery.
- Stopped owned local API/web via scripts/local-dev.py and stopped
  ayamai-work-local-postgres and ayamai-dev-postgres without deleting volumes.
  Stopped the identified danbooru-curator process on port 4319. Unrelated
  opulent-postgres and system services remain running.
- Other visible Ayamai chats were idle. No messages sent to other agents.
  Recurring cloud-monitor shutdown is not yet verified; no local Codex
  automation.toml inventory was present.
- Resume local development using [the WSL runbook](local-wsl-development.md).
  Local URLs are offline after shutdown; AWS remains the intended usable app.

## Remaining parked work

Open older PRs #9 (Pixiv prototype), #8 (earlier delivery proposal), and #1
(Renovate setup) were not included or merged. PR #23's corrected branding is
included in this consolidated release, with the newly selected asset version.
No migrations, secret access, permission changes or private-media writes are
part of this task.
