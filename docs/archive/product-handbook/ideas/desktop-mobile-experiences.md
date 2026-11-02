# Mobile and Desktop Experience — Exploration

**Status:** Exploring
**Owner approval:** Not approved as a committed feature or implementation specification.
**Origin:** Product brainstorming, October 2026.

## Initial concept

Ayamai may benefit from two complementary experience modes because people often use phones and desktop devices in different contexts.

### Mobile hypothesis: discovery and consumption

Potential emphasis:
- Scroll-based discovery and feed consumption
- Short-form media viewing
- Recommendations
- Quick reactions, saving, and lightweight organization
- Fast capture or importing from elsewhere

The intended feeling is immediate, immersive, and effortless.

### Desktop hypothesis: gathering, curation, and longer-form consumption

Potential emphasis:
- Uploading and importing content
- Browsing and managing the library
- Organizing collections and metadata
- Reviewing and curating content
- Longer-form video consumption while working with the library

The intended feeling is a beautiful, capable personal media workstation.

### Desktop workspace direction under exploration

The owner currently leans toward a **hybrid workspace** rather than a purely library-first or video-first desktop.

A possible experience could let a user watch a longer video while browsing, uploading, or organizing media, without constantly navigating away from the player.

Current preferences expressed during exploration (not implementation requirements):
- The desktop experience should be a customizable workspace made from predefined panels, rather than a completely freeform window manager.
- Panels may be movable, resizable, hideable, showable, or combinable.
- Ayamai should remember the workspace as it was left, including panel arrangement and sizes, player state, and current activity, so the user can resume on return.

Possible concepts to explore later—not requirements:
- Persistent or docked video player
- Resizable player and library panels
- Picture-in-picture
- Background playback while navigating
- Dedicated media-management workspace

## Important design constraint

This should not become a rigid feature split where some capabilities are unavailable on one device.

A working hypothesis is that core capabilities remain available across devices while layout, navigation, and emphasis adapt to context. Tablets may need separate consideration rather than being treated automatically as large phones or small desktops.

## Open Product Questions

These questions are intentionally unanswered. They are not blockers or requirements; revisit them before finalizing the desktop workspace interaction model or committing dependent implementation.

### Multiple instances of the same panel

**Question:** Should users be able to open multiple instances of the same panel type at once—for example, two library panels showing different collections, or multiple video players?

**Status:** Intentionally deferred — the owner has no current preference.

**Revisit when:** Evaluating or finalizing the desktop workspace interaction model, before committing to its detailed behavior.

Do not infer a yes or no from the examples. Keep both possibilities open until there is a concrete use case or design context that makes the tradeoff clearer.

### Other open questions

- What should the default desktop landing experience be?
- How should the player coexist with library browsing and upload workflows?
- Which tasks genuinely benefit from desktop precision and screen space?
- Which mobile actions should be optimized for one-handed, low-friction use?
- How should tablet and small-window layouts behave?
- Should the user be able to customize the balance between consumption and management?

## Next exploration

Discuss concrete usage scenarios before designing screens or selecting implementation patterns. For example:
1. Watching a long video while reviewing and organizing the library.
2. Uploading several files while continuing to browse existing media.
3. Discovering something on mobile and saving it immediately.
4. Returning to a saved collection on desktop to curate metadata.

Do not create Linear issues or implementation work from this document until the owner explicitly commits to a direction.
