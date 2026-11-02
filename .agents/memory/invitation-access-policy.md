---
name: Invitation access policy
description: User-approved account and invitation model for the private media library.
---

Use one app sign-in for the owner and invited members. The owner is the only owner; up to five invited members may have active or pending access. The app may have a public URL, but membership must be enforced by the application rather than a separate Replit login gate. Invitations are bound to a verified email address and can be revoked or replaced.

**Why:** The user chose a public front door with one app sign-in and rejected Replit-gated invitations because they add a second login.

**How to apply:** Keep server-side membership checks on every private API and media authorization path. Do not change Cloudflare or publication visibility as a substitute for the app gate.

Referral eligibility is not permission to enter the private library. Preserve
the owner-approved email-invitation admission policy when repairing founder
access; changing to referral-only admission is a separate product decision.

**Why:** Founder recovery must not silently broaden who can read existing private
content while two invitation experiences coexist.

The user authorized founder recovery that may demote a separate legacy owner to
an active member while preserving that account and all its data. Never delete
the legacy identity or transfer its media as part of application-role recovery.
Use the existing owner role; do not introduce a competing GOD permission system.

**Why:** The user explicitly requested a sole founder owner without losing
legacy membership, libraries, media, provenance or user history.

**How to apply:** Require a provider-verified target identity and explicit
server-side authorization of the expected legacy owner before a role transfer.
Distinguish same-identity email changes from separate-identity recovery.
