// The scan: every drive, for audio, with an index that survives a restart.
//
// uta does not copy music. It remembers where the files are, so a track plays
// from where it already lives and a rescan is a diff rather than a duplicate.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { page } from "../../packages/core/page.mjs";
import { walk, rootDrives, progressLine } from "../../packages/core/scan.mjs";
import { AUDIO_EXT, fromFilename, fileId, readId3, VAULT } from "./library.mjs";

// Resolved per call, not at import: a test that sets AYAMAI_DATA must reach the
// same file the scanner writes.
export const dataDir = () => path.join(process.env.AYAMAI_DATA ?? path.join(process.env.HOME ?? ".", ".local/share/ayamai"), "uta");
export const indexFile = () => path.join(dataDir(), "index.json");
export const cacheFile = () => path.join(dataDir(), "scan-cache.json");

const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; } };
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + process.pid + ".tmp";
  writeFileSync(temp, JSON.stringify(value) + "\n");
  renameSync(temp, file);
};

/** Directories that usually hold music, walked before the rest. */
export const likelyMusic = (name) => /music|soundtrack|\bost\b|albums?|audio|beats|songs|sound\b/i.test(String(name ?? ""));

/**
 * Pure: order the drives by which one looks like it holds media. One readdir per
 * root is cheap, and it means a machine whose music is on Z: hears its first
 * track in seconds instead of after walking C:.
 */
export function orderRoots(roots, readdir = (dir) => { try { return readdirSync(dir).map(String); } catch { return []; } }) {
  const scored = roots.map((root) => ({ root, score: readdir(root).filter(likelyMusic).length }));
  return scored.sort((a, b) => b.score - a.score || a.root.localeCompare(b.root)).map((entry) => entry.root);
}

export const readIndex = (file = indexFile()) => readJson(file, { at: 0, roots: [], tracks: [] });

/** The parsed index, kept until the file changes. Playback asks for it per byte. */
let indexCache = { key: "", value: null };
export function cachedIndex(file = indexFile()) {
  let key = "";
  try {
    const info = statSync(file);
    key = info.mtimeMs + ":" + info.size;
  } catch {
    return { at: 0, roots: [], tracks: [] };
  }
  if (indexCache.value && indexCache.key === key) return indexCache.value;
  try {
    const value = readIndex(file);
    indexCache = { key, value };
    return value;
  } catch {
    // a write in progress: keep the last good read rather than an empty library
    return indexCache.value ?? { at: 0, roots: [], tracks: [] };
  }
}
export const readCache = (file = cacheFile()) => readJson(file, {});
export const writeIndex = (index, file = indexFile()) => {
  indexCache = { key: "", value: null };
  return writeJson(file, index);
};
export const writeCache = (cache, file = cacheFile()) => writeJson(file, cache);

/** One file on disk becomes one track. Never throws. */
export function trackFromFile(record) {
  const absolute = record.path;
  let head = null;
  try { head = readFileSync(absolute, { flag: "r" }).subarray(0, 256 * 1024); } catch { head = null; }
  const tags = head ? readId3(head) : null;
  const fallback = fromFilename(absolute);
  return {
    id: fileId(absolute),
    kind: "owned",
    path: absolute,
    root: record.root ?? null,
    size: Number(record.size) || 0,
    mtimeMs: Number(record.mtimeMs) || 0,
    title: tags?.title ?? fallback.title,
    artist: tags?.artist ?? fallback.artist,
    album: tags?.album ?? null,
    year: tags?.year ?? null,
    tags: tags ? "id3" : "filename",
  };
}

/** The running scan, if any. Module state: one machine, one scan. */
let current = null;

export function status() {
  if (!current) return { running: false };
  return {
    running: !current.done,
    dir: current.dir,
    files: current.files,
    found: current.found,
    bytes: current.bytes,
    elapsedMs: Date.now() - current.at,
    roots: current.roots,
    line: progressLine(current),
  };
}

export function cancel() {
  if (current) current.controller.abort();
  return status();
}

/**
 * Walk the drives and rebuild the index. Returns when it is done; a second call
 * while one is running returns the running one instead of starting another.
 */
