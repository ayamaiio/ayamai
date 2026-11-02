# Personal media labeling

## Two layers

The Watch Tag action edits a **personal annotation**, not the uploader's public post tags. Any signed-in viewer with current access to an item can label it, including a shared post they do not own. Other viewers, uploaders and collaborative recommendation queries do not receive these annotations.

- **Structured:** canonical hashtags, named attribute/value lists, Draft/Reviewed status, Unsure/Confident confidence, media ID, revision, schema version and server timestamp.
- **Unstructured:** free-form notes and the tag/attribute arrays received in each successful edit request. The editor normalizes inputs before sending them; this is request history, not keystroke logging.
- **Provenance:** an optional public HTTPS source URL. Queries and fragments are deliberately removed, and URL credentials are rejected. This field must not store MEGA keys, signed storage URLs, OAuth tokens or cookies.

The initial attribute vocabulary is user-defined rather than a hardcoded content taxonomy. Keys and values are standardized; review/confidence are controlled enumerations. This allows a vocabulary to emerge during the first labeling sessions without irreversible guesses about categories.

## Hashtags and filtering

Personal hashtags normalize using Unicode NFKC, lowercase, leading `#` removal, invisible-format character removal and whitespace-to-hyphen conversion. `#AQUA`, `aqua` and full-width variants refer to the same tag. Letters, numbers, combining marks, underscores and hyphens are supported.

The Watch hashtag filter matches accessible public/owner post tags **or that viewer's own personal tags**. Suggestions count distinct accessible media, not edit history. A change of filter starts a fresh session; its hashtag is bound to the persisted session and query key. Existing cycles keep their order after a label edit, while deletion, blocking, moderation and privacy changes still revoke access immediately.

The current tag editor supports 40 hashtags, 20 attribute keys with 12 values each, and 5,000 characters of notes per item. Limits reject invalid requests rather than silently replacing other devices' work.

## Learning

At the start of the next feed cycle, the recommender combines public tags with **only the viewer's** personal hashtags on both candidate and previously viewed/liked posts. Matching hashtags therefore contribute to the existing like/dislike and bounded viewing-signal affinities. Confident, Reviewed structured attributes add namespaced feature tokens. Notes and source URLs are retained for future user-controlled dataset work, but are **not** sent to an external model or treated as recommendation features today.

No personal annotations enter public popularity counts or collaborative-neighbor learning. Labels do not fabricate a like or overwrite an explicit dislike.

## Revision and retention contract

`GET /api/social/posts/:id/annotation` returns only the caller's record, or empty revision zero.
`PUT` requires `expectedRevision` plus the full annotation. A row lock serializes changes; current data and a versioned history entry commit atomically. Identical retries return the saved revision without another history entry. Different stale drafts receive `409`; the editor preserves the draft until the person explicitly reloads.

History retains canonical values, request tag/attribute arrays, notes, source reference, actor, revision, server timestamp and schema version. It is private backend data, not a public activity feed. History is retained while the media exists. Deleting media cascades through its annotations and history; revoking access hides retained annotations from former viewers immediately.

## Private review queue

Open **Account → Private labels** (`/labels`). The queue includes currently accessible owned and shared media, with All / Unlabeled / Draft / Reviewed status and **personal** canonical-tag filters. Unlabeled means no successful annotation revision, not an empty tag list. Public post tags are not a substitute for personal labels in this queue.

Queue pages use media-ID keysets and a creation cutoff carried in a filter-bound cursor. New uploads do not move existing items between pages. Labels and access remain live: a status change can remove an item from a filtered queue, and a privacy, blocking, moderation or deletion change revokes access. Restart the queue to include new uploads or changed items earlier than the cursor. Next-item controls work on touch screens; the editor also supports Ctrl/Cmd+Enter to save and advance. Failed saves and revision conflicts retain the draft rather than advancing.

## Versioned JSONL datasets

