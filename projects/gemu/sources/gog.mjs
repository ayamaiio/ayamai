// GOG: each installed game leaves a goggame-<id>.info JSON beside its exe.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Pure: one .info file becomes a game, or null. */
export function parseInfo(text) {
  let info;
  try { info = JSON.parse(String(text ?? "")); } catch { return null; }
  const id = String(info?.gameId ?? "").trim();
  const name = String(info?.name ?? "").trim();
  const exe = String(info?.exe ?? "").trim();
  if (!id || !name) return null;
  return { id, source: "gog", kind: "gog", name, exe };
}

export function scan(gamesDir) {
  if (!gamesDir || !existsSync(gamesDir)) return { ok: true, games: [], absent: true };
  const games = [];
  const seen = new Set();
  let dirs = [];
  try { dirs = readdirSync(gamesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()); } catch { return { ok: true, games: [] }; }
  for (const dir of dirs) {
    const folder = path.join(gamesDir, dir.name);
    let files = [];
    try { files = readdirSync(folder).filter((name) => /^goggame-.*\.info$/i.test(name)); } catch { continue; }
    for (const file of files) {
      let game = null;
      try { game = parseInfo(readFileSync(path.join(folder, file), "utf8")); } catch { game = null; }
      if (!game || seen.has(game.id)) continue;
      seen.add(game.id);
      if (game.exe && !path.isAbsolute(game.exe)) game.exe = path.join(folder, game.exe);
      games.push(game);
    }
  }
  return { ok: true, games: games.sort((a, b) => a.name.localeCompare(b.name)) };
}
