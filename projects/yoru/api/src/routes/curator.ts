import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, count, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  curatorDuelsTable as duels,
  curatorItemTagsTable as itemTags,
  curatorItemsTable as items,
  curatorLabelHistoryTable as labelHistory,
  curatorLabelsTable as labelTable,
  curatorObservationsTable as observations,
  curatorTokensTable as tokens,
  mediaItemsTable as media,
} from "@workspace/db";
import {
  curatorDuelInputSchema,
  curatorItemInputSchema,
  curatorLabelInputSchema,
  curatorLinkSchema,
  curatorObservationBatchSchema,
  MAX_LABELS_PER_BATCH,
} from "../lib/curator-labels";
import {
  CURATOR_SCOPE,
  getCuratorUserId,
  hashToken,
  issueToken,
  requireCuratorIdentity,
  requireSessionIdentity,
} from "../lib/curator-auth";
import { tagKey, tagKeyFellBack } from "../lib/tag-key";
import { accessibleMedia, socialLimit, SocialError } from "../lib/social-access";

const router: IRouter = Router();
router.use("/curator", requireCuratorIdentity, (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});

const run = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch((error: unknown) => {
      const status = (error as { status?: number }).status;
      if (error instanceof SocialError) return res.status(error.status).json({ error: error.message });
      if (typeof status === "number") return res.status(status).json({ error: (error as Error).message });
      return next(error);
    });
  };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function upsertItem(tx: Tx, input: typeof curatorItemInputSchema._output, ownerAccountId: string) {
  const [row] = await tx
    .insert(items)
    .values({
      ownerAccountId,
      source: input.source,
      sourcePostId: input.sourcePostId,
      sha256: input.sha256 ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      rating: input.rating ?? null,
      score: input.score ?? null,
    })
    .onConflictDoUpdate({
      target: [items.ownerAccountId, items.source, items.sourcePostId],
      set: {
        updatedAt: new Date(),
        ...(input.sha256 ? { sha256: input.sha256 } : {}),
        ...(input.width ? { width: input.width } : {}),
        ...(input.height ? { height: input.height } : {}),
        ...(input.rating ? { rating: input.rating } : {}),
        ...(input.score !== undefined ? { score: input.score } : {}),
      },
    })
    .returning();
  if (!row) throw new SocialError(500, "Could not record curator item.");
  return row;
}

async function upsertTags(tx: Tx, itemId: string, tags: typeof curatorItemInputSchema._output["tags"], assertedBy: string) {
  for (const tag of tags) {
    const key = tagKey(tag.tag);
    await tx
      .insert(itemTags)
      .values({
        itemId,
        tag: key,
        rawTag: tag.rawTag ?? tag.tag,
        state: tag.state,
        provenance: tag.provenance,
        confidence: tag.confidence ?? null,
        assertedBy,
        keyFallback: tagKeyFellBack(tag.rawTag ?? tag.tag),
      })
      .onConflictDoUpdate({
        target: [itemTags.itemId, itemTags.tag, itemTags.provenance],
        set: {
          state: tag.state,
          confidence: tag.confidence ?? null,
          rawTag: tag.rawTag ?? tag.tag,
          assertedBy,
          assertedAt: new Date(),
        },
      });
  }
}

