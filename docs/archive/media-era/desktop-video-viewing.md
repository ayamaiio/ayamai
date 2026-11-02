# Larger-screen viewing and creator follows

## Entry and layouts

At 768 CSS pixels and above, the signed-in home opens `/videos`. Below that,
home opens `/feed`. Width is checked when choosing the home destination, not
continuously: resizing does not redirect an active viewer. Explicit Watch links
remain Watch links. Mobile Watch retains its existing gestures and feed layout.

Videos provides a conventional, manually started player, My videos and Saved
selectors, fullscreen, playback-speed selection, social actions and star reviews.
`/videos?id=<media UUID>` directly selects an accessible video. The player pauses
on tab hiding, changing video and unmounting. Library video tiles on larger
screens open this player; images retain the existing expanded viewer. Library
uses two mobile columns and progressively more columns on larger screens.

The collection endpoint uses keyset pagination by duration then ID, longest
known videos first and unknown durations last. Both sources recheck current
access, moderation and blocking on every request. Saved is always scoped to the
authenticated account, includes owned favorites, and never grants access to
another account's private or removed media.

## Ratings and reviews

Each viewer has at most one editable 1–5-star rating and optional review of up
to 5,000 characters per video. Stars are separate from likes. The author always
sees their own review. Other reviews and their aggregate counts/average are
available to the video poster and that poster's followers, subject to media
access and blocking. Following the reviewer is not sufficient.

Only reviews created while a video is public and profile-attributed may be
follower-shared. A review created in private or anonymous context never becomes
shared merely because the post is later published or attributed to a profile.
Anonymous posts do not expose their owner through follower-based permissions.
Review responses do not identify the writer's account or profile.

Saves and deletes use both revision and review ID, protecting against stale
drafts and deletion/recreation races. Updates are transactionally serialized.
Exact save retries are idempotent. The UI anchors the expected revision to the
draft baseline, not a later background refetch. A conflict retains the draft
and requires an explicit reload. Failed reloads retain the draft and editor.
Changing video/source, navigating through links or closing the tab warns about
unsaved edits. A browser Back navigation is not blocked by the link guard.

## Following

Only chosen named profiles can be followed. Anonymous uploads never show a
follow link or owner identity. Follow/unfollow is idempotent, self-following is
rejected, and blocks hide profiles and revoke review access. Account shows the
caller's paginated followed creators. There are no notifications, direct
messages, private-post access grants or public follower identity lists.

## Recommendation context

Watch sends `short` on narrow screens and `long` on larger ones at the beginning
of a new cycle or filter selection. This is a modest duration preference, not
a duration cutoff. Unknown lengths and images are neutral; all eligible lengths
remain available. Explicit reactions, tags and other existing ranking signals
still apply. Context is stored with the feed session; changing context requires
a separate session and never reshuffles the current one.

Stars and follows are persisted but are not yet new recommendation-training
features. Review visibility is not collaborative-training consent.

## Current limits

The new player resumes owned-media progress only when the Library's metadata
is already cached. Shared saved videos do not yet have a separate per-viewer
cross-device playback bookmark. No claim of universal resume is made.
Metadata duration discovery and transcoding remain the existing pipeline;
longest-first ordering cannot infer lengths for files without duration metadata.

Database changes are additive. Use the normal development schema push and
managed publication schema flow, not startup DDL or destructive migrations.

## Verification

Backend integration checks cover creator follows, audience rules, anonymous and
private contexts, blocked/revoked access, save conflicts and delete/recreate
races, stable recommendation context and cursor pagination. Frontend checks
cover draft baselines during background refetch, offline reload retention and
aggregate refresh after save.

A signed-in synthetic-account browser journey verified review create, edit,
reload, stale-save conflict, discard confirmation and delete, plus desktop,
768-pixel tablet and narrow-screen home routing. Test uploads were benign and
private and were removed afterwards.

The automated browser could not decode a valid H.264 MP4 despite a successful
206 response. It did successfully play a VP8 WebM through the same player and
delivery path. This runtime codec limitation is not evidence that H.264 fails
in users' browsers. Native playback errors now show an explanation and a retry
control instead of leaving a silent blank player. Active-playback pause on tab
hiding/navigation has code coverage by inspection, but was not conclusively
verified in the browser journey.
