# Watch fading controls — iPhone VoiceOver verification

## Status: deferred by user; no real-device pass

On 2026-10-31, the user chose to keep this verification deferred rather than
provide a human-operated iPhone or BrowserStack Live session. The checks below
remain unperformed. Closing the current work does not establish accessibility
approval; resume this checklist when real-device testing is available.

On 2026-10-30, the available test runner and current BrowserStack documentation
were checked. No iPhone VoiceOver session was operated, no spoken output was
captured, and none of the checks below has passed yet. This is a preparation
record, not real-device evidence or a completed accessibility verification.

The existing `scripts/watch-screen-reader.mjs` covers desktop Windows/NVDA
seeking only. BrowserStack documents iPhone VoiceOver under **Live**, requiring
an enabled private-beta feature on Team Pro or Enterprise Pro. Account access
to that feature has not been established. Its screen-reader automation API
documents Windows/macOS, not iOS. Ordinary iPhone WebDriver taps, keyboard DOM
events, and screenshots cannot establish VoiceOver virtual-focus behavior.

References checked:
- https://www.browserstack.com/docs/live/accessibility-testing/screenreader-ios
- https://www.browserstack.com/docs/accessibility/screen-reader-launcher/screen-reader-automation

## Required setup

- A human-operated physical iPhone running Safari with VoiceOver, or an
  authenticated BrowserStack Live session with iOS Screen Reader enabled.
- An authorized test account and a benign synthetic clip owned by that account,
  with a known caption. Keep unrelated/private media out of the session.
- The human operator must handle sign-in and any consent or age attestations.
  Do not bypass access gates or collect one-time codes in chat.
- Obtain permission before recording screen/audio. Record only harmless test
  content; omit sign-in, codes, account details, and session links.
- Use the development app. Do not change production routing, bucket access,
  infrastructure, or edge canary configuration.

## Pending checks

Run with auto-hide enabled first, in both Feed and Saved. Record device model,
iOS/Safari version, VoiceOver language, date, and app revision.

| Check | Procedure and expected result | Result |
| --- | --- | --- |
| Reveal after inactivity | Play the clip and wait at least 3 seconds without interaction. Navigate with VoiceOver to the media surface and activate it. Controls become reachable without pausing or liking. | Not run |
| Navigation and actions | Traverse next/previous through navigation, Like, Comments, and Feed settings after revealing. Capture actual spoken names and order; no action occurs merely from moving VoiceOver focus. | Not run |
| Continued reachability | Wait beyond the fade interval while VoiceOver focus is on a control or caption. Continue traversal and activation. Focus must not strand the viewer; controls must remain accessible or have a discoverable reveal path. | Not run |
| Like isolation | Activate Like once, then undo it. Each activation changes the reaction exactly once, without pausing playback; VoiceOver activation must not trigger the media double-tap-like gesture too. | Not run |
| Caption reading | Read the known caption and tags with VoiceOver. Confirm complete, understandable speech, with no unintended playback or reaction change. | Not run |
| Comments modal | Open Comments through VoiceOver. Confirm focus enters it, its controls are named, background controls cannot be activated, and closing returns focus to a useful originating control. Do not submit a comment. | Not run |
| Settings | Open Feed settings, traverse its controls, then close it. Confirm the panel remains reachable during inactivity and focus returns usefully. Restore any changed preference. | Not run |
| Always-visible preference | Enable always-visible controls, wait, and repeat navigation. Controls remain reachable. Restore the original preference afterward. | Not run |

On a local iPhone, use actual VoiceOver swipe navigation and double-tap
activation. BrowserStack Live requires its documented VoiceOver keyboard
shortcuts; its ordinary remote touch gestures do not become VoiceOver gestures.
Keep keyboard-mediated Live evidence separate from physical touch activation
evidence: the app has gesture handlers whose accidental activation needs
explicit observation.

For each check, retain the action sequence, actual spoken output, playback
state and reaction state before/after, focus destination, and pass/fail with
any evidence captured under permission. DOM focus or ARIA text alone is not
spoken-output evidence. Record failures before making targeted fixes, then
repeat the failed check on the real device. Clean up only the test account's
fixture and changes.
