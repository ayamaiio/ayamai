---
name: Screen-reader speech verification
description: Real speech evidence, native slider event ordering, and BrowserStack capture timing.
---

Do not equate correct slider ARIA values with correct spoken time. Verify actual
utterances in each tested browser/screen-reader pair.

**Why:** NVDA on Firefox spoke percentages despite correct time-valued ARIA text.
An immediate live-region update was lost behind the native slider value event;
a delayed keyboard-only announcement preserved explicit time. Playback ticks
must not generate continuous position announcements.

**How to apply:** Keep announcements scoped to deliberate seeks, coalesce rapid
input, and cancel pending speech on blur or unmount. Preserve common whole-second
rounding across spoken time, ARIA text, and the visible preview.

BrowserStack's speech endpoint can return only the latest transient chunk, not
a full transcript.

**Why:** A late capture returned surrounding page captions after a correct seek
announcement had already occurred.

**How to apply:** Read promptly after each key and briefly poll for the expected
utterance. Retain observed chunks as evidence; never substitute DOM text for
missing speech. Check live provider support before promising VoiceOver coverage:
the service has rejected macOS commands despite public documentation advertising
macOS support.
