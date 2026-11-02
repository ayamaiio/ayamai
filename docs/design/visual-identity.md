# Ayamai North Star v1 — visual identity

**Status:** Owner-approved visual direction; documentation only, not implemented.
**Recorded:** 2026-10-31.
**Authority:** The owner's explicit North Star preservation request, continuing Product HQ, “Ayamai Product Strategy” (6ae544a3-d244-83ea-9830-de619895178a).
**Target:** The future appearance of aws.ayamai.io, preserving the working application.

## Approved direction

75% Ethereal Rei / 25% Evangelion Technical Archive. The ratio describes visual emphasis, not a measurable layout formula: atmosphere and quiet beauty lead; precise archive structure supports them. Feel intimate, mysterious, restrained and polished. Avoid generic cyberpunk, neon overload, gaming-dashboard chrome and anime fan-site styling.

This record supersedes the undecided logo, palette and visual-direction questions in [the earlier exploration](../archive/product-handbook/ideas/brand-direction.md). It does not approve a screen rewrite, functionality changes or a release.

## Landing and sign-in treatment

**Owner-approved:** Keep the landing page image-led and deliberately quiet. The original artwork, dark blue palette, editorial typography, Japanese wordmark and restrained red accent create intrigue without explaining the product. Show AYAMAI once, keep the tagline "A quiet place to get lost," and provide one understated "Enter" action leading to sign-in. Keep only the age marker and low-key privacy, terms and contact links in the footer. Do not add feature explanations, pricing or a donation ask.

The sign-in and invitation flows retain their existing behavior within the same palette and typography, with a clear return path and policy links. Direct invitation URLs continue to open the invitation flow. This direction supersedes the more explicit product and invitation copy previously shown on the public landing page.

## Identity and art hierarchy

**Logo update, 2026-10-31:** The owner subsequently approved the top-right
right-facing profile and supplied its exact PNG. [Approved logo](approved-logo.md)
supersedes the back-view/no-visible-face primary-logo description below. Glance
remains secondary art. The missing North Star UI reference is a different asset.

- **Silent Observer — primary character logo:** original pale-blue-haired girl viewed from behind, short asymmetric bob, no visible face. Quiet, recognizable silhouette; use as the principal identity mark in navigation.
- **Glance — secondary artwork:** original pale-blue-haired girl in partial side profile, one subdued crimson eye emerging from shadow. Atmospheric editorial art, not a replacement for the primary logo or navigation.
- **Wordmark:** AYAMAI, elegant and widely spaced. Show it only once within a screen composition. Optional secondary text: アヤマイ. Tagline: “A quiet place to get lost.”
- Treat Rei / Evangelion as creative inspiration for original artwork, not permission to copy character assets. These descriptions establish art direction, not delivered final logo files.

## Palette

| Name | Hex | Intended role |
| --- | --- | --- |
| Deep Void | #0B0D14 | Dominant dark canvas |
| EVA Blue | #202A5A | Indigo surfaces and structural depth |
| Rei Blue | #A9B7E8 | Restrained highlights, selection and identity cues |
| Pale | #E6ECFF | Primary text and light detail |
| Alert Red | #E53935 | Sparse alerts and deliberate accent |

Dark mode first. Keep red scarce; never make the whole interface an alarm. These are identity colors, not a guarantee that every pairing passes contrast. Validate each interactive and text pairing before implementation.

## Typography, voice and composition

Use editorial hierarchy for titles and precise technical text for metadata, archive labels and controls. Keep body copy readable and understated. Technical detail belongs in useful labels, thin dividers and aligned metadata, not decorative noise. No new font family is approved here; review existing fonts before choosing one.

Media leads: generous thumbnails, clear content hierarchy, minimal visual interference, and calm spacing. Navigation and controls must remain easy to find. The cinematic image is a mood and composition reference, not a pixel-perfect screen specification.

## Approved corrections to the mockup

Reduce the hero for everyday Library and For You browsing so content and core controls remain prominent. Reserve a large Glance treatment for special editorial moments. Show the wordmark once. Mockup thumbnails are illustrative placeholders, not actual library content or required assets.

## Reference image availability

Expected repository asset: `docs/design/ayamai-north-star-v1.png`.
Original supplied location: `/mnt/data/a_cinematic_dark_themed_ui_mockup_of_the_ayamai_me.png`.

The supplied file was inaccessible in this Windows session. The referenced chat returned no image attachments. The PNG is therefore **not included** in this revision; no replacement or regenerated image is represented as the approved reference. This document preserves the owner's supplied decisions, not a claim of visual inspection.

When the original is accessible, copy it unchanged to the expected repository path, inspect it, and add a relative preview here. Do not infer missing visual details from memory. Image-dependent fidelity review remains pending.

Next: [implementation guide](implementation-guide.md) and [design checklist](design-checklist.md).
