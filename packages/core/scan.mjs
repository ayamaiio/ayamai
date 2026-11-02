// The walk: every mounted drive, minus the places nobody wants.
//
// Three products need to know what media exists on this machine. This is the one
// walker: it is bounded, cancellable, incremental (a per-directory mtime cache
// means a rescan only revisits what changed) and it never follows a symlink.
//
// Pure helpers first, so the decisions are testable without a filesystem.
import { readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Folders that are never media: OS internals, build output, the recycle bin. */
export const SKIP = new Set([
  "$recycle.bin", "system volume information", "recycler", "windows", "winsxs",
  "appdata", "program files", "program files (x86)", "programdata",
  "node_modules", ".git", ".nvm", ".cache", "proc", "sys", "dev", "run",
  "snap", "lost+found", "boot", "etc", "var", "usr", "bin", "lib", "lib64", "opt", "tmp",
]);

/** Pure: is this directory name one we refuse to enter? */
export function shouldSkip(name) {
  const lowered = String(name ?? "").toLowerCase();
  if (!lowered || lowered === "." || lowered === "..") return true;
  if (lowered.startsWith("$")) return true;
  return SKIP.has(lowered);
}

/** Pure: does this file name carry an extension we want? */
export function matches(name, extensions) {
  const extension = path.extname(String(name ?? "")).toLowerCase();
  return extension.length > 1 && extensions.has(extension);
}

/**
 * Pure: drives to walk. Under WSL every Windows drive appears as /mnt/<letter>,
 * and the vault sits on /mnt/y, so the answer is "all of them" - sorted, because
 * an unsorted scan order makes progress look random.
 */
export function rootDrives(mounts = "/proc/mounts") {
  const drive = /^\/mnt\/([a-z])\b/;
  const found = new Set();
  if (existsSync(mounts)) {
    for (const line of readFileSync(mounts, "utf8").split("\n")) {
      const match = drive.exec(line.trim().split(/\s+/)[1] ?? "");
      if (match) found.add("/mnt/" + match[1]);
    }
  }
  // a machine without /proc still deserves to scan: the two the platform knows
  if (!found.size) {
    for (const fallback of ["/mnt/y", "/mnt/z"]) if (existsSync(fallback)) found.add(fallback);
  }
  return [...found].sort();
}

/**
 * Pure: may this directory be taken from the cache? Only when it was walked to
 * the end: a cancelled or capped run knows a directory's mtime but not its
 * contents, and trusting it would silently hide every file below it.
 */
export function unchanged(cache, dir, mtimeMs) {
  const known = cache?.[dir];
  return Boolean(known) && known.complete === true && Number(known.mtimeMs) === Number(mtimeMs);
}

const now = () => Date.now();

/**
 * Walk the roots and call onFile for every match.
 *
 * Returns { files, found, bytes, dirs, skipped, cache, cancelled }. files is
 * everything the roots contained, found is what matched an extension, and cache
 * is the next cache to write. Cancelling (signal.aborted) returns what it got.
 */
export async function walk({
  roots = [],
  extensions = new Set(),
  onFile = null,
  onProgress = null,
  signal = null,
  cache = {},
  maxFiles = 2_000_000,
  progressEveryMs = 400,
  prefer = null,
} = {}) {
  const nextCache = {};
  const skipped = [];
  let files = 0;
  let found = 0;
  let bytes = 0;
  let dirs = 0;
  let current = "";
  let lastProgress = 0;

  const report = (force = false) => {
    if (!onProgress) return;
    const at = now();
    if (!force && at - lastProgress < progressEveryMs) return;
    lastProgress = at;
    onProgress({ dir: current, files, found, bytes, dirs, skipped: skipped.length });
  };

  const queue = roots.map((root) => ({ dir: root, root }));
  while (queue.length) {
    if (signal?.aborted) break;
    if (files >= maxFiles) break;
    const { dir, root } = queue.shift();
    if (dir !== root && shouldSkip(path.basename(dir))) continue;

    let entries;
    let mtimeMs = 0;
    try {
      entries = await readdir(dir, { withFileTypes: true });
      mtimeMs = (await stat(dir)).mtimeMs;
    } catch {
      skipped.push({ dir, reason: "unreadable" });
      continue;
    }
    dirs += 1;
    current = dir;

    // an unchanged directory is not descended into again: its files come from
    // the cache, so a rescan costs the mount times of the directories only
    if (cache[dir] && unchanged(cache, dir, mtimeMs) && onFile) {
      for (const track of cache[dir].files ?? []) {
        files += 1;
        found += 1;
        bytes += Number(track.size) || 0;
        await onFile(track);
      }
      nextCache[dir] = cache[dir];
      report();
      continue;
    }

    const here = [];
    for (const entry of entries) {
      if (signal?.aborted) break;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkip(entry.name)) continue;
        // a directory whose name promises media is walked next, not last: the
        // point of the first scan is to find something, not to be thorough
        if (prefer && prefer(entry.name)) queue.unshift({ dir: full, root });
        else queue.push({ dir: full, root });
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      if (!matches(entry.name, extensions)) continue;
      let info;
      try {
        info = await stat(full);
      } catch {
        skipped.push({ dir: full, reason: "unreadable" });
        continue;
      }
      found += 1;
      bytes += info.size;
      const record = { path: full, size: info.size, mtimeMs: info.mtimeMs, root };
      here.push(record);
      if (onFile) await onFile(record);
      if (files >= maxFiles) break;
      report();
    }

    nextCache[dir] = { mtimeMs, files: here, complete: !signal?.aborted && files < maxFiles };
    report();
  }

  report(true);
  return { files, found, bytes, dirs, skipped, cache: nextCache, cancelled: Boolean(signal?.aborted) };
}

/** Pure: the human line for a running scan. */
export function progressLine(state = {}) {
  const files = Number(state.files) || 0;
  const found = Number(state.found) || 0;
  const mb = Math.round((Number(state.bytes) || 0) / 1048576);
  const where = state.dir ? state.dir.replace(/^\/mnt\/([a-z])/, (_, drive) => drive.toUpperCase() + ":") : "starting";
  return where + " - " + files.toLocaleString() + " files seen - " + found.toLocaleString() + " found - " + mb + " MB";
}
