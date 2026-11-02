# Cloud share-link imports

## Supported sources

- Google Drive individual file links (`/file/d/…`, `/open?id=…`, `/uc?id=…`), including resource keys and Google's current large-file confirmation form.
- Dropbox individual file links (`/s/…`, `/scl/fi/…`), preserving the shared-link resource key and requesting `dl=1`.
- MEGA file and folder links, including complete decryption keys. MEGAJS loads metadata and decrypts streaming downloads with its integrity verification enabled. Folder selection is bounded to 200 files and 2,000 inspected nodes.
- MEGA folder descendants are explicitly rebound to the guarded API; the SDK does not inherit the root's custom API automatically. Folder-child handles are serialized to stable strings before persistence and matched the same way after reloading.

Files must be accessible to anyone with the complete link. This does not sign into a provider account or bypass passwords, permissions, or quotas. Google Drive and Dropbox folders require individual file links; account-authorized folder browsing is not implemented. Provider changes can invalidate an adapter.

Reference documentation:
- https://help.dropbox.com/share/force-download
- https://mega.js.org/docs/1.0/api
- https://mega.js.org/docs/1.0/examples/shared-file-streaming
- Google Drive's web-download confirmation form is a web flow, not a stable authenticated Drive API contract. Unrecognized forms are rejected rather than followed arbitrarily.

## Limits and privacy

- 5 GB per file; 200 files and 50 GB per link.
- Five preview attempts per minute, ten pending previews, three active jobs per account.
- One transfer worker globally, protected by a PostgreSQL advisory lock across instances.
- 8 MiB sequential multipart parts; bounded network buffers, no full-file memory or local disk staging.
- HTTPS only, allowlisted provider hosts, validated public DNS answers pinned per connection, and revalidation on redirects.
- Preview requests read only a prefix where range requests are supported. A known provider size and supported media signature are required; actual bytes are checked again during import.
- Share links and MEGA keys are encrypted at rest with AES-256-GCM, bound to the owning account, using a domain-separated key derived from the existing `SESSION_SECRET`. Never log request bodies, SDK errors, or these links. API responses omit encrypted sources, share keys, object keys, and multipart IDs.
- Rotating `SESSION_SECRET` makes pending encrypted sources unreadable; users must preview those links again. Completed media is unaffected.
- Sources expire after seven days and are cleared on the next worker tick. Successful and cancelled jobs erase their source immediately. Error/retry history remains account-private.
- No visibility/publication field is set during import; the existing private-media storage path and authorization remain in use.

## Recovery and cancellation

Jobs and file states persist in PostgreSQL. Closing the dialog does not cancel a job. The API process must be running for progress; an idle/suspended deployment will resume on its next startup.

After restart, the worker recovers queued and processing jobs, aborts a persisted unfinished multipart upload, and retries the interrupted file from byte zero. A deterministic per-file object key and atomic media/file registration prevent duplicate records when recovery follows a committed file. Completed files are retained when other files fail or the user cancels.

Cancellation is checked every second and again before media registration. Failed files can be retried within the source retention period. Cancelled jobs must be previewed again. The per-job safety deadline is 45 minutes; a timed-out job stops and retains completed media. There is no partial-byte resume.

Ordinary failures and cancellation abort multipart uploads and delete unregistered objects. A crash between R2 creating a multipart upload and PostgreSQL recording its ID leaves a small unavoidable orphan window. **Configure R2's incomplete-multipart lifecycle cleanup as a backstop** (never a rule deleting completed media); do not change existing bucket rules blindly. Known multipart IDs are recovered automatically.

## Verification

Run `pnpm run test:imports` against a development database with the schema applied and `SESSION_SECRET` available. Tests use synthetic accounts, in-memory source/storage adapters, and uniquely scoped database rows, then delete only their own fixtures. Production authentication has no test bypass.

Coverage includes parser and URL policy, private/mapped IPs, signature rejection, encrypted-source authentication, two-account API isolation, explicit file selection, idempotent confirmation, cancellation, multipart boundaries, post-commit restart recovery, failed-upload cleanup/retry, and truncated sources. A MEGA folder regression recreates the SDK's nested child shape, persists its identifier through a string round-trip, and exercises actual SDK streaming decryption/integrity verification through an injected guarded transport while rejecting any global API use. These fixtures are not live provider transfers.

`IMPORT_R2_SMOKE=1 pnpm run test:imports` additionally transfers a tiny synthetic PNG through actual R2 multipart commands, verifies a signed HTTP range read, and deletes its object and database fixtures. This smoke check passed during implementation. The test suite acquires the worker's advisory lock to prevent the live worker from picking up synthetic fixtures; run it while cloud imports are idle.

The pinned-DNS HTTPS client was exercised against Google Drive and Dropbox public metadata endpoints. Full live transfers from all three providers, MEGA folder variants, real provider quota/password errors, and multi-gigabyte throughput need accessible authorized sample links; none were supplied with this task. Do not describe those flows as live-verified on the strength of fixture tests.

Schema installation follows the existing Drizzle push/post-merge setup. Apply schema changes before starting the updated API. Before publishing this feature, run the live-source checks above and confirm the R2 multipart cleanup backstop.
