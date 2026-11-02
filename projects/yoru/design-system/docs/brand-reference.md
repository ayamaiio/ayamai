# ayamai brand reference

## North Star v1 supersession — 2026-10-31

The owner approved the visual direction preserved in [North Star identity](../../../docs/design/visual-identity.md). Read its implementation guide and checklist before visual work. It supersedes conflicting older palette, mascot and refinement-only guidance below: Silent Observer is the primary character logo; Glance is secondary original art. The original mockup PNG is currently unavailable. This is documentation of a target, not an implemented redesign or release authorization. Existing compatibility and privacy requirements remain applicable.

## Earlier reference (historical where superseded)


## Source and intent

The product name is **ayamai**; its mascot/inspiration is Rei Ayanami from Neon
Genesis Evangelion. The user requested a sleek,
technical, sophisticated product rather than a garish adult-site aesthetic.
The supplied Rei Ayanami illustration is classified as **inspiration**, subject:
character illustration / color reference. It supplies muted blue, indigo and
ivory cues, not a UI layout or component inventory. The image is not bundled,
used as a logo, or presented as product-owned artwork.

This is a generated design system: the complete scaffold component catalog is
themed by the new tokens. It is not an import of the former app's styles.
Product-specific compositions remain in the app; shared primitives and tokens
are imported from this package. No playback or privacy behavior is redesigned.

## Palette decisions

Dark is the app default. Near-black indigo backgrounds separate elevated blue
surfaces from media. Pale slate-blue primary actions use dark text; body text is
ivory, and supporting copy uses muted slate. Destructive actions use a restrained
rose. Success uses chart-2; warning uses chart-4, never the old orange brand.
Light is a derived alternate, not extracted from a source UI.

All values live in `tokens.json`. Maintain WCAG AA normal-text contrast (4.5:1)
for foreground/background, mutedForeground/background, primaryForeground/primary,
cardForeground/card and destructiveForeground/destructive in both modes.
Focus rings must be visible and motion must respect reduced-motion preferences.

## Existing app compatibility

Keep legacy browser-storage prefixes unchanged so a brand rename never resets
autoplay settings, account-specific bookmarks or feed sessions. Never rename API
routes, storage buckets, database objects or authentication tenants for a visual
rebrand. Public/private and personal-labeling boundaries remain unchanged.
