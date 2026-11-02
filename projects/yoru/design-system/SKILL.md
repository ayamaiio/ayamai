---
name: ayamai visual language
description: Shared tokens and component usage for the dark, media-first ayamai product.
---

# ayamai

Use the exact lowercase product name **ayamai**. Rei Ayanami from Neon Genesis
Evangelion is the inspiration for the project's name and visual direction. The
supplied illustration is a color reference, not an app logo, background or
licensed character asset.

## Visual direction

- A sophisticated media collection, not a file manager or a garish adult portal.
- Default to dark indigo backgrounds, slate-blue emphasis and ivory text.
- Media is the primary content. Keep navigation, metadata and overlays restrained.
- Use Inter for interface text and IBM Plex Mono sparingly for technical metadata.
- Preserve mobile-first layouts, two-column Library browsing and Watch gestures.
- No orange brand accents, decorative noise textures or cream file-manager pages.
- Keep error/destructive and success/status colors semantically meaningful.
- Use visible keyboard focus, readable contrast and reduced-motion support.
- Personal labeling remains private; visual redesign never changes audience rules.

These guidelines derive from the user's branding brief. Light mode in the
catalog is a derived accessibility alternative, not the app's default.

## Maintenance

`tokens.json` is the single source of truth. Run `pnpm tokens` after edits; never
hand-edit generated CSS or token exports. Consumers import the workspace package,
not copies of its token values. See `docs/AGENTS.md` and the consumption guides.
