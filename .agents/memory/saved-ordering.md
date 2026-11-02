---
name: Saved collection ordering
description: Why Saved uses stable pagination without claiming newest-save ordering.
---

Saved browsing uses a deterministic order, not a promise of newest-saved-first.

**Why:** Historical saves have no recorded save time. Inventing historical timestamps or re-saving them would imply chronology we do not know. Stable cursors also avoid skipping a result when a preceding item is unsaved.

**How to apply:** If adding newest-save ordering later, explicitly decide how undated historical saves sort and preserve cursor stability under removals. Do not present upload or publication time as the time a user saved a post.
