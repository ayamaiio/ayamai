# Authorized Drive and Dropbox folder imports

## Current availability

Account-authorized Google Drive and Dropbox folder imports are shelved until
usable provider authorization is supplied. Neither provider has OAuth app
credentials or a connected account in this project. The user explicitly approved
deferring any service that cannot be accessed, rather than blocking delivery.
The implementation is retained, with connection controls disabled when setup is
missing. Shared-file link imports are unaffected. No live provider authorization
or account access has been verified.

## Administrator setup

The app uses **each viewer's own OAuth authorization**, not the project owner's
workspace connector. No provider access token, refresh token, client secret, or
PKCE verifier is sent to browser storage. Existing shared-file links continue to
work without this setup.

Set these server-only values through the project's secure environment settings:

| Setting | Purpose |
| --- | --- |
| `CLOUD_IMPORT_ORIGIN` | Exact externally reachable HTTPS app origin, with no trailing slash or path |
| `GOOGLE_DRIVE_CLIENT_ID` | Google OAuth web application client ID |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Google OAuth web application client secret |
| `DROPBOX_CLIENT_ID` | Dropbox application key |
| `DROPBOX_CLIENT_SECRET` | Dropbox application secret |
| `SESSION_SECRET` | Existing stable encryption secret; changing it invalidates stored cloud credentials and import sources |

Configure origins separately for development and production. The callback
address must match exactly in the provider console and in the environment:

- Google: `<app-origin>/api/imports/accounts/drive/callback`
- Dropbox: `<app-origin>/api/imports/accounts/dropbox/callback`

Use the app's actual externally reachable origin, not an API service port.
Development preview addresses are not published production addresses. A fork's
preview address may also differ from the main project's. Do not copy an origin
between environments without checking the provider's registered redirect URLs.

### Google

1. Create a Google Cloud project, enable **Google Drive API**, and configure its
   OAuth consent screen.
2. Create an OAuth **Web application** client and register the callback above.
3. Configure the read-only scope
   `https://www.googleapis.com/auth/drive.readonly`. Add test users if the consent
   screen is in testing mode.
4. Supply the client ID, secret, and exact app origin. Restart the API service.

`drive.readonly` permits account-wide read access. It is the minimum scope that
supports browsing arbitrary existing folders and downloading all their
descendants through Drive's API without write access. `drive.file` only grants
access to app-authorized files and does **not** grant recursive access to an
existing folder's children. We do not request write, delete, identity, or email
scopes. The UI tells viewers that access is not confined to selected files.

Google classifies this as a **restricted** scope. Public availability can require
Google's OAuth verification and, because the server handles restricted data,
a security assessment unless an exemption applies. Testing-mode refresh tokens
can expire after seven days. Provider approval and app audience settings must
be resolved before a public release.

### Dropbox

1. Create a scoped Dropbox API app with **Full Dropbox** content access so it can
   browse existing folders rather than only a dedicated app folder.
2. Enable only `files.metadata.read` and `files.content.read`.
3. Register the exact Dropbox callback above, then supply the app key and secret.
4. Restart the API service. Check the app's development user limit and request
   Dropbox production approval when needed.

No write, sharing, deletion, team administration, account profile, or email
permissions are requested. Offline access supplies a refresh token so a durable
import can continue after the browser closes.

## Viewer flow

Open the upload dialog's cloud-import tab. Choose Drive or Dropbox and press
**Connect**. Authorization opens in a separate tab, with an HTTP-only state cookie,
account-bound expiring database state, and S256 PKCE. After approving, return to
the dialog; connection status refreshes automatically. If the tab is blocked,
allow popups and connect again.

Open folders, use breadcrumb navigation and Previous/Next page, and select
files or whole folders. Selection is kept across pages and folders. **Preview
selection** expands descendants, removes overlaps, and checks:

- Up to 200 supported media files and 50 GB per import.
- Known sizes, from 1 byte up to 5 GB per file.
- At most 2,000 traversed folders/media entries and 100 listing pages.
- Five previews per minute, ten pending previews, three active import jobs.

Unsupported documents, shortcuts, online-only Dropbox files, and archives are
not imported. Empty or oversized selections fail explicitly, never silently
truncate. Byte signatures and exact sizes are checked while downloading.
Use smaller folders if a preview times out or exceeds traversal limits.

After preview, choose files, collection, and posting visibility in the existing
confirmation panel. Nothing is copied merely by connecting or browsing.
The existing public-post confirmation remains required. Durable jobs stream to
the same private R2 objects and retain the same cancellation, retry, expiry,
multipart cleanup, and per-account ownership protections as link imports.

## Disconnect and reconnect

**Disconnect** removes the app's encrypted provider credentials and pending
authorization states, cancels its pending/active authorized imports, and attempts
provider-side revocation. Completed library files remain. Public share-link jobs
are independent and are not cancelled. If the provider cannot be reached, local
disconnect still succeeds; viewers can also remove the grant in their Google or
Dropbox connected-app settings.

Reconnect creates a new connection identity. Old unfinished job references do
not silently move to a different provider account: create a new preview.
Provider-side permission revocation or expired authorization produces a safe
reconnect message, not raw provider errors.

## Verification

`pnpm run test:imports` runs synthetic provider transport and isolated-account
database tests alongside the existing import-worker regressions. Synthetic OAuth
tests skip when real OAuth app configuration is present, to avoid touching any
real credentials. They never access real cloud collections or R2 objects.
The optional real R2 test remains opt-in.

Before a broad release, use real test accounts to authorize each provider, browse
a nested paginated folder, import into private storage, disconnect during a job,
and verify that the second app account cannot see the first account's connection
or import. The existing cloud-download release verification work covers the
real-provider/R2 check; synthetic tests do not establish provider-console
configuration or public OAuth approval.
