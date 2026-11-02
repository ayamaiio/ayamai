---
name: Referenced TypeScript declarations
description: Distinguish stale project-reference declarations from missing API client source exports.
---

TypeScript project-reference checks can report missing exports even when the current source exports them. Treat stale referenced declarations as a possible cause before changing source.

**Why:** TypeScript project references can consume outdated declaration output even while Vite successfully serves the current source.

**How to apply:** Keep referenced-package declarations current when validating frontend changes.
