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
