# Invite-only app membership

## Current rules

- Only the active owner issues or revokes invitations.
- Capacity is five total slots across active invited members and unexpired pending invitations. The owner is not counted. Revoking a pending invite frees its slot; accepted invitations become active member slots.
- An invitation targets one verified email, expires after 14 days, and can be accepted once. The owner can revoke it before acceptance.
- Invitation links carry the bearer code in the URL fragment. The server stores a SHA-256 hash, not the plaintext token.
- Only the owner can inspect invitation and membership records for access administration. Ordinary members do not see invitation relationships or the invitee's activity.
- Access requests go to `contact@ayamai.io`; privacy requests go to `privacy@ayamai.io`. A request is reviewed manually and does not guarantee admission.

## Authentication boundary

Clerk verifies sign-in identity in shared app mode. App membership is a separate database record. The closed-by-default API membership boundary rejects unaccepted identities before protected resource routers. Pending identities can check their status and redeem an invitation.

The local WSL setup has a separate guarded `local-founder` mode. It exists only for the isolated loopback development environment; see [Local WSL development](local-wsl-development.md). It does not change the shared app's Clerk or invitation contract.

## Existing members

Existing application users may be backfilled as legacy members without an inviter. Membership is independent from operator privileges. Do not infer owner or moderator authority from a profile name, email address, or invitation history.

## Implementation details

PostgreSQL row/advisory locks serialize quota changes and redemption. Rate limits, input validation, and parameterized database operations protect the invitation routes. The join flow removes the fragment from the address bar and keeps the code in component memory; if sign-in interrupts redemption, reopen the invite link or paste the code again.

For implementation, inspect `artifacts/api-server/src/routes/access.ts`, `artifacts/api-server/src/lib/access-control.ts`, and the membership schema. This document describes repository behavior; verify deployment migrations and provider settings before treating it as a live-environment guarantee.
