---
name: Shared delivery boundary
description: Anonymity and revocation constraints for moving shared media off the API relay.
---

Edge delivery must keep the API authoritative for every new GET/HEAD/range, not just ticket issuance. Opaque URLs are insufficient if the browser receives a presigned identity-bearing R2 locator. Do not cache positive grants or redirect shared viewers to storage.

**Why:** Existing R2 keys contain uploader identity, and short-lived tickets alone would let blocked or revoked viewers continue making new requests until expiry. Edge offload is a bandwidth decision, not permission to weaken access.

**How to apply:** Keep storage locators server-to-server and private R2 unchanged. Distinguish next-request revocation from already-buffered/streaming bytes. Require a real edge/mobile canary before enabling; local transport timings omit geography and the authorization round trip.

The user approved upgrading Cloudflare Workers to the $5/month paid plan.

**Why:** The user said, “just sign me up for the $5 a month worker” and “$5 a month should be fine.” This supersedes their earlier $3 budget and Workers Free choice.

**How to apply:** Approval is for the Workers paid subscription, not unrestricted usage charges or unrelated hosting. Do not represent the base price as a hard cap or a replacement for playback and revocation verification.

The user should not manually upload JSON or liaise between agents for this app's tests.

**Why:** The user said, “I don't want to liason between agents for a test” and “I shouldn't be manually uploading json.”

**How to apply:** The user wants to open the supplied link on their iPhone and press a button, with on-screen Wi-Fi/cellular instructions. Arrange direct, authorized evidence collection and retrieval; do not make them transfer reports between environments.

Authorization capacity evidence must report overload/denial rates alongside
latency, and distinguish local SQL/transport measurements from deployed capacity.

**Why:** Fail-fast admission can reduce tail latency mainly by rejecting work;
that is responsiveness protection, not proof of increased serving capacity.

**How to apply:** Preserve the failure fractions when comparing benchmarks.
Require sustained, deployment-representative evidence before increasing limits
or claiming a production viewer capacity.
