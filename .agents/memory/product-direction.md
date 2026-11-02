---
name: Product direction
description: The user's shared-collection direction, public default for new posts, and optional anonymity.
---

## Brand direction

See [brand direction](brand-direction.md) for the exact product spelling and
visual requirements.

## Product-first work priorities

Prioritize adding product features and improving existing features over security,
testing, infrastructure, and developer-experience backlog work for now.

**Why:** The user explicitly refocused the project from infrastructure/developer
experience to building product.

**How to apply:** Select product work first and keep the lower-priority work
tracked rather than cancelling it. This is a prioritization decision, not
permission to remove existing safeguards or skip checks required for a change.

## Adult animation emphasis

The user wants the site to focus on adult 3D animation and hentai. Lawful
real-person adult content is allowed, but is not the emphasis.

**Why:** The user explicitly distinguished the intended focus from a ban on
real-person media.

**How to apply:** Lead public-facing positioning with adult animation without
suggesting that animation removes age, rights or consent obligations.

The user views extensive labeling and activity data as a way to improve
recommendations, with adult AI generation a speculative future ambition.

**Why:** They described generation as a “pie in the sky” vision, not a current
feature.

**How to apply:** Do not market generation as available or treat the ambition
as authorization for new training or data collection.

## Personal labeling and dataset direction

The user wants this product to support a sustained data-labeling undertaking for better recommendations, with structured and unstructured metadata and provenance preserved for later training and selected-media browser capture.

**Why:** The user explicitly chose that labels added to other people's posts are visible only to the person labeling, not everyone viewing the post.

**How to apply:** Keep personal annotations separate from public post metadata. Do not share personal labels, notes or annotation history with uploaders, other viewers or collaborative training without a new explicit decision. Browser capture is future work, not permission to collect unrelated browsing data or credentials.

## Larger-screen viewing and review audiences

The user wants short-form content prioritized on mobile and longer videos on
larger screens, including tablet-sized layouts. Larger screens should default
to a conventional video viewing page with the user's own and saved videos,
rather than defaulting to For You. Mobile Watch should remain intact.

**Why:** The user explicitly distinguished viewing habits by available screen
size, not by desktop operating system or device name.

**How to apply:** Use responsive width, preserve explicit Watch links and
media-first browsing, and do not make video length an access restriction.

The user explicitly chose **the video poster's followers** as the audience for
ratings and written reviews, not the reviewer's followers. This is separate
from personal data-labeling annotations, which remain person-labeling-only.

**Why:** This was the user's answer to the review-visibility clarification.

**How to apply:** The reviewer and poster retain access to the review, while
other readers need both a follow relationship with the poster and independent
access to the video. Following is never permission to unlock private media or
identify an anonymous uploader. Preserve review creation-context privacy.

## Shared collection

The product direction is a cross between Pixiv and TikTok: a shared collection of adult images, videos, and GIFs with media-type filters, likes, and comments. The user wants the feeling of "I'll store all my porn here either anonymously or not and if other people wanna see some of it that's fine," not "this is my private stash" with a small creator-monetization-driven public subset. New posts should be open/public by default with a clear Private option and anonymous or profile attribution. Paying creators by view is a possible later phase, not the organizing purpose.

**Why:** the user explicitly corrected the private-vault framing and asked for the open/shared-collection direction.

**How to apply:** Use shared-collection language and a visible public audience default for new posts, with private storage and post visibility treated as separate concepts. Anonymous public posting must not expose the uploader's sign-in identity. Preserve existing uploads as private unless their owner deliberately publishes them. Keep private media isolated from public discovery and require age/access, rights/consent, moderation, and reporting safeguards for public posting. Do not scope creator payouts into immediate work unless the user asks.

Watch should use TikTok-style movement: vertical swipes scroll, double-tap likes, and holding near the bottom then dragging left/right seeks. Do not bring back native playback-control dimming/timelines during autoplay or substitute a persistent fast-forward button for that gesture.

**Why:** the user called out the native overlay as bad and explicitly requested these interactions.

**How to apply:** Preserve this interaction contract when rebuilding the queued social Watch experience, while keeping accessible playback and seeking alternatives.

On mobile, the Library should be a two-column, media-only collection grid. Tapping an image, video, or GIF should open a Watch-style full-screen item view with likes and their counts, rather than a document-details screen. Larger screens can use a wider responsive grid and a dedicated conventional video player.

**Why:** the user explicitly requested this layout and viewing behavior.

**How to apply:** Keep filenames, badges, and management actions off collection tiles; keep management available in the expanded view. Use real persisted counts rather than invented social activity.

Public-by-default is a new-submission UI choice, not permission to silently publish legacy clients, imports, or existing uploads. Anonymity must cover media delivery URLs as well as profile labels. Feedback made while an item is private must not become collaborative-training data merely because the item later becomes public. Publishing media does not authorize disclosure of comments written while it was private.

**Why:** Explicit publication and anonymity are access/privacy promises, not just presentation choices. Reusing historical private interactions as shared signals would violate that boundary.

**How to apply:** Preserve explicit publication confirmation and the creation visibility context of feedback and comments through retries, imports and visibility transitions. Apply the same privacy filter to comment text and counts. Assess identity leakage in every returned URL and response, not only the post card.

## Invite-only membership and low-profile tone

The user's next product direction is invite-only access based on referrals from real-life contacts, with a fallback way for an uninvited adult to request an invitation. Keep the inviter-to-invitee relationship for internal use, while members are anonymous to other members by default. The landing page and access copy should feel discreet, restrained and sophisticated rather than promotional or explicit.

**Why:** The user moved this idea from brainstorming to the next planned implementation, and asked that it be carried into the handoff for the next agent.

**How to apply:** Enforce invitations in the application, not only through Replit's private deployment setting. Preserve existing accounts and logins. Treat the referral graph as sensitive account data: disclose its collection, restrict visibility by default, and never expose it on public profiles. Keep age, rights, consent and moderation safeguards unchanged.

The user chose five successful referrals per member, single-use invitations with no expiry, and `contact@ayamai.io` as the public access-request address. `privacy@ayamai.io` remains the privacy contact.

**Why:** These were the user's explicit invitation-policy answers.

**How to apply:** An unused invitation reserves a place and can be revoked; revoking an unused link must not count as a successful referral. Do not add expiration or unlimited referrals without a new decision.

## Post-first creation and image galleries

The main way to add media should feel like making a TikTok post, not uploading
files. Multiple images, including GIFs, can form one ordered post. The entire
post is one entity for recommendations, personal labeling and social feedback.
In Watch, vertical movement changes posts and horizontal movement changes the
image within the current post.

**Why:** The user explicitly requested grouped image posts and whole-post
recommendations and labeling, rather than treating each image as another post.

**How to apply:** Keep captions, hashtags, privacy and attribution at post
level. Do not turn slide changes into independent recommendation examples or
separate reactions. Keep bulk collection imports as a secondary workflow.
