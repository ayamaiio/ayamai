# Design System Standardization 001

> **Historical — the media era.** This record describes the invite-only media
> product that preceded the platform. The current design language is
> [DESIGN.md](../../DESIGN.md); the logo is `ui/brand/mark.png` and its rules are
> `ui/brand.css`. Kept because it documents decisions, not because it is current.

Status: PASS for scoped implementation and local fixture verification (2026-10-31).

Branch: `codex/design-system-standardization`.
Base: `e6b37c9c7d2091cae51d7b466564b265570322b5`, the approved branding branch,
which is two branding commits ahead of inspected GitHub main
`51994887c5f456e10eea47a2553b0f4bead4a8e6`.
The checkout started empty with no user changes; fetched the repository and
created a separate feature branch. No commit, push, PR, merge or deployment.

The owner's Standardization 001 brief authorizes the focused styling work below;
it supersedes the older documentation-only limitation for these changes only.
[Why we build](../philosophy/WHY-WE-BUILD.md) and the
[approved logo](approved-logo.md) remain the product and asset references.

## Inventory and changes

- Colors: fallback errors used an unrelated gray palette; toast close controls
  used hardcoded red shades; shared modal backdrops used black. Replaced these
  with semantic theme colors and a Deep Void overlay token. Promoted existing
  subdued chart-derived success/warning aliases into the shared token source,
  including readable filled-state foregrounds. Hashtags use primary emphasis
  rather than warning. Existing anchor colors and light palette are unchanged.
- Typography: fonts loaded twice (HTML and CSS). Retained the existing HTML font
  loading for Inter, IBM Plex Mono and Cormorant Garamond. Shared card headings
  now use the same explicit size as dialog headings; error descriptions and
  technical diagnostics use existing body/monospace conventions.
- Icons: retained Lucide's existing default stroke and the shared button's 16px
  icon rule. Standardized the Watch action rail at 20px within its existing 48px
  controls. Added a default accessible label to the toast dismissal control.
- Components: consistent two-pixel focus rings for buttons and form controls;
  accent hover states for ghost/outline buttons; reduced small control/card
  shadows; destructive buttons now have their intended border. Native browser
  controls follow the active light/dark theme. Public component APIs, page
  structures, routes, breakpoints and application behavior remain intact.
- Build: fixed the token generator's Windows CLI detection using pathToFileURL.
  Edited tokens and the source template; regenerated CSS and portable tokens.

## Verification

- `pnpm typecheck`: PASS (entire workspace).
- `pnpm build`: PASS (entire monorepo, including typecheck). Existing frontend
  chunk-size advisory remains; no dependency or bundling changes made.
- `pnpm --filter @workspace/private-media-library test`: PASS, 28 files / 150 tests.
- `node --test artifacts/ayamai-design-system/scripts/tokens.test.mjs`: PASS,
  two checks covering 4.5:1 semantic text/feedback pairings in both themes and
  deterministic CLI regeneration on Windows. This is not a claim that every
  translucent or media-backed pairing has been contrast audited.
- `git diff --check`: PASS.
- Before/after Chromium screenshots: desktop 1440x1000 and mobile 390x844;
  landing, empty Library, search, collection filters, Watch empty state,
  account/settings and upload dialog. Compositions remain the same. Both
  landing image pairs are byte-for-byte identical. Approved application brand
  assets and landing files have no task diff.
- Synthetic Watch fixture: video readyState 4 and playback time advancing on
  desktop and mobile. Existing frontend tests cover media progress, gestures,
  Library browsing, filtering and navigation-related behavior.
- Fixtures intercepted API calls locally; no production access or private media.
  Live authentication, persisted uploads, populated private libraries and real
  mobile devices were not exercised. No structural redesign items identified.

Windows setup note: the existing lockfile deliberately excludes Windows native
build packages. Initial frontend test startup failed for missing Rollup native
support. Used matching native packages under the OS temporary directory through
NODE_PATH; did not change repository dependencies, lockfile or platform policy.
Playwright was also installed only in that temporary tool directory.

Screenshot evidence (local, outside the repository):
`C:/Users/admin/.codex/visualizations/2026/10/31/01a19465-13ab-7f71-8dc7-57411457fd42/ayamai-standardization/`.
`comparison.png` contains all seven before/after screen pairs at both sizes.
Temporary preview server was stopped after verification.

## Exact changed files
- `artifacts/ayamai-design-system/scripts/build-tokens.mjs`
- `artifacts/ayamai-design-system/scripts/theme-template.css`
- `artifacts/ayamai-design-system/scripts/tokens.test.mjs`
- `artifacts/ayamai-design-system/src/components/ui/alert-dialog.tsx`
- `artifacts/ayamai-design-system/src/components/ui/badge.tsx`
- `artifacts/ayamai-design-system/src/components/ui/button.tsx`
- `artifacts/ayamai-design-system/src/components/ui/card.tsx`
- `artifacts/ayamai-design-system/src/components/ui/dialog.tsx`
- `artifacts/ayamai-design-system/src/components/ui/drawer.tsx`
- `artifacts/ayamai-design-system/src/components/ui/input.tsx`
- `artifacts/ayamai-design-system/src/components/ui/select.tsx`
- `artifacts/ayamai-design-system/src/components/ui/sheet.tsx`
- `artifacts/ayamai-design-system/src/components/ui/textarea.tsx`
- `artifacts/ayamai-design-system/src/components/ui/toast.tsx`
- `artifacts/ayamai-design-system/src/generated/tokens.tsx`
- `artifacts/ayamai-design-system/src/index.css`
- `artifacts/ayamai-design-system/tokens.json`
- `artifacts/private-media-library/src/components/error-boundary.tsx`
- `artifacts/private-media-library/src/index.css`
- `artifacts/private-media-library/src/social/private-label-sheet.tsx`
- `artifacts/private-media-library/src/social/social-tile.tsx`
- `docs/design/standardization-001.md`
- `product/operations/SESSION-HANDOFF.md`