function labelDTO(row: typeof labelTable.$inferSelect) {
  return {
    itemId: row.itemId,
    verdict: row.verdict,
    reason: row.reason,
    dwellMs: row.dwellMs,
    zooms: row.zooms,
    mode: row.mode,
    revision: row.revision,
    schemaVersion: row.schemaVersion,
    taxonomyVersion: row.taxonomyVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.post("/curator/items", run(async (req, res) => {
  const uid = getCuratorUserId(req);
  const parsed = curatorItemInputSchema.safeParse(req.body);
  if (!parsed.success) throw new SocialError(400, "Invalid curator item.");
  const input = parsed.data;
  const item = await db.transaction(async (tx) => {
    const row = await upsertItem(tx, input, uid);
    await upsertTags(tx, row.id, input.tags, uid);
    return row;
  });
  res.status(201).json({ id: item.id, source: item.source, sourcePostId: item.sourcePostId });
}));

router.get("/curator/items/:id", run(async (req, res) => {
  const uid = getCuratorUserId(req);
  const id = String(req.params.id);
  const [item] = await db.select().from(items).where(and(eq(items.id, id), eq(items.ownerAccountId, uid))).limit(1);
  if (!item) throw new SocialError(404, "Curator item not found.");
  const [tags, label] = await Promise.all([
    db.select().from(itemTags).where(eq(itemTags.itemId, id)),
    db.select().from(labelTable).where(and(eq(labelTable.itemId, id), eq(labelTable.labelerAccountId, uid))).limit(1),
  ]);
  const history = label.length
    ? await db.select().from(labelHistory).where(eq(labelHistory.labelId, label[0].id)).orderBy(asc(labelHistory.revision))
    : [];
  res.json({
    item: {
      id: item.id, source: item.source, sourcePostId: item.sourcePostId, mediaId: item.mediaId,
      sha256: item.sha256, width: item.width, height: item.height, rating: item.rating, score: item.score,
    },
    tags: tags.map((t) => ({
      tag: t.tag, rawTag: t.rawTag, state: t.state, provenance: t.provenance,
      confidence: t.confidence, keyFallback: t.keyFallback, assertedAt: t.assertedAt.toISOString(),
    })),
    label: label.length ? labelDTO(label[0]) : null,
    history: history.map((h) => ({ revision: h.revision, schemaVersion: h.schemaVersion, payload: h.payload, createdAt: h.createdAt.toISOString() })),
  });
}));

router.post("/curator/items/:id/link", run(async (req, res) => {
  const uid = getCuratorUserId(req);
  const id = String(req.params.id);
  const parsed = curatorLinkSchema.safeParse(req.body);
  if (!parsed.success) throw new SocialError(400, "Invalid media link.");
  await accessibleMedia(parsed.data.mediaId, uid);
  const [existing] = await db.select({ mediaId: items.mediaId }).from(items).where(and(eq(items.id, id), eq(items.ownerAccountId, uid))).limit(1);
  if (!existing) throw new SocialError(404, "Curator item not found.");
  if (existing.mediaId && existing.mediaId !== parsed.data.mediaId) {
    throw new SocialError(409, "This item is already linked to different media.");
  }
  // Linking never touches labels, history or content tags.
  const [row] = await db.update(items).set({ mediaId: parsed.data.mediaId, updatedAt: new Date() })
    .where(and(eq(items.id, id), eq(items.ownerAccountId, uid))).returning();
  res.json({ id: row.id, mediaId: row.mediaId });
}));

router.post("/curator/labels", run(async (req, res) => {
  const uid = getCuratorUserId(req);
  await socialLimit(uid, "curator-label", 600);
  const parsed = curatorLabelInputSchema.safeParse(req.body);
  if (!parsed.success) throw new SocialError(400, "Invalid curator label.");
  const result = await saveLabel(uid, parsed.data);
  res.status(200).json(result);
}));

router.post("/curator/labels/batch", run(async (req, res) => {
  const uid = getCuratorUserId(req);
  const body = req.body as { labels?: unknown[] };
  if (!Array.isArray(body?.labels) || body.labels.length === 0 || body.labels.length > MAX_LABELS_PER_BATCH) {
    throw new SocialError(400, `Send between 1 and ${MAX_LABELS_PER_BATCH} labels.`);
  }
  await socialLimit(uid, "curator-label", 600);
  const results: unknown[] = [];
  for (const entry of body.labels) {
    const parsed = curatorLabelInputSchema.safeParse(entry);
    if (!parsed.success) {
      results.push({ ok: false, error: "Invalid curator label." });
      continue;
    }
    try {
      results.push({ ok: true, ...(await saveLabel(uid, parsed.data)) });
    } catch (error) {
      results.push({ ok: false, error: error instanceof SocialError ? error.message : "Could not save label." });
    }
  }
  res.json({ results });
}));

async function saveLabel(uid: string, input: typeof curatorLabelInputSchema._output) {
  return db.transaction(async (tx) => {
    const item = await upsertItem(tx, {
      source: input.source, sourcePostId: input.sourcePostId, tags: [],
    }, uid);

    await tx.insert(labelTable)
      .values({ itemId: item.id, labelerAccountId: uid, verdict: input.verdict })
      .onConflictDoNothing();
    const [current] = await tx.select().from(labelTable)
      .where(and(eq(labelTable.itemId, item.id), eq(labelTable.labelerAccountId, uid)))
      .for("update");
    if (!current) throw new SocialError(500, "Could not record curator label.");

    const receipt = input.clientEventId ? await tx.select({ revision: labelHistory.revision }).from(labelHistory)
      .where(and(eq(labelHistory.labelId, current.id), sql`${labelHistory.payload}->>'clientEventId' = ${input.clientEventId}`)).limit(1) : [];
    if (input.clientEventId && (current.clientEventId === input.clientEventId || receipt.length)) {
      return { itemId: item.id, revision: current.revision, verdict: current.verdict, duplicate: true };
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
      const same = current.revision === input.expectedRevision + 1 &&
        current.verdict === input.verdict &&
        (current.reason ?? null) === (input.reason ?? null) &&
        (current.dwellMs ?? null) === (input.dwellMs ?? null) &&
        current.zooms === input.zooms &&
        current.mode === input.mode;
      if (same) return { itemId: item.id, revision: current.revision, verdict: current.verdict, duplicate: true };
      throw new SocialError(409, "This judgment changed elsewhere. Reload before saving.");
    }

    if (input.tags?.length) await upsertTags(tx, item.id, input.tags, uid);
    const revision = current.revision + 1;
    const values = {
      verdict: input.verdict,
      reason: input.reason ?? null,
      dwellMs: input.dwellMs ?? null,
      zooms: input.zooms,
      mode: input.mode,
      revision,
      clientEventId: input.clientEventId ?? null,
      updatedAt: new Date(),
    };
    const [saved] = await tx.update(labelTable).set(values)
      .where(eq(labelTable.id, current.id)).returning();
    await tx.insert(labelHistory).values({
      labelId: current.id,
      labelerAccountId: uid,
      revision,
      schemaVersion: saved.schemaVersion,
      payload: { ...values, clientEventId: input.clientEventId ?? null, updatedAt: values.updatedAt.toISOString(), rawTags: input.tags ?? [] },
    });
    return { itemId: item.id, revision, verdict: saved.verdict, duplicate: false };
  });
}

router.post("/curator/duels", run(async (req, res) => {
  const uid = getCuratorUserId(req);
  const parsed = curatorDuelInputSchema.safeParse(req.body);
  if (!parsed.success) throw new SocialError(400, "Invalid duel.");
  const input = parsed.data;
  const row = await db.transaction(async (tx) => {
    const left = await upsertItem(tx, { ...input.left, tags: [] }, uid);
    const right = await upsertItem(tx, { ...input.right, tags: [] }, uid);
    if (left.id === right.id) throw new SocialError(400, "A duel needs two different items.");
    const [saved] = await tx.insert(duels).values({
      labelerAccountId: uid,
      leftItemId: left.id,
      rightItemId: right.id,
      outcome: input.outcome,
      dwellMs: input.dwellMs ?? null,
      sessionId: input.sessionId ?? null,
    }).returning();
    return saved;
  });
  res.status(201).json({ id: row.id, outcome: row.outcome });
}));

router.post("/curator/observations", run(async (req, res) => {
  const uid = getCuratorUserId(req);
  const parsed = curatorObservationBatchSchema.safeParse(req.body);
  if (!parsed.success) throw new SocialError(400, "Invalid observations.");
  const requestedIds = [...new Set(parsed.data.events.flatMap(e => e.itemId ? [e.itemId] : []))];
  if (requestedIds.length) {
    const owned = await db.select({id:items.id}).from(items).where(and(inArray(items.id, requestedIds), eq(items.ownerAccountId, uid)));
    if (owned.length !== requestedIds.length) throw new SocialError(404, "Curator item not found.");
  }
  const inserted = await db.insert(observations).values(parsed.data.events.map((event) => ({
    labelerAccountId: uid,
    clientEventId: event.clientEventId,
    itemId: event.itemId ?? null,
    type: event.type,
    sessionId: event.sessionId ?? null,
    payload: event.payload,
    occurredAt: new Date(event.occurredAt),
  }))).onConflictDoNothing().returning({ id: observations.id });
  res.status(201).json({ accepted: inserted.length, duplicates: parsed.data.events.length - inserted.length });
}));

router.get("/curator/export", run(async (req, res) => {
  const uid = getCuratorUserId(req);
  const since = typeof req.query.since === "string" ? new Date(req.query.since) : null;
  if (since && Number.isNaN(since.getTime())) throw new SocialError(400, "Invalid cursor.");
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200) || 200));

  const conditions = [eq(labelTable.labelerAccountId, uid)];
  if (since) conditions.push(gt(labelTable.updatedAt, since));
  const rows = await db.select({ label: labelTable, item: items })
    .from(labelTable).innerJoin(items, eq(items.id, labelTable.itemId))
    .where(and(...conditions)).orderBy(asc(labelTable.updatedAt)).limit(limit);
  const itemIds = rows.map((r) => r.item.id);
  const tags = itemIds.length ? await db.select().from(itemTags).where(inArray(itemTags.itemId, itemIds)) : [];
  const byItem = new Map<string, typeof itemTags.$inferSelect[]>();
  for (const tag of tags) {
    const list = byItem.get(tag.itemId) ?? [];
    list.push(tag);
    byItem.set(tag.itemId, list);
  }

  const lines = rows.map(({ label, item }) => JSON.stringify({
    recordType: "curator_label",
    schemaVersion: label.schemaVersion,
    taxonomyVersion: label.taxonomyVersion,
    labelerAccountId: label.labelerAccountId,
    item: {
      source: item.source, sourcePostId: item.sourcePostId, mediaId: item.mediaId,
      sha256: item.sha256, width: item.width, height: item.height, rating: item.rating, score: item.score,
    },
    label: {
      verdict: label.verdict, reason: label.reason, dwellMs: label.dwellMs, zooms: label.zooms,
      mode: label.mode, revision: label.revision, updatedAt: label.updatedAt.toISOString(),
    },
    tags: (byItem.get(item.id) ?? []).map((t) => ({
      tag: t.tag, rawTag: t.rawTag, state: t.state, provenance: t.provenance, keyFallback: t.keyFallback,
    })),
  }));
  res.set("Content-Type", "application/x-ndjson; charset=utf-8");
  res.set("X-Curator-Cursor", rows.length ? rows[rows.length - 1].label.updatedAt.toISOString() : (since?.toISOString() ?? ""));
  res.send(lines.join("\n") + (lines.length ? "\n" : ""));
}));

