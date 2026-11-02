---
name: Library browsing restoration policy
description: Rationale for browser-local account bookmarks and missing-anchor fallback.
---

Treat Library browsing position as a browser-local convenience, isolated by authenticated account. If the saved media no longer matches the current filters, restart at the beginning of those filters instead of guessing from an old numeric page position.

**Why:** A numeric offset can point to unrelated media after deletions, imports or edits. Keeping the filters and starting at a known boundary is more predictable, and restoring an anchor must not require downloading all earlier pages.

**How to apply:** Preserve this behavior when changing Library pagination or persistence. Cross-device synchronization would be a separate product capability rather than an implicit part of local restoration.
