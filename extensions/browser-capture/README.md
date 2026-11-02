# ayamai selected-media capture (desktop Chromium MV3)

1. Download and unzip the extension from **Account → Browser capture**, or use
   this directory from the source checkout.
2. Visit `chrome://extensions` / `edge://extensions`, enable Developer mode,
   choose **Load unpacked**, and select the folder containing `manifest.json`.
3. Open a source page and click the extension action. In its dedicated tab,
   choose **Find visible media**, then select exactly one listed item.
4. Enter your own ayamai app's HTTPS **origin** (no path). Grant access to that
   origin only and start transfer. In the new app tab, sign in if necessary
   and explicitly **Pair this account**. Keep the extension tab open.
5. The app receives the file without saving it yet. Review your title,
   collection, private hashtags/notes/structured attributes, and publication
   settings. Confirm you have permission to save the file. Review and confirm
   the save. Public sharing additionally uses the app's existing age, consent
   and rights confirmation.

## Supported sources

Not a site downloader. Works on ordinary HTTPS pages with a directly readable
top-frame `img` or `video` visible in the current viewport. Only the selected
node's current source is fetched; finding media makes no network requests.
Supports PNG, JPEG, GIF, WebP, AVIF, MP4 and WebM, **1 byte–20 MiB**. Actual
bytes and checksum are verified server-side before creation. A malformed or
truncated file may still be rejected by the browser's decoder; format
identification does not promise codec support.

The selected URL must have no credentials, query, fragment, nonstandard port
or redirect. Fetch uses anonymous CORS, no referrer and no cache. The source
must allow that fetch. Being able to watch a video does **not** establish
download permission or rights to redistribute it.

Explicitly unsupported: DRM/encrypted players, HLS/DASH, blob/data URLs,
protected/signed URLs, cookies or authenticated downloads, cross-origin
iframes, browser internal pages, offscreen galleries and automated site
crawling. YouTube/social streaming players generally do not expose a
supported direct source. Do not work around these restrictions. Use the
existing guarded cloud import for Google Drive, Dropbox and MEGA, not this
extension. Mobile browsers/native mobile binaries are not supported.

## Privacy, pairing and retries

- No history, cookies, webRequest, always-on content script, broad mandatory
  host permissions, external messaging or background scraping.
- `activeTab` grants only the source tab after the action click. `scripting`
  discovers visible node references and reads the one selection.
- Optional host permission is requested only for the app origin the user
  entered, to inject a one-shot transfer bridge into that app tab.
- Only that app origin is stored locally, never an account credential, source
  URL, media bytes, personal label or history. **Forget app permission**
  removes it. Transfer bytes live only in memory while the two tabs are open.
- A per-transfer nonce and explicit destination account confirmation bind the
  handshake. Every API operation is authenticated by the app, carries the
  paired account ID and fails if the active account changed. Switching
  accounts remounts the capture screen, clears the draft and aborts requests.
- Only canonical, same-origin HTTPS page provenance is sent. Query/fragment
  are discarded and URL userinfo rejected. Only public numeric post/image/video
  path forms are retained; unknown paths reduce to origin because paths can
  themselves contain capability credentials. No source media URL or page text
  is sent to the app.
- One file per extension transfer; six upload grants per account/minute
  enforced in PostgreSQL. Server byte verification admits at most two per
  account and eight per process. This processing ceiling is per process,
  not a distributed storage-upload quota.
- Account + SHA-256 deduplication serializes on a database advisory lock.
  New transfers never receive a PUT grant to an existing post's object.
  Duplicate media preserves its original publication/title/collection, and
  established private annotations are not overwritten. Duplicate temporary
  objects are deleted. No cross-account deduplication or existence signal.
- After first confirmation, a retry keeps the same choices and successful
  upload key. Lost post responses do not create another item. Label failure
  is shown explicitly and can retry after the media was saved. Reopening the
  tab requires selecting/transferring the file again; hash dedup still applies.
  Closing before upload completion may leave an unclaimed object, as in the
  existing direct upload flow. No durable queue of source URLs is retained.
- Progress reports discovery/pair/read/transfer stages in the extension and
  upload percentage/verification/label stages in the app. Closing the extension
  tab stops its orchestration; no service worker silently resumes downloads.

## Verification

`pnpm test:browser-capture`

The tests use benign bytes and synthetic accounts. A real unpacked-extension
smoke test requires a desktop Chromium profile that supports extension loading.
