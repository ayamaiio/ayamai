# Watch mobile lifecycle testing

The Watch lifecycle unit tests simulate `visibilitychange` in jsdom. They verify
our pause/resume logic, but do not verify what mobile Safari or Chrome does when
the operating system backgrounds or locks a real device.

This optional test runs Watch playback in a BrowserStack Appium session on a
real iPhone (Safari) or Android phone (Chrome). It checks app backgrounding and
screen locking separately. It requires a BrowserStack Automate/Appium account;
running the command may consume the account's device minutes.

Use `WATCH_DEVICE_TEST_MODE=lifecycle-fixture` to load the development-only test
page. It renders the actual Watch tile with a synthetic public sample clip and
does not sign in or access account media. This is useful when the test account
cannot enter the private feed. The fixture route is not registered in production.
The default `feed` mode continues to sign in and test the account's real Watch
feed; it requires the account to be the owner or an accepted invitee.

## Prepare a test account

- Use an account already registered in the development Clerk instance with a
  password-based sign-in method. It must be the configured owner or an invited
  member; a Clerk account by itself does not grant app access.
- If the invitation-required screen appears after sign-in, stop: the app has not
  granted that account membership. An owner should bypass invitations through
  the configured owner identity; do not enter an invite code for the owner.
- Manually complete any age, adult-content, or policy confirmation before
  running the automated test. The test intentionally does not submit these
  attestations.
- The runner also will not read or submit one-time email/device-verification
  codes. If Clerk challenges a new BrowserStack device, use an approved trusted
  test-device flow before rerunning; do not commit OTPs or place them in repository configuration.
- Ensure the account has access to at least one playable Watch video.
- Use a test environment and harmless fixture content, not a personal account
  or production uploads.

Feed mode signs in from a fresh device session at `/sign-in`, then opens `/feed`.
Fixture mode opens `/__watch-lifecycle` directly. BrowserStack Local securely tunnels the running local web app to the device, so
the preview does not need to be published or exposed. The current WSL web app is
at `http://localhost:25222/`; the BrowserStack tunnel target defaults to
`http://bs-local.com:25222/`. Set `WATCH_DEVICE_APP_URL` if the local port changes.

## Configure and run

Set these values in the shell or CI secret store. Do not commit them or put them
in a checked-in `.env` file:

| Variable | Required | Description |
| --- | --- | --- |
| `BROWSERSTACK_USERNAME` | Yes | BrowserStack Automate username |
| `BROWSERSTACK_ACCESS_KEY` | Yes | BrowserStack Automate access key |
| `WATCH_DEVICE_EMAIL` | Yes | Dedicated test-account email |
| `WATCH_DEVICE_PASSWORD` | Yes | Dedicated test-account password |
| `WATCH_DEVICE_PLATFORM` | No | `ios` (default) or `android` |
| `WATCH_DEVICE_NAME` | No | BrowserStack device name; defaults to iPhone 15 or Google Pixel 8 |
| `WATCH_DEVICE_OS_VERSION` | No | OS version; defaults to iOS 17 or Android 14 |
| `WATCH_DEVICE_BACKGROUND_SECONDS` | No | Background/lock duration, 3–60 seconds; defaults to 8 |
| `WATCH_DEVICE_BUILD_NAME` | No | Build label shown in BrowserStack; defaults to `Watch mobile lifecycle` |
| `WATCH_DEVICE_APP_URL` | No | BrowserStack Local URL; defaults to `http://bs-local.com:25222/` |
| `WATCH_DEVICE_SESSION_NAME` | No | Searchable name for this BrowserStack session |
| `WATCH_DEVICE_MANUAL_AUTH_SECONDS` | No | Time to complete an interactive device-verification prompt, 15–300 seconds; defaults to 80 seconds |
| `WATCH_DEVICE_ALLOW_SCREEN_RECORDING` | No | Set to `true` only after approving BrowserStack screen recording for the test |
| `WATCH_DEVICE_TEST_MODE` | No | `feed` (default) or `lifecycle-fixture` |

Run `pnpm test:watch-mobile`. Run it once with `WATCH_DEVICE_PLATFORM=ios` and
once with `WATCH_DEVICE_PLATFORM=android` to cover both browsers.

