// Where the itch games on this machine are. Machine state, not repository state:
// a path that says what somebody keeps on their own disk does not belong in git.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SOURCES_FILE = (data) => path.join(data, "gemu", "itch-sources.json");

/** Defaults, before anything is configured. */
export function defaults({ itchApps, vault }) {
  return [
    itchApps,
    path.join(vault, "itch"),
    path.join(vault, "itch", "_incoming"),
  ].filter(Boolean);
}

export function readSources(file, fallback = []) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const roots = Array.isArray(parsed?.roots) ? parsed.roots.filter((root) => typeof root === "string" && root) : [];
    return roots.length ? roots : fallback;
  } catch {
    return fallback;
  }
}

export function writeSources(file, roots) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ roots }, null, 2) + "\n");
  return file;
}

/** Pure: split roots into game folders and the zip inbox. */
export function inboxOf(roots) {
  return roots.find((root) => root.endsWith("_incoming")) ?? null;
}
