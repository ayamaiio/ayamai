# Founder access recovery

## Authorization model

Clerk authenticates the user. `access_memberships` authorizes access to the private
application, including signed shared-media delivery. The older `members` registry
records referral eligibility and legacy membership; it is not a substitute for
active private-library admission.

The `/api/access` router must be reachable before the referral boundary. Its
status/acceptance routes authenticate through Clerk, its owner actions check the
active owner role, and public invitation validation has its own request limit.
Resource routes still require fresh active application membership.

An admitted account may acquire referral bookkeeping without another invitation.
A revoked application membership overrides an existing referral or legacy row.
This repair does not automatically admit referral-only or legacy-only users to
the private library, change invitation capacity, or change either token format.

## Founder verification and safe release

1. Inspect **production**, not development, using an authorized read-only database
   session. Inspect the configured founder's membership and any existing active
   owner before making privilege changes. Development Clerk users and database
   records do not establish production identity.
2. Confirm the existing live Clerk account is the founder's intended identity,
   and that its provider-verified email matches `APP_OWNER_EMAIL`. Do not infer
   ownership from account creation order, browser-supplied email, media ownership,
   or the first successful sign-in. Do not print credentials or copy production
   Clerk keys into development.
3. If another active owner exists, the email belongs to another active account,
   or the configured account is revoked, operator review is required. Distinguish
   an email change on the same Clerk identity from a separate identity by user ID.
   A separate-identity role transfer needs the explicit authorization below.
   Never silently restore revoked access or reassign private media.
4. Obtain explicit approval for the intended production privilege change and for
   the release. The change grants/promotes the verified configured founder's own
   Clerk `userId` to active owner, optionally demoting the explicitly authorized
   legacy owner to an active member without changing its content. The ordinary
   authenticated `/api/access/me` flow performs this under the existing database
   lock and uniqueness constraints; no public bootstrap endpoint is needed.
5. If moderation/operator features are required, separately obtain approval to
   add that **verified production Clerk user ID** to
   `SOCIAL_MODERATOR_USER_IDS`, preserving any existing entries. Owner status
   alone does not confer moderator rights. Never place a development ID here.
6. Use the project's normal approved release process. There is no schema change,
   replacement provider, temporary credential, or production authentication
   bypass in this repair.

## Real-session acceptance checks

The founder must complete authentication themselves at
**https://ayamai.io/sign-in**, using their existing production email/password or
the same SSO provider as their existing account. Do not register a replacement
account to fix missing data.

After an approved release, verify with that actual session:

- `GET https://ayamai.io/api/access/me` returns a membership role of `owner`.
  This response contains membership administration data: inspect it privately,
  not in public screenshots or logs.
- `/library`, `/videos`, and the existing account's own private media work under
  the same Clerk `userId`; no ownership reassignment was performed.
- Owner invitation controls work, and separately configured moderation controls
  work if requested. Existing adult/policy acknowledgement still applies.
- A separately authenticated nonmember remains denied private resource access;
  an unauthenticated `/api/access/me` request returns 401.
- Revoked users remain denied private APIs and signed shared-media access.

A successful health check, synthetic fixture session, or build is **not** proof
that the founder's real production session works. If production inspection is
denied or a real session is unavailable, report that blocker and leave these
acceptance checks pending.

## Regression checks

```sh
LOG_LEVEL=error pnpm run test:founder-access
pnpm --filter @workspace/private-media-library test
PORT=25221 BASE_PATH=/ NODE_ENV=production pnpm run build
git diff --check
```

The founder regression uses the real app and its middleware ordering, replacing
only the provider identity boundary inside the test process. It creates a unique
temporary PostgreSQL schema containing table definitions, not application data,
then removes that schema. The companion invitation suite uses synthetic,
uniquely identified development rows and cleans them up. Never run these checks
against a production database.

## Explicit owner recovery (no schema migration)

This remains the existing `access_memberships.role = owner` authorization model.
There is no GOD role, browser-controlled founder flag, or competing Clerk
metadata role. No new table, migration, startup DDL, or direct production SQL
write is required.

In **Publishing → Adjust settings → Production app secrets/settings**, an
authorized operator must configure:

| Server setting | Purpose |
| --- | --- |
| `APP_OWNER_EMAIL` | Intended founder email, verified in the production Clerk tenant. Keep it in secure settings, never in a Vite/client variable. |
| `APP_OWNER_TRANSFER_FROM_USER_ID` | Optional, noncredential server-only setting: the exact existing production owner ID from a trusted database read. Allows replacing ONLY that owner. Never use a development ID or browser request input. |

The second setting is required only for a separate-identity transfer. Changing
`APP_OWNER_EMAIL` alone still fails closed when another owner exists. These
settings are not populated by this code repair; production settings/publication
changes require approval.

After an approved release, the founder signs in through `/sign-in` and opens
`/feed`, `/videos`, or `/join`. These pages request `/api/access/me`. The backend
resolves that session's user through Clerk and uses only provider-verified
emails. Client-supplied email, role and transfer-source fields cannot authorize
recovery.

Under the existing advisory transaction lock:

- A same-ID email change updates only the existing owner's stored email.
- A separate-ID transfer demotes the specifically authorized old owner to an
  **active member**, then inserts/promotes the verified target to active owner.
  The unique active-owner index and transaction prevent two active owners or a
  committed intermediate no-owner state.
- The old account, membership dates/status, invitations, personal library,
  media keys, provenance, labels, history and other data remain intact.
  Its private media does **not** become the new founder's private media.
- The legacy member consumes a member place. If this exceeds invitation
  capacity, preserve the accounts; new invitations remain blocked until there
  is room.
- An unexpected current owner, an active email belonging to another account,
  or a revoked target is not overwritten. Ownership conflicts return 409.
- Retries/concurrent requests converge on the same owner. A stale expected-source
  setting cannot transfer ownership away from the new owner.

After verification, remove `APP_OWNER_TRANSFER_FROM_USER_ID` in the next
approved settings/release operation. Keep `APP_OWNER_EMAIL` for the founder.
Never delete the legacy user or manually move media as part of role recovery.

The runtime comparison is authoritative. Until a real production session
completes it, identity matching, Clerk email verification and founder access are
**pending**, not proven by synthetic tests.

## Access-check reliability

Bootstrap allows 30 attempts per authenticated user per fixed minute, shared
through PostgreSQL. Invitation acceptance/creation keep their existing
10/minute and 20/day budgets. An access-limit 429 includes
`code: ACCESS_RATE_LIMITED`, `retryAfterSeconds` and `Retry-After`; it is an error,
not a successful snapshot with `membership: null`.

The shared frontend access query uses a one-minute stale period, no focus or
reconnect refetch, and no polling for unadmitted accounts. Admitted accounts
refresh every two minutes; server-side revocation checks remain immediate.
Only network/server failures receive one automatic retry after two seconds.
Authorization failures, conflicts and 429s are not automatically retried.
The error panel distinguishes throttling, owner conflict and missing membership,
and disables retry during the server-provided cooldown.

The active `/join` route checks signed-in admission before showing missing-token
instructions. Admitted owners/members enter `/videos` on larger screens or
`/feed` on phones without a token. Unadmitted users still require a valid,
email-bound invitation.