The runner opens a temporary BrowserStack Local tunnel and closes it and the
remote session when the test ends. It prints the selected clip ID and pass/fail
outcome, but never prints the BrowserStack access key or test-account password.
For iOS Safari, the password is set on the normal sign-in form using a browser
input event because Appium reports the password control as non-interactable.
The sign-in button is still activated through WebDriver; no session or consent
is bypassed.

If Clerk asks to verify a new device, the runner enables BrowserStack video and
interactive debugging and waits briefly. In the BrowserStack App Automate
dashboard, open the ongoing session, start **Interactive Debugging**, enter the
verification code directly on the remote device, then stop interactive
debugging. The runner continues when Watch opens. Do not send the code in chat or store it in repository files. BrowserStack interactive debugging requires
screen recording, which may capture the code and the Watch clip. Do not enable
it unless that recording is approved; use only a dedicated test account and
harmless fixture content. When recording is approved, the runner allows a
BrowserStack idle timeout of up to 300 seconds so manual verification has time
to finish.

BrowserStack mobile-browser sessions reject the generic `mobile: backgroundApp`
command. The runner backgrounds Safari with the iOS Home button and restores
`com.apple.mobilesafari`; for Android Chrome it uses the Appium Home keycode
endpoint and restores `com.android.chrome`. If the session does not expose a
screen-lock command, the app-switch check still runs and the runner reports that
screen-lock behavior was not verified.

The lifecycle assertion accepts a video pause immediately before or after the
hidden visibility event. Real iOS Safari can emit `pause` first, then
`visibilitychange` about 128 ms later.

## What a passing run means

An app-switch pass requires a hidden-page event, a pause event for the active
clip, and—after returning—exactly that same clip playing. When BrowserStack
supports screen locking, the same assertions apply to that transition. If it
rejects the lock command, the app-switch result remains valid, but screen-lock
behavior is explicitly unverified. The test does not independently measure
acoustic silence from the phone speaker.

## Native Watch seeking and scrolling

Run the gesture suite against the same development-only fixture with four
synthetic cards:

```sh
WATCH_DEVICE_TEST_MODE=lifecycle-fixture WATCH_DEVICE_SUITE=gestures WATCH_DEVICE_PLATFORM=ios pnpm test:watch-mobile
WATCH_DEVICE_TEST_MODE=lifecycle-fixture WATCH_DEVICE_SUITE=gestures WATCH_DEVICE_PLATFORM=android pnpm test:watch-mobile
```

Only the BrowserStack credentials are needed for this mode. No sign-in, personal
media, policy attestations, or screen recording is needed. These commands consume
real-device minutes. The fixture is `/__watch-lifecycle?gestures=1`; it uses the
actual `SocialTile`, `WatchGestureLayer`, and playback lifecycle, plus native
scroll snapping and an intersection observer to activate each card. It is not
the authenticated, server-populated feed and does not verify its recommendations,
permissions, or data delivery.

The runner uses trusted native W3C touch actions, never dispatched DOM pointer
events. It checks:

- A horizontal hold-and-drag pauses the playing clip, commits the expected
  position to the media element (`seeked`, not just the slider), and resumes it.
- A vertical swipe scrolls to the next card without a media seek or replay of
  the detached previous video.
- A hold followed by a vertical swipe produces native `pointercancel`, discards
  the pending seek, and leaves the previous video paused.
- Navigation while a horizontal seek is held unmounts the previous clip;
  finishing the native gesture cannot seek or restart it. Only the new clip
  plays. This last case schedules navigation during the native gesture rather
  than claiming that a second finger navigated the feed.

Use `WATCH_DEVICE_GESTURE_CASE=card-switch` to rerun only the last case. The default
is `all`; `WATCH_DEVICE_SUITE` defaults to the existing `lifecycle` suite.

The runner measures any Appium-to-DOM coordinate offset using trusted input
before each gesture. Safari on the tested iPhone had a 59-pixel vertical offset;
Android had none. Holds use an explicit stationary native waypoint: the tested
XCUITest driver interpolated across an ordinary pause and moved immediately,
which correctly prevented the app's hold timer from starting a seek. A complete
gesture stays in a single request because that driver rejects a standalone
`pointerUp` in a subsequent request.

See [real-device seeking results](watch-touch-seeking-results.md) for the
completed device matrix and limits.