router.get("/curator/coverage", run(async (req, res) => {
  const uid = getCuratorUserId(req);
  const verdicts = await db.select({ verdict: labelTable.verdict, total: count() })
    .from(labelTable).where(eq(labelTable.labelerAccountId, uid)).groupBy(labelTable.verdict);
  // Tag coverage is scoped to items this labeler actually judged; content rows
  // are shared across accounts, so a global count would misreport personal coverage.
  const mine = await db.selectDistinct({ itemId: labelTable.itemId })
    .from(labelTable).where(eq(labelTable.labelerAccountId, uid));
  const myItemIds = mine.map((row) => row.itemId);
  const tagTotals = myItemIds.length
    ? await db.select({ total: count() }).from(itemTags).where(inArray(itemTags.itemId, myItemIds))
    : [{ total: 0 }];
  const fallback = myItemIds.length
    ? await db.select({ total: count() }).from(itemTags)
      .where(and(inArray(itemTags.itemId, myItemIds), eq(itemTags.keyFallback, true)))
    : [{ total: 0 }];
  const provenance = myItemIds.length
    ? await db.select({ provenance: itemTags.provenance, total: count() })
      .from(itemTags).where(inArray(itemTags.itemId, myItemIds)).groupBy(itemTags.provenance)
    : [];
  const itemsWithoutTags = await db.select({ total: count() }).from(items)
    .where(and(eq(items.ownerAccountId, uid), sql`not exists (select 1 from ${itemTags} where ${itemTags.itemId} = ${items.id})`));
  // Per-source breakdown so the local selector can reconcile once sync is on.
  const perSource = await db.select({ source: items.source, verdict: labelTable.verdict, total: count() })
    .from(labelTable).innerJoin(items, eq(items.id, labelTable.itemId))
    .where(eq(labelTable.labelerAccountId, uid)).groupBy(items.source, labelTable.verdict);
  const sourceMap = new Map<string, { source: string; total: number; verdicts: Record<string, number> }>();
  for (const row of perSource) {
    const entry = sourceMap.get(row.source) ?? { source: row.source, total: 0, verdicts: {} };
    entry.verdicts[row.verdict] = Number(row.total);
    entry.total += Number(row.total);
    sourceMap.set(row.source, entry);
  }
  const byVerdict = Object.fromEntries(verdicts.map((v) => [v.verdict, Number(v.total)]));
  res.json({
    verdicts: byVerdict,
    cantJudge: byVerdict.cant_judge ?? 0,
    sources: [...sourceMap.values()],
    tags: {
      total: Number(tagTotals[0]?.total ?? 0),
      normalizationFallback: Number(fallback[0]?.total ?? 0),
      provenance: Object.fromEntries(provenance.map((p) => [p.provenance, Number(p.total)])),
    },
    itemsWithoutTags: Number(itemsWithoutTags[0]?.total ?? 0),
  });
}));

