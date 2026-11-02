# Watch touch seeking — real-device results

Test date: 2026-10-30. Tested against the development workflow through BrowserStack
Local, not a production deployment. Native Appium/W3C input was used on real
devices, not jsdom, desktop touch emulation, or manually dispatched events.

## Matrix

Device/OS values below are the requested BrowserStack configurations. Both
devices loaded and played the harmless public CC0 flower MP4 in the
development-only multi-card Watch fixture.

| Check | iPhone 15 / iOS 17 / Safari | Pixel 8 / Android 14 / Chrome |
| --- | --- | --- |
| Horizontal hold-and-drag commits media seek and resumes the active clip | Pass | Pass |
| Vertical swipe changes card without seeking or replaying previous clip | Pass | Pass |
| Held vertical gesture is natively cancelled without seeking/replaying previous clip | Pass | Pass |
| Switching cards during held horizontal seek never restarts inactive media | Pass | Pass |

No production interaction changes were necessary.

## Evidence

The initial Android run passed all four cases. On iOS, the first three passed
after correcting the driver's coordinate mapping and hold interpolation. The
last case initially hit an unsupported cross-request `pointerUp`; a focused
card-switch run with the corrected single-request sequence then passed on
**both** devices. The matrix combines these runs; it is not a claim that every
case passed in one unchanged full-suite run.

BrowserStack session labels:

- Android full suite: `Watch lifecycle android 2026-10-30T20:28:57.702Z`
- iOS first three cases: `Watch lifecycle ios 2026-10-30T20:32:48.844Z`
- iOS card-switch follow-up: `Watch lifecycle ios 2026-10-30T20:34:14.676Z`
- Android card-switch follow-up: `Watch lifecycle android 2026-10-30T20:34:36.829Z`

Sanitized runner stdout from this workspace is under the ignored
`generated-artifacts/` directory:

- `watch-mobile-gestures-android.log`
- `watch-mobile-gestures-ios-waypoint.log`
- `watch-mobile-gestures-ios-switch.log`
- `watch-mobile-gestures-android-switch.log`

Earlier diagnostic logs there show the Safari coordinate offset and native
event timing. They are test outputs, not versioned application assets. Every
session and Local tunnel was closed; screen recording was disabled. No account
sign-in or private library content was used.

## Scope and limits

The fixture mounts the real Watch tile, gesture layer, and playback lifecycle.
It reproduces native feed snapping and card activation without server-generated
posts, telemetry writes, or consent bypasses. Native scrolling, pointer capture
loss/cancellation, committed media seeking, and inactive-video state were checked.
Authenticated feed access and recommendation behavior were not part of this
check.

This covers the two requested configurations in portrait orientation, not every
phone, OS version, orientation, assistive technology, or background/lock state.
The existing lifecycle suite remains separate. The 38 targeted jsdom unit tests
also passed; those are supporting regression checks, not the real-device
evidence above.
