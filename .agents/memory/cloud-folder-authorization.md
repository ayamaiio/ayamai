---
name: Cloud folder authorization
description: Why cloud folder imports use per-viewer OAuth and account-wide read-only scopes.
---

Use each viewer's own provider authorization for folder imports, not the project
owner's workspace cloud connection.

**Why:** This is a multi-account media product. A workspace connector would grant
viewers the wrong account's access. Arbitrary existing folder descendants also
cannot be read recursively with Google's narrower `drive.file` grant; read-only
Drive scope is necessary for the chosen server-side browser. No write or identity
permissions are needed.

**How to apply:** Keep provider grants isolated to the viewer and make the
account-wide read permission explicit in consent/UI. Do not replace this with an
owner-level connector or claim that selecting a folder restricts the OAuth grant.

Provider activation may be deferred when proper Drive or Dropbox access is
unavailable; retain the implementation disabled for later setup.

**Why:** The user explicitly said to shelve any service that cannot be accessed
for now and set it up later, rather than block the rest of the work.

**How to apply:** Do not claim live account access without usable authorization,
and keep existing share-link imports available while account setup is deferred.
