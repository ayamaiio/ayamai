# Coordination examples

Apply root [AGENTS.md](../AGENTS.md); these examples grant no implementation or
release authority. Preserve [Why we build](philosophy/WHY-WE-BUILD.md) in each brief.
Use the [brief](agent-execution-brief-template.md) and
[handoff](agent-handoff-template.md), recording actual paths and SHAs.

## Start an isolated task

Inspect without modifying another checkout:

```sh
git status --short
git worktree list
git fetch origin
git branch -r
# Also inspect open PRs and active task scopes before claiming paths.
git worktree add -b fix/library-empty-codex-20261031 ../ayamai-library-empty origin/main
# Run subsequent edits/checks explicitly in the new worktree.
```

Choose an unused branch/path; do not reuse the example blindly. Record the full
base SHA with `git rev-parse HEAD`. A dirty source checkout stays untouched.
Use Node/pnpm versions from CI and install locked dependencies in your own
worktree. This repo uses pnpm workspaces, with no configured Turborepo.

## Main app: one empty-state fix

Example scope: own only the relevant page/test under
`artifacts/private-media-library/src/`; read shared UI and API contracts.
Endpoint: PR. No shared token changes, API changes or screen redesign.

```sh
pnpm --filter @workspace/private-media-library test -- src/pages/landing.test.tsx
pnpm --filter @workspace/private-media-library typecheck
pnpm --filter @workspace/private-media-library build
```

The test path is an existing example; replace it with the suite covering the
actual page. Capture synthetic-data screenshots at mobile/desktop widths for
changed states. If a shared component must change, first record added owned
paths, contract effect and consumers, then check those consumers too. Read-only
access to shared UI does not silently expand the task.

## MAGI: one story family

Inspected 2026-10-31: `apps/magi/`, package `magi`, exists on
`feat/magi-foundation` (PR #24), not on the inspected main revision
`af7fc25c29ceb4ff10476bc66f323891b60db28c`. Main's workspace globs cover
`artifacts/*`, `lib/*`, `lib/integrations/*` and `scripts`; the MAGI branch adds
`apps/*`. Recheck the target branch's manifest before running these commands.
Do not merge MAGI or copy it into main as part of a documentation task.

Example scope on a base containing MAGI: own `apps/magi/src/Button.stories.tsx`;
read the real shared Button and tokens. Endpoint: PR. Use synthetic props/data.

```sh
pnpm --filter magi typecheck
pnpm --filter magi build
pnpm --filter magi storybook
```

Capture affected Storybook states, record the actual local port, and stop your
server with Ctrl+C. MAGI consumes shared UI. Its inspected foundation branch also
reads app styles/branding; treat these as existing coupling to account for during
verification, not a reason for an unrequested extraction. Shared UI never imports
MAGI or app modules. Story experiments do not approve changes to live app tokens.

## Shared token or component change

Name one writer for `artifacts/ayamai-design-system/`, read its
[package guidance](../artifacts/ayamai-design-system/docs/AGENTS.md), inspect
consumer imports, and record compatibility. For tokens, run
`pnpm --filter @workspace/ayamai-design-system tokens` and review generated diffs.
Run design-system typecheck/build and affected app/MAGI checks above (MAGI only
when present). If impact spans workspace configuration or cannot be bounded,
run root `pnpm typecheck` and `pnpm build`; report any unavailable required checks.
Do not assume a root typecheck covers a new workspace glob: inspect its script.

No new coordination script is introduced: checkout ownership and edit authority
are task context, not facts a manifest check can reliably prove. Existing CI runs
on PRs; the PR checklist exposes scope, evidence and integration blockers for review.
