---
name: Watch recommendation cycles
description: Stable ordering and private signal boundaries for personalized Watch feeds.
---

Keep a Watch feed cycle's item order fixed after it is created. New reactions and viewing signals should influence the next cycle rather than reshuffling already loaded pages.

**Why:** Changing order while the viewer scrolls can repeat or skip items, breaking the no-repeats guarantee.

**How to apply:** Persist a per-account session order, use only that account's feedback when ranking a new cycle, and keep explicit reactions distinct from inferred viewing signals and Saved/Favorites.
