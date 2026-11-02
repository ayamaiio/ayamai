#!/usr/bin/env node
// Ayamai Danbooru curator — local-only labelling tool with multiple sources.
// Streams images from remote tar shards (HTTP range) or local folders, one at a
// time, with per-source progress, prefetch, dwell timing and an API outbox.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { RangedTar, isImageEntry, postIdFromName } from "./lib/tar.mjs";
import { MetaCache, fetchMeta, tagsOf } from "./lib/danbooru.mjs";
import { Store } from "./lib/store.mjs";
import { imageSize } from "./lib/features.mjs";
import { enqueue, drain, recover, VERDICT_MAP } from "./lib/api.mjs";
import {
  normalizeCollections, validateCollections, shardUrl, folderEntries, folderTotal,
  countByCollection, emptyCounts, cursorFor, resolveActive, IMAGE_RE,
} from "./lib/collections.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// The front door proxies us under a prefix; direct use stays at the root.
const BASE = (process.env.BASE ?? "").replace(/\/$/, "");
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN ?? "http://localhost:4319").replace(/\/$/, "");
const cfg = JSON.parse(fs.readFileSync(process.env.CURATOR_CONFIG || path.join(ROOT, "config.example.json"), "utf8"));

if (cfg.api?.enabled) {
  const target = new URL(cfg.api.baseUrl);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(target.hostname) || target.username || target.password || target.pathname !== "/") throw new Error("Curator sync is restricted to the local Ayamai API.");
}
process.umask(0o077);
const DATA = process.env.CURATOR_DATA_DIR || path.join(ROOT, "../../.local/curator/data");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(DATA, "events"), { recursive: true });

const collections = validateCollections(normalizeCollections(cfg));
const byId = new Map(collections.map((collection) => [collection.id, collection]));
const legacyId = collections[0]?.id ?? null;

const SESSION = crypto.randomUUID();
fs.writeFileSync(path.join(DATA, "events", `session-${SESSION}.json`), JSON.stringify({
  session_id: SESSION,
  started_at: new Date().toISOString(),
  config: { collections: collections.map((c) => ({ id: c.id, kind: c.kind })), blockTags: cfg.blockTags, blockRatings: cfg.blockRatings, reasons: cfg.reasons ?? null, duel: cfg.duel ?? null },
}, null, 2));

const store = new Store(DATA, { legacyCollection: legacyId });
if (cfg.api?.enabled === true) recover(DATA, store.rows.flatMap(row => row.syncPayload ? [row.syncPayload] : []));
const metaCache = new MetaCache(path.join(DATA, "meta-cache.jsonl"));
const blockTags = new Set((cfg.blockTags || []).map((t) => t.toLowerCase().replace(/_/g, " ")));
const blockRatings = new Set(cfg.blockRatings || []);

const events = fs.createWriteStream(path.join(DATA, "events.jsonl"), { flags: "a" });
const duels = fs.createWriteStream(path.join(DATA, "duels.jsonl"), { flags: "a" });
function logEvent(ev) {
  events.write(JSON.stringify({ ts: new Date().toISOString(), session_id: SESSION, collection: activeId, ...ev }) + "\n");
}

// ---- per-collection state -------------------------------------------------
const ACTIVE_FILE = path.join(DATA, "active.json");
let storedActive = null;
try { storedActive = JSON.parse(fs.readFileSync(ACTIVE_FILE, "utf8")).active ?? null; } catch {}
let activeId = resolveActive(cfg, collections, storedActive);

const counts = countByCollection(store.rows);
for (const collection of collections) if (!counts.has(collection.id)) counts.set(collection.id, emptyCounts());

let cursor = cursorFor(store.rows, activeId, byId.get(activeId));
let reader = null;
let readerShard = -1;
let current = null;
let prefetched = null;
let prefetching = null;
let generation = 0;
let folderCache = { id: null, entries: null };

const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const activeCollection = () => byId.get(activeId);

