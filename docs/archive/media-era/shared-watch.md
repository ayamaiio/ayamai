# Shared Watch: behavior, ranking, privacy and release checklist

## Product and data safety

Existing media and legacy clients/import jobs remain **private**. Nothing scans an R2 bucket and publishes it. New UI submissions initially select Public, with an equally visible Private option. Public submission needs an explicit confirmation, adult/policy acknowledgement, and rights/consent confirmation. Anonymous attribution is the initial choice; using a profile requires creating a chosen pseudonym. Changing an old upload to Public requires an explicit Sharing action.

The shared feed requires an authenticated adult account. Its age gate is a recorded **self-attestation**, not verified identity or third-party age assurance. Private Library access still works without joining the shared feed. The policy excludes minors (including depicted characters in illustrations), nonconsensual, exploitative, illegal and unauthorized content. No payouts, DMs, automated private-media analysis, or creator monetization were added.

Only explicitly named public posts appear on a public profile. Social responses use an allowlist and never expose storage keys, original filenames, collection names, Clerk IDs, login email or account name. Comments are plain text and deliberately anonymous; there is no profile linkage or publicly identifying uploader badge. A `canDelete` boolean is returned only for the requesting commenter/post owner.

## Playback and access boundaries

- Private media still uses short-lived direct R2 URLs, visible only to its owner.
- Public media uses an opaque, encrypted five-minute bearer ticket to a same-origin stream by default, or the explicitly configured edge origin. This avoids leaking uploader IDs embedded in existing R2 object paths. Encryption uses domain-separated AES-GCM with the existing `SESSION_SECRET`.
- Every new stream/range request checks current visibility, removal state, age acceptance and bidirectional blocking. Public images stream without full buffering; videos support single HTTP byte ranges with 206/Content-Range/Accept-Ranges.
- Tickets are short-lived credentials: don't log or share full URLs. Request logging already excludes query strings.
- Changing visibility/removing/blocking prevents subsequent requests, including requests with old opaque tickets. Bytes already downloaded or buffered in a browser cannot be recalled. Previously issued **private direct R2** URLs can remain valid for up to five minutes. No claim of instant deletion of downloaded copies is made.
- Shared delivery still passes through the API unless edge delivery is explicitly enabled. An opt-in Worker now serves bytes from the **same private R2 bucket**, using a service-authenticated API authorization check on **every** GET/HEAD/range. It never redirects to identity-bearing R2 URLs. See [edge delivery design, benchmark and enablement gates](shared-media-edge.md). This is a candidate transport, not a published migration or a claim of measured production improvement.
- No transcoding was added. A file can be stored successfully but use a codec the browser cannot decode. Playback gives retry/error UI; verified browser-compatible renditions and adaptive bitrate delivery need a separate media-processing pipeline.

## Social state

One reaction per account/post, with atomic upsert, makes repeated likes idempotent. Likes can be removed; dislikes remain private. Saved is separate and does not silently imply Like. Saved shared posts persist independently of the uploader's Library metadata. Counts are database aggregates, not fabricated view/like totals.

`publicReaction` records the visibility context of a reaction. A reaction made while a post was private does **not** become a public count or collaborative-training signal when that post is published. Visibility transitions retire prior shared-training flags. Private reactions can still tune that same account's own recommendations. Other accounts' private media/tags/reactions never enter shared training.

Comments have unique account/request-ID keys for retry-safe creation. Authors and post owners can delete them. Reports have one row per reporter/post. Reports/comments/actions/settings/feed requests have database-backed per-account limits, shared across server instances. Blocking excludes posts and profile access in both directions and filters blocked commenters. Existing cycle membership never overrides eligibility.

