# Synchronization audit — 2026-10-31

> **Historical audit.** This records the Replit-era synchronization state observed on 2026-10-31. Replit is no longer an active development or deployment surface. Do not use the findings below as current sync instructions or evidence of today’s production state. GitHub is canonical; see [current state](CURRENT-STATE.md) and the [Lightsail runbook](LIGHTSAIL-DEPLOYMENT.md).

## Verified state before policy merge

- GitHub main: 47388a680b5e0c1bfbfaf1e8f95b8cf19fac5d19.
- Accessible Windows original checkout: 6e807a09d7cd0d6f5ec3662357b64a56c9081413,
  main, one commit behind GitHub, with 15 modified tracked files and five
  untracked file/directory entries. All original work preserved.
- Replit audit reports clean main at b5569d7d3ab7fa0364986286bdced8c796d89e66;
  cached origin/main 297bbd36449952b38a82d0cbe91b6122ef9a311a is stale.
  Six commits ahead of that cached ref; relationship to live GitHub not established.
- Replit latest publication record has no content change from founder-access
  repair 12e965f989a2f34d7d5e7647054d4c8924f090b4. This is security-sensitive
  divergence; do not fold it into a routine synchronization release.
- Platform reports production success at https://ayamai.io, deployment
  b8d3fc1f-8131-4f51-b1ef-ad820109e279. Serving SHA is not exposed/verified.
- Windows Git fetch and authenticated GitHub CLI work. Replit Git proxy can
  read live main, but its unauthenticated GitHub comparison returned 404.
- No tracked GitHub Actions workflows or recent Actions runs found. Renovate
  configuration PR #1 is open and was not merged by this task.

## Release blockers

Review and separately approve security-sensitive founder/membership changes;
establish Replit commit ancestry and complete diff against GitHub; run appropriate
checks on that reconciled release; preserve/reconcile Windows dirty work; obtain
build-to-serving-revision evidence. No application merge or publish is authorized
by this audit alone when these risks remain unresolved.

## Safe continuation

Fetch remote refs without overwriting work. Export or push Replit work to a
review branch after inspecting its contents for secrets, then compare all commits
against canonical main. Do not replace Replit main with GitHub main until unique
work is preserved and reviewed. Never use reset/clean/force-push for synchronization.
The original Windows checkout must remain untouched until its application work is
reviewed; use the isolated policy worktree for this documentation task.

For a clean checkout only, fetch origin, switch to main, then merge --ff-only
origin/main. For a dirty checkout, report changes and reconcile on a dedicated
branch instead of applying these steps blindly. Node 24 is available on Windows;
select the repository-compatible pnpm version before installing with a frozen
lockfile. Do not copy production secrets or run schema push/migrations as setup.

## Low-effort follow-ups (recommendations, not implemented)

Add GitHub Actions for repository-appropriate checks, then consider required checks
and branch protection with separate permission approval. Complete Renovate setup
through its existing PR after review. Record release SHA/build ID in non-sensitive
release metadata to verify production revision without changing access controls.

## Replit documentation-only application — 2026-10-31

- Approved source: merged GitHub pull request 2, main revision
  `3971bf2c82aec4a0353865855e9867eeb386c66c`, verified through the Git proxy
  and fetched as objects without updating the working branch or remote refs.
- Replit application HEAD remains
  `b5569d7d3ab7fa0364986286bdced8c796d89e66` on `main`. Documentation is
  applied as working-tree changes; no new application revision or history merge
  is implied. Existing compatible `replit.md` guidance is preserved.
- Verified ancestry: Replit HEAD has 6 unique commits and canonical main has
  20 unique commits. Cached `origin/main` remains stale. These counts describe
  commit history, not an application-content equivalence claim.
- Scope: only the eight documentation paths changed by pull request 2.
  The source documents are retained verbatim except this local audit addendum.
  No application, dependency, permission, database, secret, or deployment changes.
- Product context outside pull request 2 was deliberately not imported. Local
  links from `product/START-HERE.md` to `handbook/HOW-WE-WORK.md`,
  `handbook/PRODUCT-PROCESS.md`, `vision/PRODUCT-VISION.md`,
  `operations/CURRENT-STATE.md`, and `ideas/brand-direction.md` therefore remain
  unavailable in this checkout. Consult those files at the approved GitHub
  revision when needed; do not infer missing approvals or implementation facts.
- Application synchronization remains blocked by the security-sensitive
  founder-access differences and the unverified production serving revision.
  This documentation-only instruction does not authorize resolving or releasing
  those differences. Windows state above is historical, not rechecked here.

## Reconciliation preparation — 2026-10-31

The Replit addendum above is retained as historical evidence. Task 2 now preserves
both histories on an isolated reconciliation branch. No merge to main or release
is authorized by this preparation. See RECONCILIATION-20261031.md for verification
and security decisions. The missing-document limitations above no longer apply
to this combined worktree. Production serving revision remains unverified.
