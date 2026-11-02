# Approved Ayamai logo — 2026-10-31

## Latest owner decision: release consolidation

The owner explicitly selected the exact recovered pale-blue logo currently shown
at localhost:25222 for the AWS release, and authorized committing, pushing and
deploying the finished work. This supersedes the earlier simplified compact SVG
and the PR-only delivery limit below. BrandMark now uses `brand/mark.png`;
favicons and Clerk branding use the matching recovered artwork. SVG wrappers
embed raster artwork; they are not editable vector masters. The separate
`wordmark.png` is retained for reuse, with existing live wordmark text unchanged.

The recovered composite is included as `brand/recovered-source-composite.png`.
It could not be proved byte-identical to the originally named chat attachment.
The older `approved-lockup.png` remains a historical reference, not displayed UI.
No landing layout, navigation, legal copy, authentication or data changes are
included in this consolidation. See the [release handoff](../archive/media-era/release-wind-down-2026-10-31.md).

The owner selected **row 1, column 3 (top-right)** in Product HQ, “Ayamai Product
Strategy” (`6ae544a3-d244-83ea-9830-de619895178a`), then supplied
`ayamai-logo-approved-top-right-reference.png` in the implementation chat.
This supersedes the earlier back-view/no-visible-face primary-logo description.
The profile faces right: do not mirror it or substitute an earlier concept.
The broader North Star UI reference remains a separate, missing asset.

## Assets

- [Approved lockup](../../projects/yoru/app/public/brand/approved-lockup.png):
  supplied 512 × 512 PNG, copied byte-for-byte. Includes illustration, precision
  lines, AYAMAI and アヤマイ. Retained as a reference asset; not placed on the
  landing page. This is raster
  artwork, not a vector master or newly generated illustration. Avoid enlargement.
- [Compact mark](../../projects/yoru/app/public/brand/mark.svg):
  original simplified vector derivative for navigation and small icons. Preserves
  the pale-blue bob, right-facing profile and dark negative space. Precision
  lines, collar accent and lettering are omitted at this scale. This adaptation
  is not a pixel-exact trace of the illustration.
- `public/logo.svg`: compact mark for Clerk branding.
- `public/favicon.svg`: compact mark on Deep Void with rounded corners.
- `public/favicon.ico`: PNG-backed 16, 32 and 48 px frames.
- `public/favicon-16x16.png`, `favicon-32x32.png`, `favicon-48x48.png`,
  `favicon-64x64.png`: browser exports.
- `public/apple-touch-icon.png`: 180 px; `public/icon-192.png` and
  `public/icon-512.png`: optional install-icon exports. The app has no web app
  manifest or service worker; no install behavior is introduced.

Shared `BrandMark` replaces only the existing navigation/sidebar and legal-header
symbol, retaining its 28 px footprint. Existing wordmark text, typography,
responsive visibility and spacing are preserved. Standalone vectors use existing
identity hex values. No new fonts or global tokens are introduced.

## Scope correction - 2026-10-31

The owner's latest instruction restricts PR #23 to logo/brand-asset replacement.
It supersedes this PR's earlier landing-lockup placement and editorial wordmark
integration. Landing TSX, CSS and tests, legal header markup and navigation
markup are restored as identical Git blobs to the PR merge base (`5199488`). The original
Glance portrait, live headings, Japanese text, red accent, layout, copy, responsive
styles, Enter flow and footer remain. The new `BrandWordmark` component and stale
redesign screenshots are removed. Logo approval does not authorize a landing or
navigation redesign. Broader North Star documents remain future guidance.

## Delivery

Only identity assets, consumers and documentation change. Entry routes, sign-in,
invitations, navigation, media, permissions and persistence keep their behavior.
The landing retains its entire existing composition and Glance artwork.

This task ends at a feature-branch PR. **Do not merge or deploy without owner
approval**, regardless of broader standing release permissions.
See [verification](brand-verification.md) for actual checks and limitations.
