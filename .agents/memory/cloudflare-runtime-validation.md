---
name: Cloudflare runtime validation
description: Native Workers propagation and Request behavior cannot be established by Node-only tests.
---

An accepted Worker upload is not proof that every subsequent request sees its
new configuration. A successful private health check can still come from a
pre-activation version.

**Why:** The canary received successful probe-health responses and pre-dispatch
rejections immediately after an activation upload.

**How to apply:** Require an explicit active-version/phase marker before
announcing readiness. Retry only responses known to precede the action handler;
never replay an ambiguous mutation failure.

Node Request/fetch behavior is not a complete Workers runtime contract.

**Why:** Node tests passed while native Workers relay authorization failed
before storage or authorization work when network-fetch options were reused
as a local Request initializer.

**How to apply:** Keep local-dispatch Request initializers minimal, and confirm
authorization, HEAD/ranges and revocation on native Workers before asking for
physical-device measurements. Native HTTP smoke tests still are not playback.
