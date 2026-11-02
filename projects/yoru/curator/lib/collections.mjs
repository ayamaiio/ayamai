// Collection registry: named image sources with per-source progress.
// Pure helpers only — no HTTP, no image decoding.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;

export function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

export function emptyCounts() {
  return { like: 0, dislike: 0, neutral: 0, cant_judge: 0, skip: 0, blocked: 0, total: 0, lastAt: null };
}

/**
 * Accepts the new `collections` array, or the legacy single `dataset` block.
 * Legacy config yields exactly one collection, preserving old behaviour.
 */
export function normalizeCollections(cfg) {
  const raw = Array.isArray(cfg.collections) && cfg.collections.length
    ? cfg.collections
    : [{
      id: cfg.dataset?.repo ?? "danbooru2023",
      label: `${cfg.dataset?.repo ?? "dataset"} · ${cfg.dataset?.dir ?? "original"}`,
      kind: "hf-tar",
      repo: cfg.dataset?.repo,
      dir: cfg.dataset?.dir ?? "original",
      shards: cfg.dataset?.shards ?? 1,
      startShard: cfg.startShard ?? 0,
    }];

  return raw.map((collection) => ({
    kind: "hf-tar",
    shards: 1,
    startShard: 0,
    ...collection,
    path: collection.path ? expandHome(collection.path) : collection.path,
  }));
}

export function validateCollections(list) {
  const seen = new Set();
  for (const collection of list) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(collection.id)) {
      throw new Error(`invalid collection id: ${collection.id}`);
    }
    if (seen.has(collection.id)) throw new Error(`duplicate collection id: ${collection.id}`);
    seen.add(collection.id);
    if (collection.kind === "hf-tar" && (!collection.repo || !collection.dir)) {
      throw new Error(`collection ${collection.id} needs repo and dir`);
    }
    if (collection.kind === "folder" && !collection.path) {
      throw new Error(`collection ${collection.id} needs a path`);
    }
  }
  return list;
}

export function shardUrl(collection, shard) {
  return `https://huggingface.co/datasets/${collection.repo}/resolve/main/` +
    `${collection.dir}/data-${String(shard).padStart(4, "0")}.tar`;
}

/** Sorted image filenames, or null when the directory cannot be read. */
export function folderEntries(collection, fsImpl = fs) {
  try {
    return fsImpl.readdirSync(collection.path, { withFileTypes: true })
      .filter((entry) => entry.isFile() && IMAGE_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return null;
  }
}

export function folderTotal(collection) {
  const entries = folderEntries(collection);
  return entries ? entries.length : null;
}

/** Rows are normalized at boot so `collection` is always present. */
export function countByCollection(rows) {
  const counts = new Map();
  for (const row of rows) {
    const id = row.collection;
    if (!counts.has(id)) counts.set(id, emptyCounts());
    const bucket = counts.get(id);
    if (row.verdict && bucket[row.verdict] !== undefined) bucket[row.verdict] += 1;
    bucket.total += 1;
    if (!bucket.lastAt || row.ts > bucket.lastAt) bucket.lastAt = row.ts ?? null;
  }
  return counts;
}

export function lastRowFor(rows, collectionId) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].collection === collectionId) return rows[index];
  }
  return null;
}

/** Resume point for a collection, independent of every other collection. */
export function cursorFor(rows, collectionId, collection) {
  const row = lastRowFor(rows, collectionId);
  if (collection.kind === "folder") {
    return { index: row?.cursor?.nextIndex ?? 0 };
  }
  if (row?.cursor) return { shard: row.cursor.shard, offset: row.cursor.nextOffset };
  return { shard: collection.startShard ?? 0, offset: 0 };
}

export function resolveActive(cfg, list, storedActive) {
  const ids = new Set(list.map((c) => c.id));
  for (const candidate of [storedActive, cfg.activeCollection]) {
    if (candidate && ids.has(candidate)) return candidate;
  }
  return list[0]?.id ?? null;
}

/** Human-facing progress line for the selector. */
export function describeProgress(collection, counts) {
  const labeled = counts?.total ?? 0;
  if (collection.kind === "folder") {
    const total = folderTotal(collection);
    if (total === null) return `${labeled} labeled`;
    return `${labeled} labeled · ${Math.max(0, total - labeled)} left`;
  }
  return `${labeled} labeled`;
}
