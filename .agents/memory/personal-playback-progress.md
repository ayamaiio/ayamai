---
name: Personal playback progress
description: Playback markers are private viewing history; distinguish browser-local fallback from shared metadata and cross-device sync.
---

Playback position belongs to the viewer, not to a public post or its followers.
Never expose the poster's position as another viewer's personal progress.

**Why:** A shared video's public visibility and follower-visible reviews do not
authorize disclosure of the poster's private viewing history.

**How to apply:** Centralized resume storage must be keyed and authorized per
viewer. Reuse legacy owner-only positions only when that owner's personal
bookmark is absent; never write a shared viewer's position into owner metadata.
Browser-local progress indicators are not authoritative for cross-device
resume and must not override a fresh authorized server read.