Comments also retain their creation visibility context. Comments written on private media remain private: publishing the media does not publish those comments or their counts. They are hidden from public-post comment lists/counts (including the owner's shared view), and remain available to the owner when the item is private. Retrying the original private-comment delivery after publication does not upgrade its context. Legacy comment rows default to private context rather than assuming permission to disclose them.

Moderators come only from the server-side `SOCIAL_MODERATOR_USER_IDS` allowlist (comma-separated Clerk account IDs). No first-user promotion, browser role toggle, handle-based role, or client metadata is trusted. An authorized adult moderator can reveal reported public media, dismiss a report, or remove its post. Removed content cannot be republished by its owner through normal APIs. A newly private reported post can still be removed/dismissed from its report ID without revealing private content to the moderator.

## Recommendation implementation

This is a bounded, explainable hybrid recommender, not a trained neural model or a claim to match TikTok's scale.

Candidate eligibility is checked before ranking and again on every page. For You uses only rights-confirmed active public posts from accepted accounts. Collection uses the requesting account's active uploads. Both support all/video/image (including GIF) filters and exclude current explicit dislikes and blocked owners. A cycle samples up to 200 recent plus 800 seeded-random eligible posts. Sampling permits older posts into later cycles without loading all media or media bytes. Items are unique within the cycle. Very large collections are covered across randomized cycles, not guaranteed exhaustively before any repeat.

The server persists ordered IDs keyed by account, session, lane and filter. Feedback affects the next cycle, not the order of already-served pages. Removal/privacy/block/dislike changes remove eligibility immediately. New cycles sample and rank again; there is no client-side reshuffling of a served page.

### Signals and weights

- Explicit Like: **+4**; Dislike: **−6**, with disliked items also excluded.
- Implicit watch contribution: `min(1, watchedSeconds / max(8, duration || 30)) * .7`.
- Completion: `.35 * min(2, completions)`; replay: `.15 * min(2, replays)`; quick skip: `−.12 * min(3, skips)`.
- Personal signal half-life: 60 days. Inferred signals disappear from ranking when viewing-activity collection is disabled; explicit reactions remain.
- Normalized tag affinity is compressed with `tanh`, weight 2.4; chosen-profile creator affinity weight .6; media-type affinity .25. Anonymous authors don't acquire a public creator identity.
- Opt-in public collaborative overlap weight up to 1.2. Peers require at least three co-liked public items; overlap is shrunk by `overlap / (overlap + 10)`. Up to 100 peers; any suggested item needs five distinct supporting peers. No support means no collaborative score.
- Public quality uses at least five distinct consenting accounts and a Beta prior `(positive + 2)/(support + 6)`, maximum weight .35. This includes opted-in public like/dislike aggregates, not private-upload interactions.
- Freshness decays over 14 days, weight .25. Personal recent exposure is penalized up to .65, decaying over one day.
- Seeded exploration contributes up to .9; roughly one of five reranking slots prioritizes exploration. Greedy penalties reduce consecutive chosen-profile, tag and media-type repetition.

Collaborative consent is separate, off initially, and revocable in Account. Queries consult current consent/visibility, so opting out stops that account contributing to future rankings. Already persisted cycles stay stable. Raw private behavior is not made public.

### Telemetry safeguards

The client records only active, foreground playing time or image dwell. Video credit is limited to actual elapsed wall time as well as playback-position movement. Pauses, seeks, stalls, hidden tabs and unmounted/offscreen media are not watch time. A loading failure with no meaningful foreground viewing isn't a quick skip. Events have UUIDs preserved across transport retries.

Server events are independently validated, deduplicated and serialized per account. Progress is bounded by elapsed server time across tabs, 30 seconds per delivery, 3,600 seconds per post/day (12 seconds for images). Completion needs accumulated progress >=80% duration and is capped at three per post/day. Progress can earn completion even when completion/progress HTTP deliveries arrive out of order. Quick skips are capped at three/day, replays require earned completions, and lifetime counters are bounded. Viewing-activity opt-out records nothing; clear history removes inferred summaries and raw event rows while preserving explicit likes/dislikes. Event ID/delivery history is retained up to 90 days for active accounts and then pruned on their subsequent event. Video duration from browser telemetry is bounded but not an independently probed codec/duration measurement; it is not used for payouts or authoritative analytics.

### Offline evaluation

Run `pnpm test:social`. The reproducible fixture has 120 harmless synthetic posts, eight topics, twenty creators, and 50 deterministic seeds. It compares with the existing title/collection ranking and measures top-10 topic relevance, explicit-negative hits, creator diversity, catalog coverage, cold start, and CPU ranking latency.

Observed on this workspace:

| Metric | Previous ranking | Hybrid |
| --- | ---: | ---: |
| Synthetic preferred-topic precision@10 | 39.6% | 55.8% |
| Explicitly disliked item rate@10 | 0% | 0% |
| Mean distinct creators@10 | 7.28 | 7.08 |
| Cross-seed coverage@10 | 27.5% | 68.3% |

Cold start, with **no known preferences**, covers 81.7% of this catalog across seeds, averaging 7.98 creators/top10. Its preferred-topic relevance is 15%; it cannot know the held-out preference. Its 2.6% “negative” hit rate is an evaluation label unknown to that cold-start model, not failure to honor an actual recorded dislike. Hybrid CPU p95 was about 7ms for 120 candidates; this excludes SQL/network/media latency and is **not** a production performance guarantee. Diversity is slightly lower than baseline in this fixture, while relevance and coverage improve. Do not call this proof of real-user recommendation quality.

The pool is bounded at ~1,000 candidates; the diversity pass is quadratic. SQL collaboration aggregates can grow with the public collection. Before broad scale, benchmark realistic metadata volumes, precompute privacy-safe eligible aggregates, and measure real foreground skip/completion and negative-feedback outcomes with consent. No live A/B quality claim has been made.

## Release checklist

1. Use the current GitHub main revision and review its full diff.
2. Require the configured CI checks to pass for the exact candidate revision.
3. Keep R2 private and preserve existing media visibility; never bulk-publish personal media.
4. Use the AWS Lightsail deployment runbook for release steps. The inspected deploy
   workflow does not apply database migrations; handle schema changes through their
   separately documented, reviewed procedure.
5. Keep the deployment access-controlled until moderation coverage, provider
   content policies, rights/takedown handling, abuse response, age assurance and
   legal obligations are understood for the intended audience.
6. Confirm authenticated Watch behavior and media Range requests only through an
   authorized, non-destructive release check. Health or preview verification alone
   does not establish complete production behavior.
