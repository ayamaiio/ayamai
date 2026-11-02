# Watch seek-slider screen-reader verification

## Result — supported Windows combinations passed

Verified on 2026-10-30 using actual BrowserStack screen-reader output, not an
accessibility-tree approximation:

| Browser / screen reader | OS | Tab reaches slider | Focus retained after Left / Right / Home / End | Explicit time spoken after every key | Matches visible preview |
| --- | --- | --- | --- | --- | --- |
| Chrome 156.0.8078.48 / NVDA | Windows 11 | Pass | Pass | Pass | Pass |
| Firefox 159.0 / NVDA | Windows 11 | Pass | Pass | Pass | Pass |

NVDA was BrowserStack-provisioned; its exact build was not exposed in the
provider response. These results do not imply that every NVDA version passed.

Both runs used the real Watch tile at the development-only `/__watch-lifecycle`
route with the public flower sample (5.055 seconds), not private account media.
The clip was paused and reset for deterministic comparisons. Tab and seek keys
were WebDriver keyboard actions; focus was never assigned with `focus()`.
The tests also checked the video position and ARIA value, preserved paused state,
and verified that seeking did not scroll the feed.

### Captured speech after the fix

Both browser runs captured these actual utterances:

| Key | Video position | Accessible value text | Spoken output |
| --- | --- | --- | --- |
| Right | 5 seconds | `0:05 of 0:05` | “Video position: 5 seconds of 5 seconds.” |
| Left | 0 seconds | `0:00 of 0:05` | “Video position: 0 seconds of 5 seconds.” |
| End | 5.005 seconds | `0:05 of 0:05` | “Video position: 5 seconds of 5 seconds.” |
| Home | 0 seconds | `0:00 of 0:05` | “Video position: 0 seconds of 5 seconds.” |

Repeated Right and Left also passed. A real pointer hold then showed
`0:05 / 0:05` in the visible preview, matching the spoken and accessible times;
screenshots from both remote browsers were inspected.
End deliberately stops up to 0.05 seconds before the end to avoid feed advancement.
All three time representations floor seconds consistently.

Chrome's Tab speech capture sometimes returned surrounding caption text as its
last chunk; DOM focus and all subsequent seek announcements were checked
independently. This is not a claim of a complete initial-focus speech transcript.

## Fix and regression coverage

Before the fix, Firefox spoke only percentages (“98”, “99”, “0”) despite correct
`aria-valuetext`. An immediate live-region update could be overwritten by the
native value event. A keyboard-only, polite announcement now follows that event
after 250 ms and names elapsed and total time explicitly. Repeated keys coalesce
to the latest position; blur and unmount cancel pending announcements.
Ordinary playback ticks never populate this live region.

Immediate slider-value updates remain in place so keyboard seeking does not
wait for a later `timeupdate`. Unit checks cover focus retention, value/text
consistency, explicit minute/second wording, all four keys, clamping, unknown
duration, rapid-key coalescing, blur/unmount cleanup, and silent playback ticks.
The complete web test suite passed: 129 tests across 24 files. The web app's
typecheck and the reusable runner's syntax check also passed.

## Reproduce

Start the existing API and web workflows. The runner uses existing
`BROWSERSTACK_USERNAME` and `BROWSERSTACK_ACCESS_KEY` secrets. It opens a private
BrowserStack Local tunnel and closes the session and tunnel in cleanup.
It may consume paid BrowserStack minutes.

```sh
WATCH_SR_BROWSER=Chrome node scripts/watch-screen-reader.mjs
WATCH_SR_BROWSER=Firefox node scripts/watch-screen-reader.mjs
```

If the web workflow port changes, set `WATCH_SR_APP_URL` to
`http://bs-local.com:<port>/__watch-lifecycle`. Only that local fixture route is
accepted. Recordings, provider debug screenshots, network logs, and console logs
are disabled. The runner explicitly takes one screenshot of the harmless clip
and writes it and the captured speech under ignored `generated-artifacts/`.
It never signs in, changes account data, or reads private media.

The speech endpoint returns transient last-spoken chunks. Capture promptly after
each key and poll briefly for the expected time; waiting several seconds before
the first read can miss an utterance and capture unrelated page text instead.
An assertion requires actual captured speech, not just the DOM live-region text.

## Provider limitations and untested combinations

- The original entitlement rejection was resolved after Accessibility access
  was enabled. Existing BrowserStack credentials then worked without replacement.
- A macOS 15.4 / Safari 18.4 session was created, but enabling the screen reader
  failed with `BROWSERSTACK_INCOMPATIBLE_COMMAND_PASSED`: “Screen reader command
  is only supported on Windows machines.” No VoiceOver pass is claimed, despite
  the broader availability wording in the public guide.
- Android TalkBack, iPhone VoiceOver, long clips, and seeking while playback
  advances were not part of this deterministic paused desktop matrix.
- The earlier headless preview capture failed to load the synthetic media and
  fell through to unauthorized fixture view-URL requests. The real BrowserStack
  runs loaded the public clip without changes to app authorization.

Provider reference:
https://www.browserstack.com/docs/accessibility/screen-reader-launcher/screen-reader-automation
