# Implementing the Ayamai North Star

**Status:** Future implementation guidance. This PR authorizes documentation only.
Read [visual identity](visual-identity.md) first and use the [checklist](design-checklist.md) for review.

The separately authorized [approved logo refresh](approved-logo.md) supplies the
primary identity assets. Use its right-facing profile for navigation instead of
the earlier back-view description. This does not authorize the broader screen
redesign below or resolve the missing North Star UI reference.

## Before changing a screen

1. Obtain the original approved PNG at the path documented in the identity record. Its absence must be reported; do not invent a substitute.
2. Inspect the existing app in `artifacts/private-media-library/`, shared UI in `artifacts/ayamai-design-system/`, its token source and nested agent instructions. Record existing Library and For You behavior before proposing changes.
3. Define a separate, explicitly authorized visual implementation scope. Keep existing routes, data flow, authentication, permissions, media delivery, uploads, playback and persistence intact.
4. Compare current styles with the approved palette and art hierarchy. Existing code describes current implementation; the North Star describes the approved visual target.

## Suggested delivery sequence — not work performed by this PR

- Inventory current tokens, typography, navigation, media cards and artwork. Map semantic tokens to identity roles centrally rather than scattering hex values in React components.
- Review contrast and interaction states, then propose shared primitive updates in a separate feature branch.
- Build a reviewable local composition using original identity art and non-private fixture media. Keep Silent Observer primary and Glance secondary.
- Apply approved styling incrementally to existing components, then review desktop and mobile Library and For You before expanding.

Do not replace the application with a screenshot, rebuild screens wholesale, copy generated mockup labels as product requirements, or change business logic as a styling shortcut.

## Daily library adaptation

Use a compact header or reduced atmospheric area instead of the mockup's oversized hero. Keep browsing content, search, filters and navigation prominent at ordinary viewport sizes. A large editorial hero is reserved for special moments; its exact dimensions need review in the real layout. Include AYAMAI once per screen, with a single clear identity anchor.

Preserve useful thumbnail space and readable titles. Align metadata precisely; reduce decorative controls and archive ornament before reducing content usability. Avoid heavy color overlays that obscure media.

## Typography and behavior

Use the existing font stack as the first candidate. Editorial titles may have stronger hierarchy; technical metadata may use restrained tracking or an existing monospace face. Avoid excessive uppercase, tiny metadata and decorative pseudo-technical copy.

Validate contrast, keyboard navigation, visible focus, selected/hover/disabled/error states, touch targets, zoom and responsive overflow. Do not communicate state through color alone. Respect reduced motion. Give meaningful art appropriate alternative text; decorative art should not create repeated announcements.

## Verification for a future implementation

Capture comparable local desktop and mobile views of Library and For You with fixture content. Review against the original image plus its approved corrections. Test affected interactions and use the repository's current checks appropriate to the actual code changes. Confirm media, authorization and stored preferences behave as before.

This documentation PR requires diff and relative-link review only. It changes no tokens, components, screens, configuration or infrastructure. No production access, merge or deployment is authorized. Keep the snapshot tooling and shared handoff changes in PR #17 separate.
