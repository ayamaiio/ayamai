# Task 2 reconciliation decision report — 2026-10-31

Status: candidate prepared and checked; NOT approved for merge to main or publication.
The current task instruction overrides inherited standing release approval for this task.

## Revisions and preservation

| Surface | Full revision / evidence |
| --- | --- |
| GitHub main, independently verified | 3971bf2c82aec4a0353865855e9867eeb386c66c |
| Original WSL main, unchanged | 3971bf2c82aec4a0353865855e9867eeb386c66c |
| Setup preservation branch chore/local-wsl-setup-20261031 | 58e48d7c18e63574755f4b0669db96f8f8734d0d |
| Replit clean main, reported by read-only app inspection | cefaf17d0e7e788ffcb2dc24baa5c4044745ce4e |
| Independently fetched archive/replit-preservation-20261031-cefaf17d0e7e | cefaf17d0e7e788ffcb2dc24baa5c4044745ce4e |
| Reconciliation merge, parents main then Replit | 1a6c6440ad704b581a138a0a56afd583be551c37 |
| Original Windows dirty checkout | 6e807a09d7cd0d6f5ec3662357b64a56c9081413 |
| Existing clean Windows ayamai-sync worktree | 3971bf2c82aec4a0353865855e9867eeb386c66c |
| Production serving SHA | UNVERIFIED; no production access during this task |

Merge base: 297bbd36449952b38a82d0cbe91b6122ef9a311a. Independent local graph confirms
20 GitHub-only / 7 Replit-only commits. All seven Replit commits, including publication
metadata, are ancestors of the candidate; no cherry-pick or history rewriting.
GitHub-only work changes product/agent documentation, not application code.
Only merge conflict: add/add product/operations/SYNCHRONIZATION.md. Both records retained,
with an explicit historical qualifier and current preparation note. All other GitHub
product documents and all Replit application changes survive.

The original WSL tree remains dirty exactly as inspected: three tracked modifications
and one untracked runbook (not four tracked changes). Its four files were copied into a
separate clean worktree and committed, never reset/stashed/overwritten:
- AGENTS.md
- artifacts/api-server/src/index.ts
- docs/local-wsl-development.md
- product/operations/SESSION-HANDOFF.md

Setup is deliberately absent from the auth candidate. It adds optional HOST binding
with the existing 0.0.0.0 default and records local-only setup. Merge it separately after
review, reconciling handoff text as historical setup evidence. Local credentials and
ignored launch scripts stay in the original .local directory, outside commits.

## Security decisions requiring explicit separate approval

These are proposed retained Replit behaviors, not approvals inferred from inherited
memory or recovery documents. No production privileges/settings were changed.

