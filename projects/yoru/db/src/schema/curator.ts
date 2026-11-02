import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { mediaItemsTable } from "./mediaItems";

/**
 * Curator stores judgments about media that may never enter the Ayamai library.
 * Three concerns stay separate, permanently:
 *   1. content     — what an item contains (curator_item_tags)
 *   2. preference  — how the labeler feels (curator_labels)
 *   3. observation — raw, append-only events (curator_observations)
 * Nothing derived (scores, affinity, rankings) is written here.
 */

export const curatorItemsTable = pgTable(
  "curator_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerAccountId: text("owner_account_id").notNull(),
    source: text("source").notNull(),
    sourcePostId: text("source_post_id").notNull(),
    // Set only when this external item is later imported into the library.
    // Linking must never rewrite existing judgments.
    mediaId: uuid("media_id").references(() => mediaItemsTable.id, { onDelete: "set null" }),
    sha256: text("sha256"),
    width: integer("width"),
    height: integer("height"),
    rating: text("rating"),
    score: integer("score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("curator_items_source_post_idx").on(table.ownerAccountId, table.source, table.sourcePostId),
    index("curator_items_media_idx").on(table.mediaId),
    index("curator_items_sha_idx").on(table.sha256),
  ],
);

export const curatorItemTagsTable = pgTable(
  "curator_item_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => curatorItemsTable.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    rawTag: text("raw_tag").notNull(),
    state: text("state").notNull().default("unknown"),
    provenance: text("provenance").notNull(),
    confidence: text("confidence"),
    // True when the tag needed the conservative fallback path rather than a
    // canonical hashtag. Reported separately from missing tags.
    keyFallback: boolean("key_fallback").notNull().default(false),
    assertedBy: text("asserted_by"),
    assertedAt: timestamp("asserted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("curator_item_tags_unique_idx").on(table.itemId, table.tag, table.provenance),
    index("curator_item_tags_tag_idx").on(table.tag),
  ],
);

export const curatorLabelsTable = pgTable(
  "curator_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => curatorItemsTable.id, { onDelete: "cascade" }),
    labelerAccountId: text("labeler_account_id").notNull(),
    verdict: text("verdict").notNull(),
    reason: text("reason"),
    dwellMs: integer("dwell_ms"),
    zooms: integer("zooms").notNull().default(0),
    mode: text("mode").notNull().default("queue"),
    revision: integer("revision").notNull().default(0),
    schemaVersion: integer("schema_version").notNull().default(1),
    taxonomyVersion: integer("taxonomy_version").notNull().default(1),
    clientEventId: text("client_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("curator_labels_item_labeler_idx").on(table.itemId, table.labelerAccountId),
    index("curator_labels_labeler_idx").on(table.labelerAccountId),
    index("curator_labels_verdict_idx").on(table.labelerAccountId, table.verdict),
  ],
);

export const curatorLabelHistoryTable = pgTable(
  "curator_label_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labelId: uuid("label_id").notNull().references(() => curatorLabelsTable.id, { onDelete: "cascade" }),
    labelerAccountId: text("labeler_account_id").notNull(),
    revision: integer("revision").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("curator_label_history_label_idx").on(table.labelId, table.revision)],
);

export const curatorDuelsTable = pgTable(
  "curator_duels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labelerAccountId: text("labeler_account_id").notNull(),
    leftItemId: uuid("left_item_id").notNull().references(() => curatorItemsTable.id, { onDelete: "cascade" }),
    rightItemId: uuid("right_item_id").notNull().references(() => curatorItemsTable.id, { onDelete: "cascade" }),
    outcome: text("outcome").notNull(),
    dwellMs: integer("dwell_ms"),
    sessionId: text("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("curator_duels_labeler_idx").on(table.labelerAccountId, table.createdAt)],
);

export const curatorObservationsTable = pgTable(
  "curator_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labelerAccountId: text("labeler_account_id").notNull(),
    clientEventId: text("client_event_id").notNull(),
    itemId: uuid("item_id").references(() => curatorItemsTable.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    sessionId: text("session_id"),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("curator_observations_client_event_idx").on(table.labelerAccountId, table.clientEventId),
    index("curator_observations_item_idx").on(table.itemId, table.occurredAt),
  ],
);

export const curatorTokensTable = pgTable(
  "curator_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labelerAccountId: text("labeler_account_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull().default("curator"),
    scopes: text("scopes").array().notNull().default(["curator:write"]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("curator_tokens_labeler_idx").on(table.labelerAccountId)],
);
