// Policy for dev snapshots: which tables/columns may leave the source database.
// Fail-closed: a table not listed in ALLOWED_TABLES is never exported. A new
// table appearing in production therefore blocks the snapshot until reviewed,
// instead of silently shipping whatever it contains.

export const ALLOWED_TABLES = new Set([
  "access_memberships",
  "creator_follows",
  "import_files",
  "import_jobs",
  "label_export_rows",
  "label_exports",
  "media_annotation_history",
  "media_annotations",
  "media_items",
  "members",
  "playback_bookmarks",
  "social_accounts",
  "social_blocks",
  "social_comments",
  "social_profiles",
  "social_reports",
  "social_saved_posts",
  "video_reviews",
  "video_views",
  "watch_settings",
  "watch_signals",
]);

// Explicitly denied even though their neighbours are exported. Kept for audit
// visibility and for the restore-time redaction placeholders.
export const EXCLUDED_TABLES = new Set([
  "cloud_accounts",          // provider OAuth account linkage
  "cloud_authorizations",    // encrypted_verifier, state hashes
  "access_invitations",      // invite token hashes + invitee emails
  "membership_invitations",  // invite token hashes
  "social_rate_limits",      // ephemeral abuse-control counters
  "watch_feed_sessions",     // ephemeral per-session feed cursors
  "social_events",           // behavioural telemetry
]);

// Never copied, even from allow-listed tables. Names are matched case-insensitively.
export const DENIED_COLUMNS = new Set([
  "email",
  "token_hash",
  "encrypted_verifier",
  "password",
  "password_hash",
  "secret",
  "api_key",
]);

// Free-form or opaque fields that are replaced with a typed empty value so the
// column stays present and NOT NULL constraints still hold. Structured media
// metadata (title, collection, tags, visibility, type, size, object keys) is
// preserved: those drive the local library UI.
export const SANITIZED_COLUMNS = new Set([
  "social_comments.text",
  "social_reports.reason",
  "video_reviews.text",
  "social_profiles.handle",
  "social_profiles.display_name",
  "import_files.source_id",
  "import_files.name",
  "import_files.upload_id",
  "import_files.error",
  "media_items.original_name",
  "media_items.submission_hash",
  "media_annotations.attributes",
  "import_jobs.encrypted_source",     // opaque provider ciphertext
  "import_jobs.posting",              // provider post payload / source URLs
  "import_jobs.error",                // may embed provider URLs or tokens
  "label_export_rows.record",         // denormalised export snapshot
  "label_exports.metadata",           // free-form export metadata
  "media_annotation_history.payload", // historical annotation blobs
  "media_annotations.notes",          // personal free-text notes
  "media_annotations.source_url",     // external source link
  "media_items.description",          // free-text description
  "social_profiles.bio",              // free-text profile bio
]);

// Columns holding a Clerk subject id. Discovered at runtime as well; this is a
// floor so a renamed column does not silently leak an identity.
export const IDENTITY_COLUMN_HINTS = new Set([
  "user_id",
  "userid",
  "clerk_user_id",
  "clerk_id",
  "subject",
  "referred_by",
  "inviter_id",
  "blocked_user_id",
  "moderator_id",
  "created_by",
  "accepted_user_id",
  "redeemed_by",
]);

export const LOCAL_DEFAULT = { host: "127.0.0.1", port: "5434", database: "ayamai_local" };

// Reviewed against lib/db/src/schema at e61d500. New columns abort capture.
export const REVIEWED_COLUMNS = {
  "access_memberships": ["user_id", "email", "role", "status", "created_at", "revoked_at"],
  "creator_follows": ["user_id", "profile_id", "created_at"],
  "video_reviews": ["id", "user_id", "media_id", "rating", "text", "revision", "public_context", "updated_at"],
  "import_jobs": ["id", "user_id", "provider", "encrypted_source", "status", "collection", "posting", "error", "created_at", "expires_at"],
  "import_files": ["id", "job_id", "source_id", "name", "size", "status", "bytes_transferred", "object_key", "upload_id", "error", "media_id"],
  "label_exports": ["id", "user_id", "snapshot_at", "expires_at", "status", "tag", "record_count", "metadata"],
  "label_export_rows": ["export_id", "ordinal", "media_id", "record"],
  "media_annotations": ["user_id", "media_id", "revision", "tags", "attributes", "notes", "review_status", "confidence", "source_url", "updated_at"],
  "media_annotation_history": ["id", "user_id", "media_id", "revision", "schema_version", "payload", "created_at"],
  "media_items": ["id", "user_id", "title", "collection", "description", "tags", "visibility", "attribution", "moderation_state", "rights_confirmed_at", "published_at", "duration_seconds", "original_name", "object_key", "gallery_images", "submission_id", "submission_hash", "content_type", "media_type", "size", "is_favorite", "progress_seconds", "created_at"],
  "members": ["user_id", "source", "referred_by", "relationship_accepted_at", "joined_at"],
  "playback_bookmarks": ["user_id", "media_id", "seconds", "updated_at"],
  "social_accounts": ["user_id", "accepted_at", "collaborative_consent"],
  "social_profiles": ["id", "user_id", "handle", "display_name", "bio"],
  "social_comments": ["id", "media_id", "user_id", "text", "public_context", "request_id", "created_at"],
  "social_blocks": ["user_id", "blocked_user_id", "created_at"],
  "social_reports": ["id", "user_id", "media_id", "reason", "status", "moderator_id", "created_at"],
  "social_saved_posts": ["user_id", "media_id"],
  "video_views": ["user_id", "media_id", "day", "visibility", "watched_seconds"],
  "watch_signals": ["id", "user_id", "media_id", "reaction", "public_reaction", "watched_seconds", "completions", "replays", "quick_skips", "updated_at"],
  "watch_settings": ["user_id", "behavior_enabled", "autoplay_enabled", "data_saver_enabled", "always_visible_controls", "updated_at"],
};
