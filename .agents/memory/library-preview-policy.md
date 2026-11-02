---
name: Library preview generation policy
description: Why older collections generate previews on demand rather than through an automatic full-archive scan.
---

Generate missing legacy Library previews when items are browsed, rather than automatically downloading an entire archive at startup.

**Why:** Originals can be multi-gigabyte objects, and automatically processing a large legacy collection can create substantial backend bandwidth, disk and CPU costs before the user browses it. Upload/import completion can generate new previews proactively without sweeping old archives.

**How to apply:** Keep restart recovery and preview-version upgrades demand-driven unless a separately budgeted, bounded backfill is explicitly requested. Preserve full-quality originals and never use them as a tile fallback.
