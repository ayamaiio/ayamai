---
name: Age-gated UI testing
description: Synthetic authenticated test accounts can still be blocked by adult/policy attestations; distinguish cleanup evidence from end-to-end UI verification.
---

Do not assume a generated authenticated test identity can complete adult/policy
attestations. Testers may stop at these gates; never change consent gates merely
to obtain a passing browser check.

**Why:** Authentication and authorization to make personal/legal attestations
are different. A gate blocking the test persona is not itself an app regression.

**How to apply:** Use benign fixtures only. If gated UI testing is unavailable,
report that limitation honestly. An existing owner-authorized API may be used
to clean up that test account's own synthetic uploads, with normal permission
checks intact; successful cleanup is not end-to-end verification of gated UI.
