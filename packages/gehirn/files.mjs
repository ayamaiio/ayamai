// Reading a project's tree without becoming an escape hatch.
//
// Every request is resolved against the entry's directory and rejected if it
// lands outside it — `..`, absolute paths and symlinks included.
import { closeSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export const MAX_FILE = 512 * 1024;
export const MAX_ENTRIES = 400;
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage"]);
const DOTFILES = new Set([".gitignore", ".npmrc", ".env.example"]);

/** Pure: may this relative path be read from `root`? Returns {ok, abs, error}. */
export function safeResolve(root, relative = "") {
  const base = realpathSync(path.resolve(root));
  const requested = String(relative ?? "").replace(/^\/+/, "");
  if (requested.split("/").some((part) => part === "..")) return { ok: false, error: "traversal" };
  const abs = path.resolve(base, requested);
  if (abs !== base && !abs.startsWith(`${base}${path.sep}`)) return { ok: false, error: "outside the project" };
  let real;
  try { real = realpathSync(abs); } catch { return { ok: false, error: "not found" }; }
  if (real !== base && !real.startsWith(`${base}${path.sep}`)) return { ok: false, error: "outside the project" };
  return { ok: true, abs: real, relative: path.relative(base, real) };
}

/** One directory, sorted, with sizes. Never walks recursively. */
export function listTree(root, relative = "") {
  const resolved = safeResolve(root, relative);
  if (!resolved.ok) return resolved;
  const dir = resolved.relative ? path.join(root, resolved.relative) : root;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return { ok: false, error: "unreadable" }; }

  const rows = entries
    .filter((entry) => !SKIP.has(entry.name) && (!entry.name.startsWith(".") || DOTFILES.has(entry.name)))
    .map((entry) => {
      const abs = path.join(dir, entry.name);
      let size = 0;
      try { size = entry.isDirectory() ? 0 : statSync(abs).size; } catch { /* vanished */ }
      return { name: entry.name, dir: entry.isDirectory(), size };
    })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    .slice(0, MAX_ENTRIES);
  return { ok: true, relative: resolved.relative, entries: rows };
}

/** A file, or the reason it will not be shown. */
export function readFileSafe(root, relative) {
  const resolved = safeResolve(root, relative);
  if (!resolved.ok) return resolved;
  let info;
  try { info = statSync(resolved.abs); } catch { return { ok: false, error: "not found" }; }
  if (info.isDirectory()) return { ok: false, error: "is a directory" };
  if (info.size > MAX_FILE) return { ok: false, error: `too large (${Math.round(info.size / 1024)} KB)`, size: info.size };
  const fd = openSync(resolved.abs, "r");
  try {
    const head = Buffer.alloc(Math.min(8192, info.size));
    readSync(fd, head, 0, head.length, 0);
    if (head.includes(0)) return { ok: false, error: "binary", size: info.size };
  } finally { closeSync(fd); }

  const text = readFileSync(resolved.abs, "utf8");
  return { ok: true, relative: resolved.relative, text, size: info.size, lines: text.split("\n").length };
}
