---
name: Zod compatibility
description: Why validation must remain on a patched Zod 4 release.
---

Keep the runtime validator and schema generator aligned on a patched Zod 4 release rather than downgrading the runtime to Zod 3.

**Why:** The resource-exhaustion advisory GHSA-mrhx-c7xc-m3w5 affects the final Zod 3 release, with no patched version on that major. Pinning code generation to Zod 3 may hide compatibility problems but reintroduces the vulnerability.

**How to apply:** When changing schema generation or validation dependencies, resolve compatibility on the patched major and check defaults, coercion, partial updates, null handling, and Drizzle schema interoperability.
