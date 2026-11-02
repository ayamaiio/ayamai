---
name: iOS Safari video lifecycle ordering
description: Real iOS Safari can pause a playing video before reporting the page hidden.
---

On real iOS Safari, backgrounding can emit the video's `pause` event while the document is still visible, followed by `visibilitychange` to hidden roughly 128 ms later. Preserve pre-hide playback intent only for a short window, and make explicit user pauses cancel that intent.

**Why:** A real BrowserStack Safari run showed that reading only `video.paused` during `visibilitychange` loses the prior playing state and prevents the same clip from resuming.

**How to apply:** For Watch lifecycle changes, cover pause-before-hidden ordering and verify manual pause, autoplay-off, and active-tile changes still prevent resume. Prefer real Safari evidence over desktop tab tests alone.
