// Steam: where its libraries are, and what is installed in them.
//
// Two formats, both Valve's: libraryfolders.vdf (where) and appmanifest_<id>.acf
// (what). Parsed with a tiny quote-pair reader rather than a dependency, and
// tolerant of a file caught mid-write.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Pure: "key" "value" pairs out of a VDF/ACF body, with nesting ignored. */
export function pairs(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const match = /^\s*"([^"]+)"\s+"([^"]*)"/.exec(line);
    if (match) out.push([match[1], match[2]]);
  }
  return out;
}

/** Pure: the library roots named in libraryfolders.vdf, as WSL paths. */
export function libraryRoots(vdf, toUnix) {
  return pairs(vdf)
    .filter(([key]) => key === "path")
    .map(([, value]) => toUnix(value))
    .filter(Boolean);
}

/** Pure: an appmanifest becomes a game, or null when it is not one. */
export function parseAppManifest(text, appidFromFile) {
  const fields = Object.fromEntries(pairs(text));
  const appid = String(fields.appid ?? appidFromFile ?? "");
  const name = String(fields.name ?? "").trim();
  if (!appid || !name) return null;
  return {
    id: appid,
    source: "steam",
    kind: "steam",
    name,
    installdir: fields.installdir ?? "",
    sizeBytes: Number(fields.SizeOnDisk ?? 0) || 0,
    lastPlayed: Number(fields.LastPlayed ?? 0) || 0,
  };
}

export function scan({ roots, toUnix }) {
  const games = [];
  const seen = new Set();
  for (const root of roots) {
    const steamapps = path.join(root, "steamapps");
    if (!existsSync(steamapps)) continue;
    for (const file of readdirSync(steamapps)) {
      if (!file.startsWith("appmanifest_") || !file.endsWith(".acf")) continue;
      const appid = file.replace("appmanifest_", "").replace(".acf", "");
      let game = null;
      try { game = parseAppManifest(readFileSync(path.join(steamapps, file), "utf8"), appid); } catch { game = null; }
      if (!game || seen.has(game.id)) continue;
      seen.add(game.id);
      games.push(game);
    }
  }
  return { ok: true, games: games.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** The libraries the platform can see, defaulted to the usual Steam homes. */
export function rootsFrom(defaultRoots, toUnix) {
  for (const candidate of defaultRoots) {
    const vdf = path.join(candidate, "steamapps", "libraryfolders.vdf");
    if (!existsSync(vdf)) continue;
    try { return libraryRoots(readFileSync(vdf, "utf8"), toUnix); } catch { /* try the next */ }
  }
  return [];
}
