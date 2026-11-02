# Product analytics

The app contains an optional Umami-compatible adapter for a small set of
product events. The current checked-in app HTML does not load Umami or another
analytics tracker, so these events are not collected unless a deployment
explicitly supplies and loads the tracker. The adapter is best-effort and does
not block app actions.

| Event | When | Custom properties |
| --- | --- | --- |
| `upload_batch_started` | Confirmed local batch starts, including retries | `file_count` |
| `upload_batch_finished` | Batch finishes validation/transfers/database creation | `completed_count`, `failed_count` |
| `cloud_import_started` | Server accepts a share-link import job | `file_count` |
| `post_action_saved` | Server confirms a reaction/bookmark mutation | `action`, `surface` |
| `creator_follow_changed` | Server confirms follow/unfollow | `following` |
| `comment_created` | Server accepts a new comment | None |
| `private_labels_saved` | Server saves the private annotation revision | None |

`action` is restricted to like, dislike, clear-reaction, save and unsave.
`surface` is scroll or player. Counts describe the attempted batch, not the
whole queue; validation failures are included. Import acceptance does not mean
the import completed. These events are not exact transaction accounting.

## Data boundary

Custom event properties are allow-listed fixed categories, booleans and counts.
They exclude account, creator, media and job IDs; filenames, storage locators,
share links, hashtags, labels, descriptions, comment/review text and raw errors.
The wrapper strips unknown keys. First-party recommendation telemetry is
separate and can be account-linked; see the in-app Privacy Policy.

A deployment that enables a tracker must review automatic pageviews and request
context separately. This code-level allowlist does not redact data collected by
a tracker outside the adapter. Update the Privacy Policy before enabling new
collection.
