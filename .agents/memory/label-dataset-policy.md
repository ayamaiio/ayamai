---
name: Label dataset policy
description: Reproducibility and delivery decisions for private training datasets.
---

Freeze label truth, not access rights. Reproducibility applies while permissions and media existence remain unchanged; later access revocation takes precedence over byte-identical reproduction.

**Why:** A reproducible training snapshot must not become a way to retain access to another person's deleted or newly private media metadata.

**How to apply:** Preserve a single current label per item at the snapshot and distinguish audit records from examples. Future dataset consumers must not concatenate corrections as simultaneous truth or treat an old manifest as an authorization grant.

Do not equate triggering a browser download with successfully saving a file.

**Why:** Browsers can block automatic multiple downloads, and ordinary web downloads cannot confirm a disk save.

**How to apply:** Keep explicit bounded part downloads and safe retries unless a future delivery mechanism can acknowledge writes. Persisted cursors describe requested parts, not proof of successful disk storage.