function bump(id, verdict, delta) {
  const bucket = counts.get(id) ?? emptyCounts();
  if (bucket[verdict] !== undefined) bucket[verdict] += delta;
  bucket.total += delta;
  bucket.lastAt = new Date().toISOString();
  counts.set(id, bucket);
}

function activate(id) {
  const collection = byId.get(id);
  if (!collection) throw new Error(`unknown collection: ${id}`);
  generation += 1;
  activeId = id;
  current = null;
  currentPromise = null;
  prefetched = null;
  prefetching = null;
  reader = null;
  readerShard = -1;
  folderCache = { id: null, entries: null };
  cursor = cursorFor(store.rows, id, collection);
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify({ active: id, updated_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  return collection;
}

function blocked(meta) {
  if (!meta || meta.missing || meta.unavailable) return null;
  if (blockRatings.size && meta.rating && blockRatings.has(meta.rating)) return `rating:${meta.rating}`;
  if (!blockTags.size) return null;
  for (const tag of tagsOf(meta)) {
    const t = String(tag).toLowerCase().replace(/_/g, " ");
    if (blockTags.has(t)) return `tag:${tag}`;
  }
  return null;
}

async function getReader(collection, shard) {
  if (readerShard === shard && reader) return reader;
  reader = new RangedTar(shardUrl(collection, shard));
  readerShard = shard;
  await reader.size();
  return reader;
}

function entryFor(collection) {
  if (collection.kind === "folder") {
    if (folderCache.id !== collection.id) folderCache = { id: collection.id, entries: folderEntries(collection) };
    return folderCache.entries;
  }
  return null;
}

async function loadNextTar(collection) {
  for (let guard = 0; guard < 500; guard += 1) {
    if (cursor.shard >= (collection.shards ?? 1)) throw new Error("collection complete");
    const r = await getReader(collection, cursor.shard);
    let entry;
    try { entry = await r.nextEntry(cursor.offset); }
    catch (err) { throw new Error(`shard read failed at ${cursor.shard}:${cursor.offset}: ${err.message}`); }
    if (!entry) { cursor = { shard: cursor.shard + 1, offset: 0 }; continue; }

    const entryCursor = { shard: cursor.shard, offset: cursor.offset, nextOffset: entry.nextOffset };
    cursor = { shard: cursor.shard, offset: entry.nextOffset };

    if (!isImageEntry(entry.name) || entry.size === 0) continue;
    const id = postIdFromName(entry.name);
    if (!id || store.isDecided(collection.id, id)) continue;

    const ext = (entry.name.split(".").pop() || "jpg").toLowerCase();
    const meta = cfg.metadata ? await fetchMeta(id, metaCache) : null;
    const blockedReason = blocked(meta);
    if (blockedReason) {
      countBlocked(collection.id, id, blockedReason, entryCursor, entry);
      continue;
    }
    const buf = await r.readEntry(entry);
    return buildItem(collection, id, ext, buf, meta, { name: entry.name, size: entry.size, dataOffset: entry.dataOffset }, entryCursor);
  }
  throw new Error("no suitable image found in 500 entries");
}

function countBlocked(collectionId, id, reason, cursorValue, entry) {
  logEvent({ type: "blocked", post_id: id, reason });
  store.record({ ts: new Date().toISOString(), session_id: SESSION, collection: collectionId, id, verdict: "blocked", reason, cursor: cursorValue, entry: { name: entry.name, size: entry.size }, meta: null });
  bump(collectionId, "blocked", 1);
}

async function loadNextFolder(collection) {
  const entries = entryFor(collection);
  if (!entries) throw new Error(`cannot read folder: ${collection.path}`);
  for (let guard = 0; guard < 5000; guard += 1) {
    if (cursor.index >= entries.length) throw new Error("collection complete");
    const index = cursor.index;
    const name = entries[index];
    const id = path.parse(name).name;
    cursor = { index: index + 1 };
    if (store.isDecided(collection.id, id)) continue;
    const buf = fs.readFileSync(path.join(collection.path, name));
    const ext = (name.split(".").pop() || "jpg").toLowerCase();
    return buildItem(collection, id, ext, buf, null, { name, size: buf.length }, { index, nextIndex: index + 1 });
  }
  throw new Error("no suitable image found in 5000 files");
}

function buildItem(collection, id, ext, buf, meta, entry, cursorValue) {
  return {
    id, ext, buf, meta, entry, cursor: cursorValue, collection: collection.id,
    features: {
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      ...imageSize(buf), bytes: buf.length, format: ext,
      rating: meta?.rating ?? null, score: meta?.score ?? null, created_at: meta?.created_at ?? null,
    },
  };
}

function loadNext() {
  const collection = activeCollection();
  if (!collection) throw new Error("no active collection");
  return collection.kind === "folder" ? loadNextFolder(collection) : loadNextTar(collection);
}

function prefetch() {
  if (prefetched || prefetching) return;
  const gen = generation;
  prefetching = loadNext()
    .then((img) => { if (gen === generation) prefetched = img; })
    .catch((err) => logEvent({ type: "prefetch_error", error: String(err.message || err) }))
    .finally(() => { if (gen === generation) prefetching = null; });
}

let currentPromise = null;
async function ensureCurrent() {
  if (current) return current;
  if (currentPromise) return currentPromise;
  const gen = generation;
  const pending = (async () => {
    if (prefetching) await prefetching;
    const img = prefetched || await loadNext();
    if (gen !== generation) throw new Error("collection changed; retry");
    prefetched = null;
    current = { ...img, shownAt: Date.now(), viewed: { zooms: 0 } };
    prefetch();
    return current;
  })();
  currentPromise = pending;
  try { return await pending; }
  finally { if (currentPromise === pending) currentPromise = null; }
}

function collectionPayload(collection) {
  const bucket = counts.get(collection.id) ?? emptyCounts();
  const base = {
    id: collection.id, label: collection.label, kind: collection.kind,
    counts: bucket,
    active: collection.id === activeId,
    disabledReason: null,
  };
  if (collection.kind === "folder") {
    const total = folderTotal(collection);
    return {
      ...base, total, shard: null, shards: null,
      remaining: total === null ? null : Math.max(0, total - bucket.total),
      disabledReason: total === null ? "folder unreadable" : null,
    };
  }
  return {
    ...base,
    shards: collection.shards ?? 1,
    shard: collection.id === activeId ? cursor.shard : null,
    total: null,
    remaining: null,
  };
}

function itemPayload(img) {
  const bucket = counts.get(img.collection) ?? emptyCounts();
  return {
    id: img.id, ext: img.ext, size: img.buf.length, features: img.features,
    tags: img.meta?.tags
      ? { artist: img.meta.tags.artist, character: img.meta.tags.character, copyright: img.meta.tags.copyright, general: img.meta.tags.general.slice(0, 48) }
      : null,
    rating: img.meta?.rating ?? null, score: img.meta?.score ?? null,
    collection: img.collection,
    canUndo: store.rows.length > 0, session_id: SESSION,
    reasons: cfg.reasons ?? null, duel: cfg.duel ?? null,
  };
}

const json = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const host = req.headers.host ?? "";
  const publicHosts = (() => {
    try {
      const parsed = new URL(PUBLIC_ORIGIN);
      return [parsed.host, parsed.host.replace("localhost", "127.0.0.1")];
    } catch { return []; }
  })();
  if (![ `localhost:${port}`, `127.0.0.1:${port}`, ...publicHosts ].includes(host)) return json(res, 403, { error: "Invalid host" });
  const origin = req.headers.origin;
  if (origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`, PUBLIC_ORIGIN, PUBLIC_ORIGIN.replace("localhost", "127.0.0.1")].includes(origin)) return json(res, 403, { error: "Invalid origin" });
  try {
    if (BASE && url.pathname.startsWith(BASE)) url.pathname = url.pathname.slice(BASE.length) || "/";
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = fs.readFileSync(path.join(ROOT, "public", "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(String(html).replace("<head>", `<head><base href="${BASE || ""}/">`));
    }

    if (url.pathname === "/api/healthz") return json(res, 200, { status: "ok", sync: cfg.api?.enabled ? "enabled" : "disabled" });
    if (url.pathname === "/api/state") {
      return json(res, 200, {
        ready: !!current, session_id: SESSION, active: activeId,
        collections: collections.map(collectionPayload),
        blockTags: [...blockTags],
      });
    }

    if (url.pathname === "/api/collections") {
      return json(res, 200, { active: activeId, collections: collections.map(collectionPayload) });
    }

    if (url.pathname === "/api/collection" && req.method === "POST") {
      const body = await readJson(req);
      const id = typeof body?.id === "string" ? body.id : "";
      if (!byId.has(id)) return json(res, 400, { error: `unknown collection: ${id || "(none)"}` });
      activate(id);
      prefetch();
      return json(res, 200, { active: activeId, collections: collections.map(collectionPayload) });
    }

    if (url.pathname === "/api/next") {
      let img;
      try { img = await ensureCurrent(); }
      catch (error) { if (error.message === "collection complete") return json(res,200,{complete:true}); throw error; }
      logEvent({ type: "shown", post_id: img.id, preloaded: !!prefetched, features: img.features });
      return json(res, 200, itemPayload(img));
    }

    if (url.pathname === "/api/image") {
      if (!current) return json(res, 404, { error: "no current image" });
      res.writeHead(200, { "content-type": MIME[current.ext] || "application/octet-stream", "content-length": current.buf.length, "cache-control": "no-store" });
      return res.end(current.buf);
    }

    if (url.pathname.startsWith("/api/keep/")) {
      const id = url.pathname.slice("/api/keep/".length);
      if (!/^[A-Za-z0-9._-]+$/.test(id)) return json(res, 400, { error: "bad id" });
      const file = store.keepFile(activeId, id);
      if (!file) return json(res, 404, { error: "not kept" });
      const ext = file.split(".").pop().toLowerCase();
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-store" });
      return fs.createReadStream(file).pipe(res);
    }

    if (url.pathname === "/api/event" && req.method === "POST") {
      const body = await readJson(req);
      if (current && body.type === "zoom") {
        current.viewed.zooms += 1;
        logEvent({ type: "zoom", post_id: current.id, level: body.level ?? 1, zooms: current.viewed.zooms });
      }
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/duel" && req.method === "GET") {
      if (!cfg.duel?.enabled) return json(res, 409, { error: "duel disabled" });
      const img = await ensureCurrent();
      const others = store.keeps(activeId).filter((k) => String(k.id) !== String(img.id));
      if (!others.length) return json(res, 409, { error: "keep at least one image in this source first" });
      const right = others[Math.floor(Math.random() * others.length)];
      logEvent({ type: "duel_start", left: img.id, right: right.id });
      return json(res, 200, {
        left: { id: img.id, url: `/api/image?v=${Date.now()}`, features: img.features, tags: img.meta?.tags ?? null, rating: img.meta?.rating ?? null },
        right: { id: String(right.id), url: `/api/keep/${right.id}`, features: right.features ?? null, tags: (right.tags || []).slice(0, 48), rating: right.rating ?? null },
      });
    }

    if (url.pathname === "/api/duel" && req.method === "POST") {
      const body = await readJson(req);
      const { leftId, rightId, winner, dwell_ms } = body;
      if (!leftId || !rightId || !["left", "right", "tie"].includes(winner)) return json(res, 400, { error: "bad duel result" });
      duels.write(JSON.stringify({ ts: new Date().toISOString(), session_id: SESSION, collection: activeId, left_id: String(leftId), right_id: String(rightId), winner, dwell_ms: dwell_ms ?? null }) + "\n");
      logEvent({ type: "duel", left: leftId, right: rightId, winner, dwell_ms: dwell_ms ?? null });
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/decide" && req.method === "POST") {
      const body = await readJson(req);
      const verdict = body.verdict;
      if (!["like", "pass", "dislike", "neutral", "cant_judge", "skip"].includes(verdict)) return json(res, 400, { error: "bad verdict" });
      if (!current) return json(res, 409, { error: "no current image" });
      const img = current;
      if (body.id !== img.id || body.collection !== img.collection) return json(res, 409, { error: "Image changed; refresh before labeling" });
      const dwell_ms = Number.isFinite(body.dwell_ms) ? body.dwell_ms : Date.now() - img.shownAt;
      const reason = typeof body.reason === "string" && body.reason ? body.reason : null;

      if (verdict === "like") {
        store.like({ collection: img.collection, id: img.id, ext: img.ext, buf: img.buf, meta: img.meta, cursor: img.cursor, entry: img.entry, dataset: activeCollection()?.repo ?? activeId, shard: img.cursor?.shard ?? null });
      }
      const clientEventId = crypto.randomUUID();
      const syncPayload = {
        source: img.collection, sourcePostId: img.id, verdict: VERDICT_MAP[verdict] ?? "skip",
        reason: reason ?? undefined, dwellMs: Math.min(3600000, Math.max(0, Math.round(dwell_ms))),
        zooms: img.viewed.zooms, mode: "queue", clientEventId,
        tags: tagsOf(img.meta).slice(0,120).map(tag => ({tag,provenance:"source",state:"present"})),
      };
      store.record({
        syncPayload, clientEventId,
        ts: new Date().toISOString(), session_id: SESSION, collection: img.collection, id: img.id, verdict,
        reason, dwell_ms, zooms: img.viewed.zooms, cursor: img.cursor, entry: img.entry,
        features: img.features, meta: img.meta ? { rating: img.meta.rating, score: img.meta.score } : null,
      });
      bump(img.collection, verdict, 1);
      logEvent({ type: "decide", post_id: img.id, verdict, reason, dwell_ms, zooms: img.viewed.zooms, preloaded: !!prefetched, features: img.features });

      if (cfg.api?.enabled === true) {
        enqueue(DATA, syncPayload);
        void drain(DATA, cfg);
      }

      current = null;
      return json(res, 200, { ok: true, saved: true, counts: counts.get(activeId) });
    }

    if (url.pathname === "/api/undo" && req.method === "POST") {
      const row = store.undo();
      if (!row) return json(res, 409, { error: "nothing to undo" });
      bump(row.collection ?? legacyId, row.verdict, -1);
      if (cfg.api?.enabled === true) {
        enqueue(DATA, { source: row.collection ?? legacyId, sourcePostId: row.id, verdict: "skip", mode: "inspect", clientEventId: crypto.randomUUID() });
        void drain(DATA, cfg);
      }
      logEvent({ type: "undo", post_id: row.id, undid_verdict: row.verdict, original_dwell_ms: row.dwell_ms ?? null });
      if (row.collection !== activeId) activate(row.collection ?? legacyId);
      current = null; prefetched = null; generation += 1;
      cursor = row.cursor
        ? (row.cursor.nextIndex !== undefined ? { index: row.cursor.index } : { shard: row.cursor.shard, offset: row.cursor.offset })
        : cursor;
      const next = await ensureCurrent();
      return json(res, 200, { ok: true, undid: row.id, id: next.id, active: activeId });
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error("[curator]", err.message);
    json(res, 502, { error: String(err.message || err) });
  }
});

server.on("error", () => { console.error("Curator loopback port unavailable"); process.exit(1); });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => {
  events.end(); duels.end(); server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

const port = Number(process.env.PORT || cfg.port || 4319);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid Curator port");
server.listen(port, "127.0.0.1", () => {
  console.log(`curator: http://localhost:${port}  session ${SESSION.slice(0, 8)}`);
  console.log(`active: ${activeId} (${collections.length} collection${collections.length === 1 ? "" : "s"})`);
  for (const collection of collections) {
    const bucket = counts.get(collection.id);
    console.log(`  ${collection.id}: ${bucket.total} labeled`);
  }
  prefetch();
  void drain(DATA, cfg);
  setInterval(() => void drain(DATA, cfg), 10000).unref();
});
