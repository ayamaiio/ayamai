// itch: one directory per installed app under the itch client's apps folder.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Pure: a folder name becomes a readable title. */
export function titleFrom(folder) {
  return String(folder ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** The folder is the fact; the exe inside it is what we launch. */
export function scan(appsDir) {
  if (!appsDir || !existsSync(appsDir)) return { ok: true, games: [], absent: true };
  const games = [];
  let entries = [];
  try { entries = readdirSync(appsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()); } catch { return { ok: true, games: [] }; }
  for (const entry of entries) {
    const folder = path.join(appsDir, entry.name);
    let exe = null;
    try {
      const files = readdirSync(folder).filter((name) => name.toLowerCase().endsWith(".exe"));
      if (files.length) {
        exe = path.join(folder, files.sort((a, b) => statSync(path.join(folder, b)).size - statSync(path.join(folder, a)).size)[0]);
      }
    } catch { /* unreadable app folder */ }
    if (!exe) continue;
    games.push({ id: entry.name, source: "itch", kind: "itch", name: titleFrom(entry.name), exe, path: folder });
  }
  return { ok: true, games: games.sort((a, b) => a.name.localeCompare(b.name)) };
}
