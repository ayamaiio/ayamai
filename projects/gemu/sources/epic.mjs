// Epic: one JSON file, written by the launcher itself.
//
// LauncherInstalled.dat holds every install, including Unreal Engine components,
// which are not games and would drown the list.
import { existsSync, readFileSync } from "node:fs";

/** Pure: the installation list becomes games, engine components dropped. */
export function parseInstalled(text) {
  let parsed;
  try { parsed = JSON.parse(String(text ?? "")); } catch { return { ok: false, games: [], error: "not JSON" }; }
  const list = parsed?.InstallationList;
  if (!Array.isArray(list)) return { ok: false, games: [], error: "no InstallationList" };

  const games = [];
  for (const entry of list) {
    const appName = String(entry?.AppName ?? "").trim();
    const location = String(entry?.InstallLocation ?? "").trim();
    if (!appName || !location) continue;
    // Unreal Engine and its marketplace packs live under Epic Games\UE_*.
    if (/Epic Games[\\/]+UE_/i.test(location) || /^UE_/i.test(appName)) continue;
    games.push({
      id: appName,
      source: "epic",
      kind: "epic",
      name: appName.replace(/_/g, " ").trim(),
      path: location,
    });
  }
  return { ok: true, games: games.sort((a, b) => a.name.localeCompare(b.name)) };
}

export function scan(defaultFile) {
  if (!defaultFile || !existsSync(defaultFile)) return { ok: true, games: [], absent: true };
  try { return parseInstalled(readFileSync(defaultFile, "utf8")); }
  catch { return { ok: true, games: [], absent: true }; }
}
