---
name: Infinite-query freshness budgets
description: Avoid multiplying background requests by every loaded cursor page.
---

Do not put frequent polling on an unbounded infinite query. Budget refresh requests against the number of loaded pages and the endpoint's rate limit.

**Why:** React Query refetches every retained cursor page, not just the first. A seemingly modest five-second interval can exceed the request limit after ordinary browsing and replace usable content with an error.

**How to apply:** Prefer mutation invalidation and focus refresh for Saved. If stronger freshness is required, design bounded eligibility checks or a deliberate bounded refresh rather than polling the entire loaded history.
