---
name: Browser capture boundary
description: Why desktop capture deliberately supports anonymous direct files rather than protected site downloaders.
---

Browser capture is an explicit selection and account-paired transfer into the
app's review flow, not a site scraper or a credential-sharing extension.
Keep source fetching anonymous and reject protected, signed, credential-bearing
or streaming-player sources rather than adding browser-cookie access.

**Why:** The user explicitly prohibited browsing-history/cookie collection,
credential URL retention, and DRM/access-control bypass. Narrow source support
is intentional even when the user can already view a media player.

**How to apply:** Add source support only when it preserves that boundary.
Cloud-provider access belongs in the existing guarded, per-viewer authorization
flow. Keep unknown provenance paths conservative: a path can itself contain a
capability secret even after query and fragment are removed.

Do not reissue an upload grant to an existing post's object for a duplicate
capture; deduplication must preserve original publication and established labels.

**Why:** A deterministic upload key would let a later capture overwrite an
already-published file before checksum validation, and automatic label merging
could discard a person's previous annotation work.

**How to apply:** Treat byte deduplication and object-upload authorization as
separate concerns; keep retries account-bound and preserve existing user data.