router.get("/curator/tokens", run(async (req, res) => {
  const uid = getCuratorUserId(req);
  const rows = await db.select({
    id: tokens.id, label: tokens.label, createdAt: tokens.createdAt,
    lastUsedAt: tokens.lastUsedAt, revokedAt: tokens.revokedAt,
  }).from(tokens).where(eq(tokens.labelerAccountId, uid));
  res.json({ tokens: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null, revokedAt: r.revokedAt?.toISOString() ?? null })) });
}));

router.post("/curator/tokens", run(async (req, res) => {
  const uid = requireSessionIdentity(req);
  const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 80) || "curator" : "curator";
  const token = issueToken();
  const [row] = await db.insert(tokens).values({
    labelerAccountId: uid, tokenHash: hashToken(token), label, scopes: [CURATOR_SCOPE],
  }).returning();
  // The plaintext token is returned exactly once and never stored.
  res.status(201).json({ id: row.id, token, label: row.label, scopes: row.scopes });
}));

router.delete("/curator/tokens/:id", run(async (req, res) => {
  const uid = requireSessionIdentity(req);
  const [row] = await db.update(tokens).set({ revokedAt: new Date() })
    .where(and(eq(tokens.id, String(req.params.id)), eq(tokens.labelerAccountId, uid), isNull(tokens.revokedAt)))
    .returning({ id: tokens.id });
  if (!row) throw new SocialError(404, "Token not found.");
  res.json({ id: row.id, revoked: true });
}));

export default router;