Creating a dataset is an explicit, private action. Reviewed labels are selected by default; Draft and All are opt-in. The selected personal tag and status are frozen in the manifest. Unlabeled media is never a training label. Dataset format, annotation schema and taxonomy semantics each have explicit version **1**, with controlled review/confidence values, normalization rules and the open personal vocabulary documented in the manifest. Canonical tags/attributes in the label records define that snapshot's vocabulary; no external taxonomy or model is inferred.

The server materializes a database **repeatable-read snapshot** using SQL, not an in-memory collection. It freezes one `current_label` record per selected media, including its current revision, canonical tags/attributes, notes, confidence and source/timestamp provenance. Later corrections do not alter an existing snapshot. `audit` records preserve revision number, schema version, timestamp, review status and confidence only. They do not export superseded note/tag/attribute payloads or raw request arrays. **Train only on `recordType: "current_label"`**; audit records are not additional examples. There is no model training or third-party transfer.

`POST /api/social/label-exports` creates a manifest. `GET /api/social/label-exports` lists the caller's latest twenty unexpired manifests. `GET /api/social/label-exports/:id/rows?cursor=0&limit=100` returns `{ jsonl, nextCursor, done }`. Every part contains at most 100 candidate records and newline-terminated JSON objects; concatenate parts in increasing cursor order. The app downloads bounded JSONL parts and a separate manifest rather than building an unbounded file in browser memory. A per-account, per-export browser checkpoint enables resumption, and re-downloading a cursor is safe; do not concatenate duplicate parts. An empty part can still advance the cursor when access was revoked. Creation is limited to three exports/minute; reads are also rate-limited.

Only the requesting account's annotations and safe media identity/type metadata are selected. Exports contain no storage keys, signed delivery URLs, original filenames, actor/account IDs, cookies, credentials, likes, watch events or browsing history. A source reference is the existing user-supplied, canonical HTTPS page link, stripped of query and fragment on annotation save; private storage locators are never taken from media rows. Notes are intentionally included as personal labeling data, so users should not enter secrets in them.

Each part **rechecks current access** including adult-policy acceptance, both-direction blocks, active moderation, ownership and public eligibility. Newly private or removed shared posts are omitted even from old snapshots. Media deletion cascades through frozen rows. Consequently, byte-for-byte reproduction is guaranteed for unchanged permissions/media, not after access revocation: safety takes precedence, and the manifest's original candidate count may exceed downloaded records. Annotation edits alone do not change frozen output.

Exports expire after seven days; expired manifests cannot be read or resumed. Export list/create requests opportunistically delete up to twenty expired manifests (and their rows) per request. Original annotation history continues to follow the existing media-deletion retention contract.

## Explicit browser capture

**Account → Browser capture** (`/capture`) provides installation instructions and
a downloadable desktop Chromium Manifest V3 extension. Select one visible
top-frame image/video, pair the destination account, and review labels plus
rights/publication choices before saving. Private is the default; permission to
save is still required. The extension never signs in on your behalf or reads
history/cookies. Files use the existing private R2 direct-upload/media-create
flow; annotations use the existing authenticated revisioned endpoint.

Supported formats, strict anonymous-source limitations, pairing, bounds,
deduplication and retry behavior are documented in
[`extensions/browser-capture/README.md`](../extensions/browser-capture/README.md).
No protected player bypass, signed-source retention, or automatic site scraping.

## Verification

`pnpm test:social` covers normalization, own-account scope, current-access checks, catalog redaction, hashtag session binding, stable cycles after relabeling, identical retries, conflicting concurrent edits and atomic history. `pnpm test:label-datasets` covers queue keyset pagination and filter binding, reviewed/draft/unlabeled states, canonical tags, stable current-revision snapshots, separate safe audits, bounded/retried/resumed parts, account isolation, changed/deleted/newly private media, moderation, blocking, adult-access revocation and expiry. Frontend label-helper and Watch playback tests cover input construction and existing playback behavior.
