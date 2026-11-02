# Logo-only scope correction verification - 2026-10-31

PR #23, branch `feat/approved-ayamai-brand`; reviewed head before correction:
`8f6f9efcc9027d07f1b17b519e7a4e70380c369e`.
PR merge base: `51994887c5f456e10eea47a2553b0f4bead4a8e6`.
The checkout was clean before this task; sibling worktrees were untouched.

## Review findings and applied correction

The original PR exceeded logo scope: landing.tsx replaced the live heading and
Japanese text with a square lockup, removed the atmospheric portrait and red
accent; landing.css centered the hero, disabled its overlay and changed mobile
spacing. BrandWordmark changed navigation/legal typography and hid navigation
text below 420 px. These changes were removed.

The Git blobs for landing.tsx, landing.css, landing.test.tsx, legal.tsx and
social/app-nav.tsx now exactly match the merge base (normal Git line-ending
conversion applies to the Windows working files). No landing layout, copy,
flow, styling or behavior changes remain in this PR. BrandWordmark and all five
obsolete redesign screenshots were removed. No new screenshots are claimed.

Kept: supplied full lockup as an unused reference asset; compact mark, Clerk
logo, SVG/ICO/PNG favicons and touch/install icon exports; index.html icon links;
shared BrandMark symbol replacement with its original 28 px footprint; legal
tests that allow only the expected decorative brand image. Existing wordmarks,
fonts, visibility rules, application routes and global styles remain unchanged.
North Star design documents are future guidance, not landing-redesign authority.

## Current validation

- `corepack pnpm@10.34.9 --filter @workspace/private-media-library test`:
  28 files / 150 tests passed, including restored landing and updated legal tests.
- Full workspace typecheck passed as part of `corepack pnpm@10.34.9 build`.
- Full workspace build passed with `PORT=25229`, `BASE_PATH=/`.
  Existing frontend chunk-size warning remains. Generated build side effects
  outside the task scope were restored before committing.
  Initial build without these required settings stopped at Vite configuration;
  no source/configuration changes were made to bypass the requirement.
- Git blob comparisons confirm the five restored files exactly match the base.
- `git diff --check`: passed.

## Limits and release boundary

Existing icon assets were retained unchanged from the reviewed head; the earlier
asset verification recorded source SHA-256
`a8085ea52f9af5c49d76005277db4952712012fd6c491bdcf47edf23983862b1`.
The compact SVG remains a simplified adaptation, not an exact vector master.
The app has no manifest; no install behavior is introduced.

No browser visual check or live sign-in/media/database flows were run for this
correction. Landing preservation is established by exact source restoration and
tests. No server was started, production accessed, merge performed or deployment
requested. Delivery ends at an update to the existing review PR.