| Decision | Observed difference and recommendation | Evidence / remaining limitation |
| --- | --- | --- |
| Reach access management before referral admission | Retain Replit /access and /access/* outer-boundary exception. GitHub blocks founder snapshot/invite acceptance before their own admission logic can run. Every current access handler was inspected: snapshot/accept require Clerk; management requires active owner; public validation is independently limited. | Actual-stack tests cover unauthenticated denial, unknown private routes, non-owner denial and invite flow. Wildcard exceptions require future access routes to supply their own checks; review every added handler. Windows /access/me-only exception is a partial alternative and is NOT combined. |
| Explicit admission/revocation over legacy referrals | Retain access_memberships precedence in ensureMembership; active admission creates referral bookkeeping; revoked admission wins over old referral rows. Preserve fresh active membership on private-resource and signed-media paths. | Tests deny referral-only/legacy-only private access and revoke signed-media access immediately. The two invitation registries still coexist; consolidating them is outside this task. |
| Same-identity founder email repair | Retain provider-verified configured email matching, five-second lookup timeout, same-ID stored-email refresh and member-to-owner promotion when no competing owner exists. | Mismatched/unverified/spoofed emails denied; revoked users stay revoked. Synthetic tests do not verify the intended production identity. |
| Separate-identity owner transfer | Require separate owner approval before releasing/enabling this behavior. Code requires exact server-configured prior-owner ID plus verified target email; conflict is 409; writes share transaction/advisory lock. Old owner becomes active member; media ownership and provenance stay unchanged. | Concurrent/idempotent transfer, wrong/stale source, third-party email conflict and revoked target covered. Demoted owner consumes a member slot and may temporarily exceed five; accounts are preserved and new invites remain blocked. Confirm this consequence when approving. Production identity/configuration inspection and any setting change require separate authorization; none performed. |
| Rate limits and frontend freshness | Retain proposed bootstrap 30/minute per authenticated user (was 3), Retry-After and explicit 429 payload, one retry for network/5xx, 60s freshness and admitted-account polling every 120s. No polling for unadmitted users. | Excess limit and cooldown tested. Server resource revocation remains immediate; UI can retain stale admission until refresh. Global provider-load budget and real multi-instance load were not tested. Invitation creation/acceptance limits remain unchanged. |
| Owner versus moderator | Preserve separate SOCIAL_MODERATOR_USER_IDS authorization; owner is not implicitly moderator and gains no access to another identity's private media. | Actual-stack tests cover moderator separation and account-scoped media reads/updates/grants. No moderator configuration changed. |

No schema/dependency change is introduced by the reconciliation. No migration, account
delete, secret change, new role or private-media reassignment is needed. Recovery runbook
and inherited claims of prior authorization are retained as history, not authorization
to release under this task.

## Verification

Node 24.11.0, pnpm 10.34.9; separate WSL setup and reconciliation worktrees.
Offline frozen-lockfile installs used --ignore-scripts; no dependency resolution changes.
No production database or media used. Existing local PostgreSQL ayamai_local at
127.0.0.1:5434 supplied synthetic fixtures; founder suite creates/removes an isolated
schema containing table definitions only. Identity provider calls were mocked.

| Check | Actual result |
| --- | --- |
| pnpm typecheck, candidate | PASS |
| pnpm test:founder-access, candidate | PASS: 26 tests, including membership suite |
| pnpm --filter @workspace/private-media-library test, candidate | PASS: 150 tests across 28 files |
| PORT=25221 BASE_PATH=/ NODE_ENV=production pnpm -r --if-present run build, candidate | PASS: all configured builds; Vite large-chunk warning only |
| git diff --cached --check / git diff --check | PASS |
| Setup pnpm typecheck and API build | PASS |
| Setup frontend build with PORT=25221 BASE_PATH=/ | PASS; large-chunk warning |
| Setup membership + access-policy tests with development configuration | PASS: 10 tests |
| Original local frontend / | HTTP 200 |
| Original local API /api/healthz | HTTP 200 |
| Original local API /api/media without session | HTTP 401 |

Initial setup tests lacked DATABASE_URL, then lacked development Clerk configuration
(503 rather than expected 403); frontend initially lacked required PORT. Correcting only
the test/build environment resolved those failures, with no application code changes.

Not run: real Clerk sign-in, real founder session, actual membership/admin changes,
authenticated storage/import flows, production checks, migrations, BrowserStack/iPhone
VoiceOver, comprehensive unrelated backend suites. Health does not prove SQL or sign-in.
Candidate built/tested without replacing running services. Original local URLs remain
http://localhost:25221 and http://localhost:8080. Restart/stop instructions are in the
separate setup commit's docs/local-wsl-development.md; this task started/stopped no
persistent service, database container or volume.

Logs are local at /tmp/ayamai-reconcile-{install,typecheck,founder,frontend-tests,build}.log
and /tmp/ayamai-setup-{install,typecheck,build,web-build,membership-configured}.log.
Do not publish raw logs or environment files; reports contain no secret values.

## Windows work reviewed and preserved

No Windows checkout was advanced or cleaned. Fifteen modified tracked paths and five
untracked top-level entries remain. Windows normalized blobs do not equal current main;
none was assumed disposable. Ignored credentials/build outputs were left untouched.

| Work | Disposition |
| --- | --- |
| .gitignore, README.md | Local environment ignore and direct development Clerk loading guidance; keep separately for later portability review. |
| artifacts/api-server/src/index.ts | HOST binding plus host logging; setup commit already preserves equivalent optional binding, but original logging difference remains only in Windows. |
| artifacts/api-server/src/lib/membership.test.ts; artifacts/api-server/src/middlewares/membershipBoundary.ts | Narrow /access/me exception and regression. Preserve as alternative evidence; candidate retains broader Replit access-router reachability needed for invite validation/acceptance. |
| artifacts/private-media-library/package.json; pnpm-lock.yaml; pnpm-workspace.yaml | Windows native dependency support; not mixed into auth candidate. |
| lib/db/drizzle.config.ts | Windows schema-path normalization; preserved pending portability review. |
| package.json | Adds build:sachiel; preserved with extension scaffold. |
| product/START-HERE.md; product/handbook/AI-AGENT-GUIDELINES.md; product/handbook/TOOL-RESPONSIBILITIES.md; product/operations/SESSION-HANDOFF.md; replit.md | Older policy/handoff edits overlap newer canonical policy; preserve without overwriting newer documents. |
| Untracked AGENTS.md; CLAUDE.md; product/vision/STRATEGY-RECAP.md | Existing local policy/strategy material; left intact, not promoted as new approved direction. |
| Untracked extensions/sachiel/; scripts/build-sachiel.mjs | Unique permission-free Chromium popup scaffold and build script; inspected, retained, not part of auth reconciliation. |

## Release and rollback boundary

Candidate is for draft review only. Keep GitHub main, Replit current branch and production
unchanged. No currently serving release SHA is proven, so 3971bf2 is the verified GitHub
baseline, NOT a claimed production rollback image. Replit reports latest publication
record b5569d7d3ab7fa0364986286bdced8c796d89e66, build ID
fe40db0e-53c3-4662-9594-1f1fc052780e, with application content matching 12e965f;
that record is not independent serving-revision evidence. Do not redeploy older main
as an incidental rollback: it lacks founder repairs.

Next approval: review the security decisions above and authorize any merge/release
separately. Any production owner transfer additionally needs trusted identity/owner
inspection, exact expected-source approval and a plan to remove temporary transfer
configuration after real-session verification. Establish build-to-serving revision
evidence before declaring all surfaces synchronized.

## External effects

Created local setup and reconciliation branches/worktrees and commits. With explicit
owner approval, Replit pushed a NEW archival GitHub branch, independently fetched here.
The prepared candidate and separate setup branch are intended for non-force push and
draft review only. No merge to main, deployment, production access, secret exposure,
reset, clean, stash, force push, or original-worktree overwrite occurred.

## Exact candidate files relative to GitHub main

- .agents/memory/browserstack-auth-challenge.md
- .agents/memory/invitation-access-policy.md
- artifacts/api-server/src/lib/access-control.ts
- artifacts/api-server/src/lib/founder-access.test.ts
- artifacts/api-server/src/lib/membership.ts
- artifacts/api-server/src/middlewares/membershipBoundary.ts
- artifacts/api-server/src/routes/access.ts
- artifacts/private-media-library/src/App.tsx
- artifacts/private-media-library/src/components/access-check-error.test.tsx
- artifacts/private-media-library/src/components/access-check-error.tsx
- artifacts/private-media-library/src/hooks/use-access-status.test.tsx
- artifacts/private-media-library/src/hooks/use-access-status.ts
- artifacts/private-media-library/src/pages/join.test.tsx
- artifacts/private-media-library/src/pages/join.tsx
- artifacts/private-media-library/src/social/account-page.tsx
- docs/founder-access-recovery.md
- docs/watch-iphone-voiceover-verification.md
- package.json
- product/operations/SYNCHRONIZATION.md
- product/operations/RECONCILIATION-20261031.md (this report)

## GitHub-only commits preserved

```text
3971bf2c82aec4a0353865855e9867eeb386c66c Merge pull request #2 from markfoster314/chore/sync-workflow-20261031
58332966d56d0c0158e87ba88841499e410272cc docs: establish scoped delivery approval and synchronization audit
47388a680b5e0c1bfbfaf1e8f95b8cf19fac5d19 docs: capture exploratory Ayamai brand direction
6e807a09d7cd0d6f5ec3662357b64a56c9081413 Start Sachiel MVP definition
75a7f43e9ae60e6301db9d0fc997a3a85bf4ec81 Capture long-range Ayamai ecosystem brainstorming
807f53151139ad8054fbc05b73dd035e839820e2 Capture implicit and explicit preference learning direction
e35ac8c13ff946c17c8e8639c7a651ad9123b858 Capture active rediscovery and personal curation direction
6049acaee1af5567452e1febbd2196bb7c18308f Capture curated library plus visual grid preference
6b1162711853628ea5cf9250d141b77eb9e64b33 Capture library experience priorities
af62265e461c476e7ab36c34bc9898b98894daf1 Capture desktop workspace preferences and open question
c4b9916ab5539d8b8063aa39a5079a3c6c92bdb1 Document open product questions in product process
f449e18ea4b65b4a16311610471689399f7b62b6 docs(product): add Ayamai session handoff
ae09d1b5ca12e8f6d2b0afd97f85c658c408386e docs(product): record Ayamai current product and collaboration state
111fa8df4c464a542b602c3235ad85f83cb7c27d docs(product): capture exploratory mobile and desktop concept
b16d85ef3aed587177dd9eaa99b10ca50708dd2c docs(product): add initial Ayamai product vision
962ed4a63e833476fe15da5eb7e7ebbbb0c89c32 docs(product): add AI agent operating guidelines
495c2fb393603cabbfe6cc26ec215164a04b90a7 docs(product): define Ayamai tool responsibilities
390fc43cf8fd14c80c73f6f2d5818b0c4cf6eff0 docs(product): define idea-to-implementation lifecycle
06126620842945f76801f9a5e5ef2c364eb4a896 docs(product): define Ayamai collaboration principles
7fa0585f3490c81eb886c1f267a7a0f4b9cb25eb docs(product): add Ayamai product handbook entry point
```

## Replit-only commits preserved

```text
cefaf17d0e7e788ffcb2dc24baa5c4044745ce4e Add project documentation and agent guidelines
b5569d7d3ab7fa0364986286bdced8c796d89e66 Published your App
12e965f989a2f34d7d5e7647054d4c8924f090b4 Implement invitation access control policies and update join workflows
de3bae0d767c33b62eb55fd14e509d20a237bc2e Published your App
1cf69efeb8eafb43e1fa5335fc88cdd9eca9ccb5 Document deferred iPhone VoiceOver verification and required evidence
1286241700b161ab82063cc90cec33ab24b0eeec Implement founder access control logic and associated tests
38ce68c2722f08910978f29a8d19575fa794a3bb Published your App
```
