---
name: Native touch automation
description: Distinguish BrowserStack iOS driver input quirks from Watch gesture failures.
---

Check trusted native pointer coordinates and timing before attributing a failed
hold gesture to Watch. Do not weaken hold detection to accommodate incorrectly
generated automation input.

**Why:** On real iOS Safari, the driver delivered touch coordinates offset from
DOM viewport coordinates and interpolated movement across a requested pause.
The app correctly rejected that movement before its hold threshold. The same
driver also rejected a standalone pointer release in a later request.

**How to apply:** Measure viewport mapping with trusted input rather than using
a fixed device-specific offset. Encode holds with an explicit stationary
waypoint, keep a gesture within one native action sequence, and retain native
event traces when diagnosing a failure. Desktop emulation is not confirmation
of Safari cancellation or pointer-capture behavior.
