import { z } from "zod/v4";

/**
 * Curator vocabularies. Content and preference are deliberately different
 * domains: a tag can be absent or unknown, a preference cannot.
 */

export const PREFERENCE_VERDICTS = ["like", "neutral", "dislike", "skip", "cant_judge"] as const;
export const TAG_STATES = ["present", "absent", "unknown"] as const;
export const TAG_PROVENANCE = ["source", "model", "human"] as const;
export const LABEL_MODES = ["queue", "duel", "inspect"] as const;
export const DUEL_OUTCOMES = ["left", "right", "tie", "neither", "cant_compare"] as const;
export const OBSERVATION_TYPES = ["shown", "decided", "zoom", "undo", "session_start", "session_end"] as const;

export type PreferenceVerdict = (typeof PREFERENCE_VERDICTS)[number];
export type TagState = (typeof TAG_STATES)[number];
export type TagProvenance = (typeof TAG_PROVENANCE)[number];

export const MAX_TAGS_PER_ITEM = 200;
export const MAX_OBSERVATIONS_PER_BATCH = 500;
export const MAX_LABELS_PER_BATCH = 200;

const sourceSchema = z.string().trim().min(1).max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/:-]*$/, "Invalid source.");
const sourcePostIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/, "Invalid source post id.");

export const curatorItemRefSchema = z.object({
  source: sourceSchema,
  sourcePostId: sourcePostIdSchema,
});

export const curatorTagInputSchema = z.object({
  tag: z.string().trim().min(1).max(120),
  rawTag: z.string().trim().min(1).max(200).optional(),
  state: z.enum(TAG_STATES).default("unknown"),
  provenance: z.enum(TAG_PROVENANCE),
  confidence: z.string().trim().max(40).optional(),
});

export const curatorItemInputSchema = curatorItemRefSchema.extend({
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  width: z.number().int().positive().max(100000).optional(),
  height: z.number().int().positive().max(100000).optional(),
  rating: z.string().trim().max(20).optional(),
  score: z.number().int().min(-1000000).max(1000000).optional(),
  tags: z.array(curatorTagInputSchema).max(MAX_TAGS_PER_ITEM).default([]),
});

export const curatorLabelInputSchema = curatorItemRefSchema.extend({
  verdict: z.enum(PREFERENCE_VERDICTS),
  reason: z.enum(["character", "style", "content", "quality", "other"]).optional(),
  dwellMs: z.number().int().min(0).max(3_600_000).optional(),
  zooms: z.number().int().min(0).max(1000).default(0),
  mode: z.enum(LABEL_MODES).default("queue"),
  expectedRevision: z.number().int().min(0).max(1_000_000).optional(),
  clientEventId: z.string().trim().min(8).max(80).optional(),
  tags: z.array(curatorTagInputSchema).max(MAX_TAGS_PER_ITEM).optional(),
});

export const curatorDuelInputSchema = z.object({
  left: curatorItemRefSchema,
  right: curatorItemRefSchema,
  outcome: z.enum(DUEL_OUTCOMES),
  dwellMs: z.number().int().min(0).max(3_600_000).optional(),
  sessionId: z.string().trim().max(80).optional(),
});

export const curatorObservationSchema = z.object({
  clientEventId: z.string().trim().min(8).max(80),
  type: z.enum(OBSERVATION_TYPES),
  itemId: z.uuid().optional(),
  sessionId: z.string().trim().max(80).optional(),
  occurredAt: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const curatorObservationBatchSchema = z.object({
  events: z.array(curatorObservationSchema).min(1).max(MAX_OBSERVATIONS_PER_BATCH),
});

export const curatorLinkSchema = z.object({ mediaId: z.uuid() });

export interface CuratorLabelView {
  itemId: string;
  source: string;
  sourcePostId: string;
  verdict: PreferenceVerdict;
  reason: string | null;
  revision: number;
  schemaVersion: number;
  taxonomyVersion: number;
  mode: string;
  updatedAt: string;
}
