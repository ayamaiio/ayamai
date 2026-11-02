---
name: Product analytics privacy
description: Keep aggregate external product analytics separate from detailed recommendation behavior.
---

Keep externally hosted product analytics limited to aggregate outcomes and
fixed categories. Do not forward first-party recommendation events, content
identifiers, sexual-interest labels or free-form collection content.

**Why:** This product holds sensitive private collections and labeling data.
Measuring feature usage does not require exporting users' content or interests.

**How to apply:** Use a narrowly allowlisted analytics boundary. Keep detailed
recommendation telemetry first-party and separate. Custom-payload redaction
does not imply that platform automatic pageview URLs have been redacted.

Video views represent qualifying account/video/UTC-day plays, not lifetime
unique people. Three seconds of actual foreground playback qualifies; loops
and retries within that day must not inflate the total.

**Why:** This distinguishes meaningful viewing from previews and quick swipes
while allowing a genuine return on a later day. Stable metric semantics matter
when comparing totals over time.

**How to apply:** Respect behavioral-tracking opt-out, never invent historical
counts, and keep visibility-at-viewing boundaries: private watching must not
turn into public view history when a post is published. Expose totals only,
not viewer identities, and do not export this first-party history to analytics.
