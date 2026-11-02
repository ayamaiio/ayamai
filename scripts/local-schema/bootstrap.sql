CREATE TABLE "media_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"collection" text,
	"description" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"attribution" text DEFAULT 'anonymous' NOT NULL,
	"moderation_state" text DEFAULT 'active' NOT NULL,
	"rights_confirmed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"duration_seconds" double precision,
	"original_name" text NOT NULL,
	"object_key" text NOT NULL,
	"gallery_images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submission_id" uuid,
	"submission_hash" text,
	"content_type" text NOT NULL,
	"media_type" text NOT NULL,
	"size" bigint NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"progress_seconds" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_annotation_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"media_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_annotations" (
	"user_id" text NOT NULL,
	"media_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"review_status" text DEFAULT 'draft' NOT NULL,
	"confidence" text DEFAULT 'unsure' NOT NULL,
	"source_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_annotations_user_id_media_id_pk" PRIMARY KEY("user_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "label_export_rows" (
	"export_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"media_id" uuid NOT NULL,
	"record" jsonb NOT NULL,
	CONSTRAINT "label_export_rows_export_id_ordinal_pk" PRIMARY KEY("export_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "label_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"tag" text,
	"record_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_blocks" (
	"user_id" text NOT NULL,
	"blocked_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"public_context" boolean DEFAULT false NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	CONSTRAINT "social_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "social_profiles_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "social_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"media_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"moderator_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_saved_posts" (
	"user_id" text NOT NULL,
	"media_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"accepted_at" timestamp with time zone,
	"collaborative_consent" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"media_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"seconds" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" double precision DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_follows" (
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_follows_user_id_profile_id_pk" PRIMARY KEY("user_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "video_reviews" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"media_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"public_context" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_reviews_user_id_media_id_pk" PRIMARY KEY("user_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "watch_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"behavior_enabled" boolean DEFAULT true NOT NULL,
	"autoplay_enabled" boolean,
	"data_saver_enabled" boolean DEFAULT false NOT NULL,
	"always_visible_controls" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"media_id" uuid NOT NULL,
	"reaction" text,
	"public_reaction" boolean DEFAULT false NOT NULL,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"completions" integer DEFAULT 0 NOT NULL,
	"replays" integer DEFAULT 0 NOT NULL,
	"quick_skips" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_views" (
	"user_id" text NOT NULL,
	"media_id" uuid NOT NULL,
	"day" text NOT NULL,
	"visibility" text NOT NULL,
	"watched_seconds" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "video_views_user_id_media_id_day_visibility_pk" PRIMARY KEY("user_id","media_id","day","visibility")
);
--> statement-breakpoint
CREATE TABLE "watch_feed_sessions" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"lane" text DEFAULT 'legacy' NOT NULL,
	"media_type" text DEFAULT 'all' NOT NULL,
	"hashtag" text DEFAULT '' NOT NULL,
	"length_preference" text DEFAULT 'balanced' NOT NULL,
	"media_ids" uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"bytes_transferred" bigint DEFAULT 0 NOT NULL,
	"object_key" text NOT NULL,
	"upload_id" text,
	"error" text,
	"media_id" uuid
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_source" text NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"collection" text,
	"posting" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloud_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cloud_authorizations" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"encrypted_verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" text,
	CONSTRAINT "membership_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "membership_invitations_redeemed_by_unique" UNIQUE("redeemed_by")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"user_id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"referred_by" text,
	"relationship_accepted_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" text,
	CONSTRAINT "access_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "access_memberships" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "playback_bookmarks" (
	"user_id" text NOT NULL,
	"media_id" uuid NOT NULL,
	"seconds" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playback_bookmarks_user_id_media_id_pk" PRIMARY KEY("user_id","media_id")
);
--> statement-breakpoint
CREATE TABLE "curator_duels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"labeler_account_id" text NOT NULL,
	"left_item_id" uuid NOT NULL,
	"right_item_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"dwell_ms" integer,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curator_item_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"raw_tag" text NOT NULL,
	"state" text DEFAULT 'unknown' NOT NULL,
	"provenance" text NOT NULL,
	"confidence" text,
	"key_fallback" boolean DEFAULT false NOT NULL,
	"asserted_by" text,
	"asserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curator_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_account_id" text NOT NULL,
	"source" text NOT NULL,
	"source_post_id" text NOT NULL,
	"media_id" uuid,
	"sha256" text,
	"width" integer,
	"height" integer,
	"rating" text,
	"score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curator_label_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label_id" uuid NOT NULL,
	"labeler_account_id" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curator_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"labeler_account_id" text NOT NULL,
	"verdict" text NOT NULL,
	"reason" text,
	"dwell_ms" integer,
	"zooms" integer DEFAULT 0 NOT NULL,
	"mode" text DEFAULT 'queue' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"taxonomy_version" integer DEFAULT 1 NOT NULL,
	"client_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curator_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"labeler_account_id" text NOT NULL,
	"client_event_id" text NOT NULL,
	"item_id" uuid,
	"type" text NOT NULL,
	"session_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curator_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"labeler_account_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"label" text DEFAULT 'curator' NOT NULL,
	"scopes" text[] DEFAULT '{"curator:write"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "curator_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "media_annotation_history" ADD CONSTRAINT "media_annotation_history_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_annotations" ADD CONSTRAINT "media_annotations_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_export_rows" ADD CONSTRAINT "label_export_rows_export_id_label_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."label_exports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_export_rows" ADD CONSTRAINT "label_export_rows_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_reports" ADD CONSTRAINT "social_reports_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_saved_posts" ADD CONSTRAINT "social_saved_posts_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_events" ADD CONSTRAINT "social_events_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_follows" ADD CONSTRAINT "creator_follows_profile_id_social_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."social_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_reviews" ADD CONSTRAINT "video_reviews_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_signals" ADD CONSTRAINT "watch_signals_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_views" ADD CONSTRAINT "video_views_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_invitations" ADD CONSTRAINT "membership_invitations_inviter_id_members_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."members"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_bookmarks" ADD CONSTRAINT "playback_bookmarks_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_duels" ADD CONSTRAINT "curator_duels_left_item_id_curator_items_id_fk" FOREIGN KEY ("left_item_id") REFERENCES "public"."curator_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_duels" ADD CONSTRAINT "curator_duels_right_item_id_curator_items_id_fk" FOREIGN KEY ("right_item_id") REFERENCES "public"."curator_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_item_tags" ADD CONSTRAINT "curator_item_tags_item_id_curator_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."curator_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_items" ADD CONSTRAINT "curator_items_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_label_history" ADD CONSTRAINT "curator_label_history_label_id_curator_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."curator_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_labels" ADD CONSTRAINT "curator_labels_item_id_curator_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."curator_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curator_observations" ADD CONSTRAINT "curator_observations_item_id_curator_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."curator_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_items_user_created_idx" ON "media_items" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "media_items_user_collection_idx" ON "media_items" USING btree ("user_id","collection");--> statement-breakpoint
CREATE UNIQUE INDEX "media_items_object_key_idx" ON "media_items" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_items_user_submission_idx" ON "media_items" USING btree ("user_id","submission_id");--> statement-breakpoint
CREATE INDEX "media_items_gallery_images_idx" ON "media_items" USING gin ("gallery_images");--> statement-breakpoint
CREATE INDEX "media_items_discovery_idx" ON "media_items" USING btree ("visibility","moderation_state","published_at");--> statement-breakpoint
CREATE INDEX "media_annotation_history_author_media_idx" ON "media_annotation_history" USING btree ("user_id","media_id","revision");--> statement-breakpoint
CREATE INDEX "media_annotations_author_updated_idx" ON "media_annotations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "label_export_rows_media_idx" ON "label_export_rows" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "label_exports_author_created_idx" ON "label_exports" USING btree ("user_id","snapshot_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_blocks_pair_idx" ON "social_blocks" USING btree ("user_id","blocked_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_comments_request_idx" ON "social_comments" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "social_comments_media_idx" ON "social_comments" USING btree ("media_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_reports_user_media_idx" ON "social_reports" USING btree ("user_id","media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_saved_pair_idx" ON "social_saved_posts" USING btree ("user_id","media_id");--> statement-breakpoint
CREATE INDEX "social_events_user_time_idx" ON "social_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "creator_follows_profile_idx" ON "creator_follows" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "video_reviews_media_updated_idx" ON "video_reviews" USING btree ("media_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_signals_user_media_idx" ON "watch_signals" USING btree ("user_id","media_id");--> statement-breakpoint
CREATE INDEX "watch_signals_user_idx" ON "watch_signals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "video_views_media_visibility_idx" ON "video_views" USING btree ("media_id","visibility");--> statement-breakpoint
CREATE INDEX "watch_feed_sessions_user_created_idx" ON "watch_feed_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "import_files_job_idx" ON "import_files" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "import_jobs_user_created_idx" ON "import_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_accounts_user_provider_idx" ON "cloud_accounts" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "cloud_authorizations_expiry_idx" ON "cloud_authorizations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "membership_invitations_inviter_idx" ON "membership_invitations" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "members_referrer_idx" ON "members" USING btree ("referred_by");--> statement-breakpoint
CREATE UNIQUE INDEX "access_invites_pending_email_idx" ON "access_invitations" USING btree ("email") WHERE "access_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "access_invites_status_expiry_idx" ON "access_invitations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "access_members_active_email_idx" ON "access_memberships" USING btree ("email") WHERE "access_memberships"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "access_members_one_owner_idx" ON "access_memberships" USING btree ("role") WHERE "access_memberships"."role" = 'owner' and "access_memberships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "access_members_role_status_idx" ON "access_memberships" USING btree ("role","status");--> statement-breakpoint
CREATE INDEX "curator_duels_labeler_idx" ON "curator_duels" USING btree ("labeler_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "curator_item_tags_unique_idx" ON "curator_item_tags" USING btree ("item_id","tag","provenance");--> statement-breakpoint
CREATE INDEX "curator_item_tags_tag_idx" ON "curator_item_tags" USING btree ("tag");--> statement-breakpoint
CREATE UNIQUE INDEX "curator_items_source_post_idx" ON "curator_items" USING btree ("owner_account_id","source","source_post_id");--> statement-breakpoint
CREATE INDEX "curator_items_media_idx" ON "curator_items" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "curator_items_sha_idx" ON "curator_items" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "curator_label_history_label_idx" ON "curator_label_history" USING btree ("label_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "curator_labels_item_labeler_idx" ON "curator_labels" USING btree ("item_id","labeler_account_id");--> statement-breakpoint
CREATE INDEX "curator_labels_labeler_idx" ON "curator_labels" USING btree ("labeler_account_id");--> statement-breakpoint
CREATE INDEX "curator_labels_verdict_idx" ON "curator_labels" USING btree ("labeler_account_id","verdict");--> statement-breakpoint
CREATE UNIQUE INDEX "curator_observations_client_event_idx" ON "curator_observations" USING btree ("labeler_account_id","client_event_id");--> statement-breakpoint
CREATE INDEX "curator_observations_item_idx" ON "curator_observations" USING btree ("item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "curator_tokens_labeler_idx" ON "curator_tokens" USING btree ("labeler_account_id");