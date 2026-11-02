---
name: Database failure boundary
description: Contain idle pooled-connection faults without hiding query failures or replaying writes.
---

Contain pg.Pool idle-client error events at API startup. Do not use a global
uncaught-exception suppression handler as a substitute, and do not automatically
replay writes after a connection reset.

**Why:** An unhandled idle-client reset terminated the entire API process.
A failed write's commit state can be ambiguous, so replay risks duplicate data.

**How to apply:** Keep idle-pool diagnostics sanitized and let pg-pool discard
broken idle clients. Preserve ordinary active-query error handling and use
explicit idempotency contracts before considering mutation retries.