export async function scan({ roots = rootDrives(), incremental = true, mode = "index", onProgress = null } = {}) {
  if (current && !current.done) return status();

  roots = orderRoots(roots);
  const cache = incremental ? readCache() : {};
  const previous = readIndex();
  const controller = new AbortController();
  current = { at: Date.now(), controller, dir: "", files: 0, found: 0, bytes: 0, roots, done: false };

  const tracks = [];
  const byPath = new Map((previous.tracks ?? []).map((track) => [track.path, track]));
  let sinceFlush = 0;
  let lastFlushAt = Date.now();
  const moved = { count: 0, failed: 0, duplicates: 0 };
  let junk = 0;

  const result = await walk({
    roots,
    extensions: AUDIO_EXT,
    prefer: likelyMusic,
    cache,
    signal: controller.signal,
    onFile: (record) => {
      const known = byPath.get(record.path);
      // an unchanged file keeps its tags: re-reading 20,000 headers is the slow part
      let track = known && known.mtimeMs === record.mtimeMs && known.size === record.size
        ? known
        : trackFromFile(record);

      // opt-in: the file is copied into the vault, verified, and only then
      // removed from where it was. Indexing in place is the default.
      if (mode === "move" && !String(track.path).startsWith(musicVault + "/")) {
        const result = moveToVault(track);
        if (result.moved) { moved.count += 1; track = { ...track, origin: track.path, path: result.path }; }
        else if (result.duplicate) { moved.duplicates += 1; track = { ...track, origin: track.path, path: result.path }; }
        else { moved.failed += 1; }
        track = { ...track, id: fileId(track.path) };
      }
      if (isJunkTrack(track)) {
        junk += 1;
        return;
      }
      tracks.push(track);
      // flush as we go: a cancelled scan keeps what it had, and a slow drive
      // never costs the whole walk
      sinceFlush += 1;
      if (sinceFlush >= 50 || Date.now() - lastFlushAt > 5000) {
        sinceFlush = 0;
        lastFlushAt = Date.now();
        writeIndex({ at: Date.now(), roots: [], files: current.files, found: tracks.length, bytes: current.bytes, partial: true, mode, junk, tracks });
      }
    },
    onProgress: (state) => {
      Object.assign(current, { dir: state.dir, files: state.files, found: state.found, bytes: state.bytes });
      if (onProgress) onProgress(state);
    },
  });

  writeIndex({ at: Date.now(), roots: [], found: tracks.length, bytes: result.bytes, partial: true, mode, junk, tracks });
  writeCache(result.cache);
  const index = {
    at: Date.now(),
    roots: roots.map((root) => ({ path: root, files: tracks.filter((track) => String(track.path).startsWith(root + "/")).length })),
    files: result.files,
    found: tracks.length,
    bytes: result.bytes,
    cancelled: result.cancelled,
    mode,
    moved,
    junk,
    tracks,
  };
  writeIndex(index);
  Object.assign(current, { done: true, files: result.files, found: tracks.length, bytes: result.bytes });
  const finished = status();
  current = null;
  return { ...finished, index };
}

/** Pure: the id in a media URL, or null. */
export function trackId(raw) {
  const value = String(raw ?? "");
  return /^file:[0-9a-f]{8,}$/.test(value) ? value : null;
}

/** Find a track by id in the index. Missing index is an empty library. */
export function findTrack(id, file = indexFile()) {
  const wanted = trackId(id);
  if (!wanted) return null;
  const track = (cachedIndex(file).tracks ?? []).find((entry) => entry.id === wanted) ?? null;
  if (!track || !existsSync(track.path)) return null;
  return track;
}

export const musicVault = path.join(VAULT, "music");

/**
 * Pure: is this file a track, or an engine's leftover?
 *
 * A game audio folder is full of things that are not music: `_dl_silence` marks
 * a silent frame, `_comma` is punctuation for a soundtrack cue, `00_creak` is a
 * door. None of them belong in a library someone browses. The rules are
 * conservative: only names that cannot be music, and sizes that cannot be.
 */
export function isJunkTrack(track) {
  const base = path.basename(String(track?.path ?? ""));
  const name = base.replace(/\.[^.]+$/, "");
  if (!name) return true;
  if (name.startsWith("_") || name.startsWith(".")) return true;
  if (!/[a-z]/i.test(name)) return true;                   // 01, 02, 1337
  if (/^(silence|silent|empty|blank|nosound|none)$/i.test(name)) return true;
  if (Number(track?.size) > 0 && Number(track.size) < 4096) return true;  // under 4 KB is a stub
  return false;
}

export const SORTS = {
  title: (a, b) => String(a.title ?? "").localeCompare(String(b.title ?? "")),
  artist: (a, b) => String(a.artist ?? "").localeCompare(String(b.artist ?? "")) || String(a.title ?? "").localeCompare(String(b.title ?? "")),
  path: (a, b) => String(a.path ?? "").localeCompare(String(b.path ?? "")),
};

/** Pure: one page of the library, filtered by a query and sorted. */
export function libraryPage(tracks, { limit = 50, offset = 0, q = "", sort = "title", max = 200 } = {}) {
  const query = String(q ?? "").trim().toLowerCase();
  const list = (tracks ?? []).filter((track) => {
    if (!query) return true;
    return [track.title, track.artist, track.album, track.path]
      .some((field) => String(field ?? "").toLowerCase().includes(query));
  });
  const ordered = list.slice().sort(SORTS[sort] ?? SORTS.title);
  const result = page(ordered, { limit, offset, max });
  return { ...result, tracks: result.items, query, sort: SORTS[sort] ? sort : "title" };
}

/** Pure: a name a filesystem will accept, or a fallback. */
export function safeName(value, fallback) {
  const cleaned = String(value ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 80) || fallback;
}

/** Pure: where a track belongs if it moves into the vault. */
export function vaultTarget(track, vault = musicVault) {
  const artist = safeName(track.artist, "unsorted");
  const album = safeName(track.album, "");
  const file = safeName(path.basename(track.path), "track" + path.extname(track.path || ".mp3"));
  return path.join(vault, artist, album, file);
}

/**
 * Copy a track into the vault, verify the copy, and only then remove the
 * original. A failed verification leaves the source exactly where it was.
 * Returns { moved, path, reason }.
 */
export function moveToVault(track, { vault = musicVault, remove = true } = {}) {
  const target = vaultTarget(track, vault);
  try {
    if (existsSync(target) && statSync(target).size === track.size) {
      // already there, byte for byte by size: the original is a duplicate
      if (remove) unlinkSync(track.path);
      return { moved: false, duplicate: true, path: target };
    }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(track.path, target);
    if (statSync(target).size !== statSync(track.path).size) {
      return { moved: false, path: target, reason: "the copy is not the same size" };
    }
    if (remove) unlinkSync(track.path);
    return { moved: true, path: target };
  } catch (error) {
    return { moved: false, path: target, reason: error.message };
  }
}
