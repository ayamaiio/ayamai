# Ayamai session handoff

## Latest local Curator milestone

Curator now shares the monorepo and launcher; local auth/schema testing was separately approved and verified with synthetic data. Production activation/migrations remain excluded. [Current evidence](../../docs/curator-standardization-verification.md). The release notes below describe prior tasks, not this branch deployment.

## Release and wind-down consolidation — 2026-10-31

The owner authorized release of finished styling and the exact recovered logo
shown at localhost:25222, superseding the earlier PR-only/Implement-only limits
for these changes. Keep AWS app, PostgreSQL and private storage running; stop
local development services and recurring agent monitors. Product HQ remains
Ayamai Product Strategy. See [release inventory and checks](../../docs/release-wind-down-2026-10-31.md).
Unrelated dirty WSL legal, review-page and curator/auth/migration work is preserved
outside this release. The older operational snapshots below are historical.

## Approved logo refresh — 2026-10-31

The owner supplied the exact top-right concept and authorized a feature-branch
branding PR. See [asset choice](../../docs/design/approved-logo.md) and
[verification](../../docs/design/brand-verification.md). This supersedes the older
back-view logo description. This task requires approval before merge or deployment;
broader standing delivery approval does not override that limit.

**Scope correction:** The latest owner instruction requires logo/assets only.
PR #23 restores the existing landing composition and navigation/legal wordmarks;
its earlier landing redesign, new wordmark component and screenshots are removed.
See [verification](../../docs/design/brand-verification.md). No merge or deployment.

**Last updated:** 2026-10-31

## Foundational context for every incoming agent

Read [Why we build](../../docs/philosophy/WHY-WE-BUILD.md) alongside root
[AGENTS.md](../../AGENTS.md). Carry this principle into subsequent briefs and
handoffs regardless of model or host.

## Owner and product direction

Mark Foster is the owner and primary user. Build the product he wants to use: prioritize local functionality, speed, excellent media handling, privacy, and polish. User direction is the source of product decisions; brainstorming remains exploratory until the owner chooses it.

The approved landing direction is image-led and quiet, with Japanese typography, sparse red accents, and intrigue rather than a SaaS sales pitch. Premium positioning and a possible anonymous donation are exploratory; no payment or donation feature is currently implemented.

## Current technical state

GitHub repository `markfoster314/ayamai` is canonical. The inspected WSL checkout at `/home/markfoster314/ayamai-github-main` is on `codex/local-founder-auth` with uncommitted changes. Do not treat it as a clean copy of GitHub main or discard existing work.

Local development is the immediate priority:
- Web: localhost:25222
- API: localhost:8081
- PostgreSQL: 127.0.0.1:5434 (`ayamai_local`)
- Local founder authentication and local media storage are configured.
- FFmpeg is installed in the observed WSL environment.

Use [local WSL runbook](../../docs/local-wsl-development.md) for commands. Replit is retired from active development and deployment; old sync reports remain history.

AWS Lightsail app hosting and managed PostgreSQL are the configured production architecture. Check [current architecture](../../docs/architecture/current.md) and the [Lightsail runbook](LIGHTSAIL-DEPLOYMENT.md) for operational evidence. Do not claim a deployed SHA or live database state without checking it.

## Documentation priorities

1. Keep policies aligned with implemented behavior and clear about unfinished privacy controls.
2. Keep local startup and media previews easy to reproduce.
3. Keep AWS deployment claims separated from observed live state.
4. Label product hypotheses as exploratory; record owner-approved decisions distinctly.

Read [START-HERE](../START-HERE.md), [AGENTS.md](../../AGENTS.md), and [current state](CURRENT-STATE.md) before a substantial task.

## Design System Standardization 001 — local implementation

On `codex/design-system-standardization`, based on approved-logo revision
`e6b37c9c7d2091cae51d7b466564b265570322b5`. Scoped token/component consistency
changes preserve the approved assets and page compositions. Workspace typecheck,
full build, 150 frontend tests and two token checks pass. Before/after desktop
and mobile fixture screenshots are recorded in the
[implementation report](../../docs/design/standardization-001.md), with exact
files, setup and verification limits. No commit, push, PR, merge or deployment.
The owner's Implement-only brief controls this task's delivery endpoint.
Foundational reference: [Why we build](../../docs/philosophy/WHY-WE-BUILD.md).

## Unified local environment — 2026-10-31, PR only

Branch feat/unified-local-dev stacks on MAGI #24; coordination #25 remains independent. See [quickstart and boundaries](../../docs/unified-local-development.md). Setup, preflight, service controls, status, logs and retained DB shutdown are implemented. Intake remains inside API. Curator/PAT dirty work is preserved and excluded. No auth changes or migrations. Fresh-clone API/web require separately approved local schema provisioning. No merge or deployment.


## Foundation final milestone — 2026-10-31

Owner authorized local-only fresh-schema initialization, approved PR integration
and deployment verification, superseding the preceding PR-only/schema gate.
#24 and #25 are already merged. #26 is retargeted to main and amended with the
reviewed bootstrap and refusal/idempotence tests. Local acceptance passed;
integration/deployment remain pending. See [exact evidence and limits](../../docs/foundation-1.0-verification.md).
Curator/PAT and dirty founder/Windows work remain excluded and preserved.


## Foundation 1.0 complete — 2026-10-31

#24/#25/#26 are merged. #26 code release a1548e77ff75b079d4015615958b71fb82f24250
passed PR/main CI, Lightsail activation and independent public revision/health/HTML
checks. Fresh local initialization, refusal/idempotence, complete isolated
launcher, local founder authenticated API, frontend, import/label tests,
typecheck and full build passed. See [evidence and explicit limits](../../docs/foundation-1.0-verification.md).
Use `pnpm run setup`; plain `pnpm setup` is pnpm's own shell installer.
Task services/DBs are stopped with volumes retained. Existing MAGI :6006 and
dirty founder/Windows work remain preserved; do not reset or auto-stash them.
Real Clerk/live connector verification and Curator remain outside completion.

## Curator integration branch — local prelaunch

The owner authorized Curator standardization and separately approved scoped local
PAT authentication and new disposable-database testing. Implementation and evidence:
[Curator verification](../../docs/curator-standardization-verification.md).
This branch includes Curator in the common launcher; production remains unchanged.
Existing dirty founder trees and standalone data are preserved. No live migration
or secret access is authorized by the local test approval.
