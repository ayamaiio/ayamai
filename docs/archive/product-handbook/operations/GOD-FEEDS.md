# GOD Watch and For You — 2026-10-31

Owner-authorized decision: every active, playable Library item is eligible for
Itachi's Watch and For You, including restored uploads, private media and image
sets from other uploaders. This supersedes public-only discovery eligibility
for the authenticated GOD account alone. No media is republished or reassigned.

## Inspected behavior and change

- `/feed` is the Watch screen; For You and Collection both call `/api/social/feed`.
- Previously For You required public visibility, active moderation, confirmed
  sharing rights and uploader social acceptance; both social lanes honored
  blocks and excluded dislikes. Collection required the viewer's uploader ID.
  Each cycle sampled at most 200 recent plus 800 random items, deduplicated.
- GOD reuses the existing server-managed active owner membership check, never
  a display name, client flag, moderator or admin role. Initial AWS inspection
  found one active owner, matching the verified Itachi Clerk subject, and 58
  active items from five uploaders: 39 private images, eight public images and
  11 public videos; one image set. Counts can change during use.
- Both social lanes now select the entire active catalog for GOD. Visibility,
  uploader sharing consent, rights-to-publish, blocks and dislikes do not exclude
  otherwise accessible Library items for GOD. Dislikes and other preferences
  still influence ranking. Ranking returns every candidate once per cycle.
- Explicit type and hashtag choices still narrow a cycle. Length, recency,
  popularity, tags, follows and viewing history rank rather than impose cutoffs.
- Viewer adult/policy acceptance, authenticated active app membership, moderation
  removals, supported-content checks, ticket authorization and storage errors
  remain enforced. Missing/deleted records cannot be served. Image-set attachments
  stay attached to one parent feed item.
- Ordinary-user public/Collection rules remain unchanged. Private media and
  personal feedback do not enter public collaborative signals. Uploader-only
  edits/deletion and original identities are preserved.
- Legacy `/api/watch/feed` and its personal feedback endpoints use the same
  Library read scope; legacy sessions reject IDs belonging to social lanes.
- Social pages fill past deleted/revoked slots and return a scanned `nextOffset`;
  stable session IDs prevent reshuffling and duplicates. Total is the initial
  session snapshot, not a live count. New uploads enter the next cycle. The browser
  session key is versioned so a reload replaces pre-change sampled sessions.

## Verification

Synthetic PostgreSQL regression covers 1,108 eligible posts, all social pages,
both lanes, images/videos/gallery, dislike and block inclusion for GOD, rights
and uploader consent restrictions for members, deletion of an entire page,
moderation, role revocation, cross-account/session conflicts and legacy Watch.
Existing Library tests cover preview, playback and attachment authorization.
CI runs the new feed tests alongside existing membership, Library, frontend,
typecheck, build and deployment rollback checks.

Release verification and final revision are recorded in the task completion report.
No schema migration or production membership/visibility changes are required.
