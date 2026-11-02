-- REVIEW ONLY: additive Curator tables; no automatic production migration.
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
CREATE TABLE "curator_label_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label_id" uuid NOT NULL,
	"labeler_account_id" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
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
ALTER TABLE "curator_duels" ADD CONSTRAINT "curator_duels_left_item_id_curator_items_id_fk" FOREIGN KEY ("left_item_id") REFERENCES "public"."curator_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "curator_duels" ADD CONSTRAINT "curator_duels_right_item_id_curator_items_id_fk" FOREIGN KEY ("right_item_id") REFERENCES "public"."curator_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "curator_item_tags" ADD CONSTRAINT "curator_item_tags_item_id_curator_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."curator_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "curator_items" ADD CONSTRAINT "curator_items_media_id_media_items_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_items"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "curator_label_history" ADD CONSTRAINT "curator_label_history_label_id_curator_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."curator_labels"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "curator_labels" ADD CONSTRAINT "curator_labels_item_id_curator_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."curator_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "curator_observations" ADD CONSTRAINT "curator_observations_item_id_curator_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."curator_items"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "curator_duels_labeler_idx" ON "curator_duels" USING btree ("labeler_account_id","created_at");
CREATE UNIQUE INDEX "curator_item_tags_unique_idx" ON "curator_item_tags" USING btree ("item_id","tag","provenance");
CREATE INDEX "curator_item_tags_tag_idx" ON "curator_item_tags" USING btree ("tag");
CREATE UNIQUE INDEX "curator_items_source_post_idx" ON "curator_items" USING btree ("owner_account_id","source","source_post_id");
CREATE INDEX "curator_items_media_idx" ON "curator_items" USING btree ("media_id");
CREATE INDEX "curator_items_sha_idx" ON "curator_items" USING btree ("sha256");
CREATE INDEX "curator_label_history_label_idx" ON "curator_label_history" USING btree ("label_id","revision");
CREATE UNIQUE INDEX "curator_labels_item_labeler_idx" ON "curator_labels" USING btree ("item_id","labeler_account_id");
CREATE INDEX "curator_labels_labeler_idx" ON "curator_labels" USING btree ("labeler_account_id");
CREATE INDEX "curator_labels_verdict_idx" ON "curator_labels" USING btree ("labeler_account_id","verdict");
CREATE UNIQUE INDEX "curator_observations_client_event_idx" ON "curator_observations" USING btree ("labeler_account_id","client_event_id");
CREATE INDEX "curator_observations_item_idx" ON "curator_observations" USING btree ("item_id","occurred_at");
CREATE INDEX "curator_tokens_labeler_idx" ON "curator_tokens" USING btree ("labeler_account_id");
