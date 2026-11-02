// itch: what is this folder, and how do we start it?
//
// An itch download is rarely tidy. A zip unpacks to a folder, the folder holds
// another folder, and only then does the game appear: Eternum-0.9.5-pc/Eternum-0.9.5-pc/Eternum.exe.
// So the question is not "what is in this folder" but "where, below this folder,
// does the game actually start".
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const WEB_FILES = ["index.html", "Index.html", "INDEX.HTML"];
export const FLASH_EXT = new Set([".swf"]);
export const NATIVE_EXT = new Set([".exe", ".sh"]);
/** Folders that are engine internals, not the game's own root. */
export const NOT_ROOT = new Set(["lib", "renpy", "game", "www", "node_modules", "__pycache__", "game_data"]);

/** Pure: a readable title from a folder name. */
export function titleFrom(folder) {
  return String(folder ?? "")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase()) || "untitled";
}

/** Pure: a stable URL segment. Changing it breaks bookmarks and playback state. */
export function slugFrom(folder) {
  return String(folder ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "game";
}

const read = (dir) => {
  try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; }
};
const sizeOf = (file) => {
  try { return statSync(file).size; } catch { return 0; }
};
const isFile = (file) => {
  try { return statSync(file).isFile(); } catch { return false; }
};

/**
 * Find where a game starts, looking depth-first but shallowest-first.
 * Returns { kind, root, entry, exe, swf, depth } or null.
 */
export function locate(dir, { maxDepth = 3 } = {}) {
  const queue = [{ dir, depth: 0 }];
  const found = { web: null, flash: null, native: null };

  while (queue.length) {
    const { dir: here, depth } = queue.shift();
    if (depth > maxDepth) continue;
    const entries = read(here);

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(here, entry.name);
      const lowered = entry.name.toLowerCase();
      const isHtml = lowered.endsWith(".html") || lowered.endsWith(".htm");
      if (isHtml && !found.web) {
        const size = sizeOf(full);
        // index.html is a build; a big single html is an export. A 5 KB README is neither.
        const named = WEB_FILES.includes(entry.name);
        if (named || size >= 64 * 1024) found.web = { root: here, entry: entry.name, depth, size };
      }
      else if (FLASH_EXT.has(path.extname(entry.name).toLowerCase()) && !found.flash) found.flash = { root: here, entry: entry.name, depth };
      else if (NATIVE_EXT.has(path.extname(entry.name).toLowerCase()) && entry.name.toLowerCase().endsWith(".exe")) {
        const size = sizeOf(full);
        if (!found.native || size > found.native.size) found.native = { root: here, entry: entry.name, size, depth };
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name.toLowerCase();
      if (NOT_ROOT.has(name) || name.startsWith(".")) continue;
      queue.push({ dir: path.join(here, entry.name), depth: depth + 1 });
    }
  }

  // a web build wins over an exe: a shared exe is often a launcher this platform
  // should not run, and a game that ships both is meant to play in a browser
  if (found.web) return { kind: "web", root: found.web.root, entry: found.web.entry, depth: found.web.depth };
  if (found.flash) return { kind: "flash", root: found.flash.root, swf: path.join(found.flash.root, found.flash.entry), depth: found.flash.depth };
  if (found.native) return { kind: "native", root: found.native.root, exe: path.join(found.native.root, found.native.entry), depth: found.native.depth };
  return null;
}

/** One folder becomes one catalog entry: the facts, and where it starts. */
export function inspectFolder(dir, name = path.basename(dir)) {
  const start = locate(dir);
  const id = slugFrom(name);
  if (!start) {
    return { id, name: titleFrom(name), folder: name, path: dir, kind: "unknown", root: dir, bytes: 0, entry: null, exe: null, swf: null };
  }
  // the entry's own size is the fact we have; walking a Ren'Py tree over 9p for
  // a total is minutes of blocking for a number that does not change a decision
  const target = start.entry ? path.join(start.root, start.entry) : (start.exe ?? start.swf ?? null);
  const bytes = target ? sizeOf(target) : 0;
  return {
    id,
    name: titleFrom(name),
    folder: name,
    path: dir,
    root: start.root,
    kind: start.kind,
    depth: start.depth,
    bytes,
    entry: start.entry ?? null,
    exe: start.exe ?? null,
    swf: start.swf ?? null,
    foundAt: Date.now(),
  };
}

/** Everything in a root, one entry per folder. Missing root is empty, not an error. */
export function scanRoot(root) {
  if (!root || !existsSync(root)) return { root, games: [], absent: true };
  const games = [];
  for (const entry of read(root)) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const game = inspectFolder(path.join(root, entry.name), entry.name);
    if (game.kind !== "unknown") games.push(game);
  }
  return { root, games: games.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Every root, in order, with the earlier root winning a slug collision. */
export function scanAll(roots) {
  const bySlug = new Map();
  const rootReports = [];
  let total = 0;
  for (const root of roots) {
    const report = scanRoot(root);
    rootReports.push({ root: report.root, absent: Boolean(report.absent), games: report.games.length });
    total += report.games.length;
    for (const game of report.games) if (!bySlug.has(game.id)) bySlug.set(game.id, game);
  }
  const games = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { games, roots: rootReports, duplicates: total - games.length };
}

/** Pure: is a request path inside the game, and is it a file we would serve? */
export function resolveInside(root, requestPath) {
  const decoded = decodeURIComponent(String(requestPath ?? "").split("?")[0]);
  if (decoded.includes("\u0000")) return null;
  const relative = decoded.replace(/^\/+/, "");
  if (!relative) return null;
  const absolute = path.resolve(root, relative);
  const inside = path.relative(root, absolute);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return isFile(absolute) ? absolute : null;
}
