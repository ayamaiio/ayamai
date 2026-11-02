# North Star design review checklist

> **Historical — the media era.** This record describes the invite-only media
> product that preceded the platform. The current design language is
> [DESIGN.md](../../DESIGN.md); the logo is `ui/brand/mark.png` and its rules are
> `ui/brand.css`. Kept because it documents decisions, not because it is current.

Use with [visual identity](visual-identity.md) and [implementation guide](implementation-guide.md).
Unchecked items are review criteria, not claims that the current app passes.

## Reference and scope

- [ ] Original approved PNG is available at `docs/design/ayamai-north-star-v1.png` and has been visually inspected. Currently pending: original inaccessible.
- [ ] Review distinguishes approved direction, proposed implementation choices and verified behavior.
- [ ] Implementation has its own authorized scope; no screen rewrite or release is inferred from this documentation.

## Identity

- [ ] Overall balance reads as 75% Ethereal Rei / 25% Evangelion Technical Archive.
- [ ] The [approved top-right right-facing profile](approved-logo.md) is the primary logo; Glance is secondary atmospheric art.
- [ ] Artwork is original and follows the documented silhouette/profile roles.
- [ ] AYAMAI wordmark appears once per screen.
- [ ] Deep Void #0B0D14, EVA Blue #202A5A, Rei Blue #A9B7E8, Pale #E6ECFF and Alert Red #E53935 guide semantic color use.
- [ ] Red is sparse; chrome avoids excessive neon and gaming-dashboard styling.

## Everyday browsing

- [ ] Library and For You prioritize media and core controls.
- [ ] Hero is reduced for daily use; large cinematic treatment is reserved for special moments.
- [ ] Thumbnails remain clear and generous; placeholders are not mistaken for actual media.
- [ ] Titles are editorial; metadata and controls use precise, readable technical text.
- [ ] Dividers, alignment and spacing provide archive structure without visual clutter.
- [ ] Desktop and mobile compositions retain usable navigation, search and filters.

## New control

Before adding a button, input, switch or chip:

- [ ] is there a primitive in `ui/ui.css` for it - `.btn`, `.btn.ghost`, `.input`,
      `.seg`? If not, add the primitive there first, then use it;
- [ ] does it set (or inherit) `appearance: none`? A button left at `auto` is
      white in WebKit and in forced colours; `background: none` does not hide it;
- [ ] does it use tokens rather than hex values (`var(--line)`, `var(--red)`);
- [ ] does the label survive a keyboard: focus ring, `aria-pressed` for a switch,
      `:disabled` for something that cannot be pressed;
- [ ] did `node scripts/style-audit.mjs <pages>` report zero offenders?

## Who links the kit

`ui/controls.test.mjs` and `ui/tokens.test.mjs` enforce this for every page that
links it; the list below is the honest state, not the goal.

| surface | links the kit | notes |
|---|---|---|
| the door (`/`) | yes | migrated 2026-11-02, tokens renamed |
| the shelf (`/play/`) | yes | a service since 2026-11-02 |
| gehirn, and its code browser | yes | the browser still carried the 2024 palette until it was caught |
| yoru | its own design system | `@workspace/ayamai-design-system`, kata's tokens |
| yoru's curator page (`/curator/`) | yes | migrated 2026-11-02: it had its own `--eva`, now `--line` |
| tsukai's extension popup | **no, on purpose** | it ships inside the browser extension; a remote stylesheet is not something an extension can rely on |
| uta | yes | the template: migrated 2026-11-02 (`--bg`→`--void`, sort is `.seg`, inputs and buttons are the kit's) |
| seiri | yes | migrated 2026-11-02 after uta: media-era palette gone, forms are `.input` / `.btn.sm` |
| gemu (the shelf) | yes | migrated 2026-11-02: media-era palette gone, tiles keep their own shape |
| gemu's itch · systems · handheld pages | yes | migrated 2026-11-02; the handheld inlines tokens because an @import in a <style> resolves against the page |
| hisho · kata · fude · tsukai | yes | migrated 2026-11-02 in one pass: media-era palette gone from all four |

uta is the worked example: its palette moved to the kit's names (`--bg`→`--void`,
`--ink`→`--pale`, `--live`→`--red`, `--lilac`→`--rei`, its own pale→`--muted`),
its sort pair became `.seg` with `aria-pressed`, and its inputs and buttons became
`.input` / `.btn`. The rest is the same job, one page at a time, and each is a
visual decision rather than a rename. Until then, `appearance: none` is enforced
on the pages that do not link the kit by `ui/controls.test.mjs`.

## Accessibility and regression review

- [ ] Text and control contrast are measured for actual pairings; state is not color-only.
- [ ] Keyboard focus, touch targets, zoom, responsive overflow and reduced motion are reviewed.
- [ ] Artwork alternative text is appropriate and avoids redundant announcements.
- [ ] Existing upload, playback, filtering, selection and stored preferences still work.
- [ ] Authentication, permissions, privacy, ownership, routes and media delivery remain intact.
- [ ] Comparable local screenshots and relevant checks are attached to the future implementation review.
- [ ] Remaining visual uncertainty and departures from the reference are explicitly reported.

## Documentation-only package review

- [ ] Relative documentation links resolve.
- [ ] Diff contains documentation only and excludes PR #17 files.
- [ ] Missing original image is disclosed without a substitute or broken preview.
- [ ] PR ends at review: no merge, deployment or production access.
