# GOD Library access — 2026-10-31

Owner request: Itachi is the GOD account and must read the full uploaded
catalog on https://aws.ayamai.io/library. This supersedes the earlier Ikari
assumption and owner-library isolation assertions. Ordinary users keep their
existing isolation. This task does not implement the separate shared-library
or upload redesign proposals.

## Verified baseline

- GitHub main: `bda72228774feab70181ea4c2189766e32f06a5b`.
- Lightsail `ayamai-dev-api`, us-east-1, 107.21.185.193.
- Clean server checkout `/home/ubuntu/ayamai`, main at
  `a9e4c5c7b0031befe2debcc900a56a3eb07f079c`.
- Nginx serves `/var/www/ayamai` and proxies API requests to systemd
  `ayamai.service`, listening on 127.0.0.1:8080.
- Managed Lightsail PostgreSQL; private R2 media. Runtime configuration remains
  in `/home/ubuntu/ayamai.env`; no secret values belong in this document.
- Clerk provider lookup found one account, with the same subject as the active
  database owner and verified email matching configured owner recovery.
  No username or social profile identifies it as Itachi; authorization therefore
  uses the verified subject's existing active owner membership, never a name.
- Authenticated live owner requests returned 7 Library items / summary items;
  read-only SQL counted 56 active media items and five original uploader IDs.

## Implementation

`globalLibraryReader` checks an active server-managed owner membership in SQL.
`libraryReadScope` applies this to media lists, collection names, counts, filters,
and anchor/offset pagination, retaining active moderation state and deterministic
creation-time/ID ordering. Ordinary users still list only their own media.

The same privilege participates in `accessibleMedia` for view URLs, previews,
post details and gallery attachments. The bounded shared-stream query also
checks it so public-post and gallery playback cannot fail at the second gate.
Cross-uploader playback still requires the existing adult acceptance. Removed
media remains unavailable. Original ownership, metadata writes, deletion,
preview regeneration, upload prefixes, admission and moderator roles remain
unchanged. No migration, data re-import, membership edit or public-bucket change.

Ticket redemption rechecks current membership. Existing direct private R2
signed URLs retain their existing expiry semantics.

## Verification

Local tests use synthetic data in a dedicated `ayamai_god_test` database and
isolated schema. Storage responses are mocked; no real media is used.

- New cross-uploader authorization and existing 1,400-item pagination tests pass.
- Founder/membership: 26 checks pass; shared-media: 15 checks pass.
- Full typecheck and all configured production builds pass.
- CI runs the new authorization and pagination tests on PRs and main.

Coverage includes exact pagination without duplicates, anchor restoration,
filters, summary bytes including gallery attachments, private/public playback,
preview and gallery ticket redemption, ordinary-user denial, a member literally
named `itachi`, anonymous denial, moderation, revocation, and unchanged ownership
and write restrictions.

## Release procedure

Merge only after CI passes. Verify main SHA and clean server checkout. Fetch and
fast-forward the server to that exact merged revision. Build the API with the
existing installed dependencies; this change does not alter the lockfile.
Preserve the prior API `dist` before building, then restart `ayamai.service`.
No frontend release is necessary because frontend source is unchanged.

Rollback: restore the preserved API `dist` and restart the service; retain the
source checkout/release record for diagnosis. Do not reset the database or change
ownership. Verify public health and authenticated owner lists, collections,
summary, view URLs, preview bytes, gallery bytes and bounded video range reads.
Never log session tokens, signed URLs, storage keys, private titles or media bytes.

Release results are recorded separately after actual deployment.

## First release and delivery follow-up

PR #11 passed CI and merged as
`5ee42fa868e9efd1c0dc5720111842a90acbb5d0`. The API was built on Lightsail
and restarted successfully. Public health returned 200; authenticated owner
listing and summary matched all 58 active rows (two uploads arrived during the
work), across five uploaders. Frontend files were unchanged. Rollback API build:
`/home/ubuntu/ayamai-releases/a9e4c5c-api-dist`.

Byte verification exposed an inherited transport bug: `requireAppMembership`
rejected cookie-free ticket requests before the transport could validate them.
The follow-up permits only the three exact GET/HEAD ticket route shapes through
that guard. Preview and gallery transports now explicitly recheck active app
membership, in addition to their existing legacy membership and media checks;
the stream transport already checks active admission in its bounded SQL query.
Invalid tickets, revoked membership, non-ticket routes and other HTTP methods
remain denied. No anonymous media access is granted.

The GOD integration test now uses the actual application middleware stack,
including cookie-free original, preview and gallery ticket redemption. Local
verification: 42 authorization/founder/membership/social checks pass, full
typecheck passes, API build passes. Await the first CI/CD release before merging
and deploying the transport follow-up through the new automated workflow.
