---
name: BrowserStack authentication challenge
description: Authentication prerequisite for real-device Watch lifecycle testing.
---

Do not bypass or collect one-time verification codes to automate a real-device playback test. BrowserStack interactive debugging requires screen recording, which may capture both the code and the clip. A device-trust challenge is a setup blocker until the user approves that recording and the test only counts after playback lifecycle assertions run.

**Why:** The owner account reached Clerk's new-device email verification on BrowserStack iOS Safari before the Watch feed loaded, and BrowserStack requires video for interactive debugging.

**How to apply:** Disclose the screen-recording tradeoff before using BrowserStack interactive debugging. Use only a dedicated test account and harmless fixture content. Do not store OTPs in Replit Secrets or request them in chat.

Screen-reader automation has a separate entitlement boundary. Successful
Automate sessions and existing BrowserStack credentials do not establish
permission to enable NVDA or VoiceOver.

**Why:** The account accepted a desktop Chrome session but rejected the documented
screen-reader executor because it required an Accessibility plan, despite the
public guide's broader availability wording.

**How to apply:** Check the live executor response before promising speech
verification. If entitlement blocks it, retain the task as unverified until an
entitled session or human-operated screen reader supplies actual speech evidence;
ARIA assertions alone do not substitute.

iPhone VoiceOver is a separate BrowserStack **Live** capability, not the
desktop screen-reader automation API. Do not assume an enabled desktop
Accessibility entitlement supplies iOS VoiceOver access.

**Why:** The current provider documentation places iOS Screen Reader in a
Team Pro / Enterprise Pro private beta. Live also states that remote touch
gestures remain ordinary touch input even with VoiceOver enabled; its
VoiceOver actions require the documented keyboard shortcuts.

**How to apply:** Establish Live feature access before promising iPhone
coverage. Distinguish keyboard-mediated virtual-focus evidence from actual
VoiceOver touch activation when verifying app-specific gesture conflicts.
