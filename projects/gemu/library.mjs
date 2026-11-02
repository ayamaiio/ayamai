// One list out of five sources, with a cache so the page is not a scan.
import { scan as scanEmulators, emulatorFor } from "./sources/emulators.mjs";
import { scan as scanEpic } from "./sources/epic.mjs";
import { scan as scanGog } from "./sources/gog.mjs";
import { scan as scanItch } from "./sources/itch.mjs";
import { rootsFrom, scan as scanSteam } from "./sources/steam.mjs";

const SECTIONS = ["steam", "epic", "gog", "itch", "emulators", "roms"];

const LABELS = {
  steam: "steam",
  epic: "epic",
  gog: "gog",
  itch: "itch",
  emulators: "emulators",
  roms: "roms",
};

/** Pure: case-insensitive match on the name and the source. */
export function search(games, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return games;
  return games.filter((game) => `${game.name} ${game.source} ${game.system ?? ""}`.toLowerCase().includes(needle));
}

/** Pure: the merged library, sections in a stable order with counts. */
export function buildLibrary({ steam = [], epic = [], gog = [], itch = [], emulators = [], systems = [] }) {
  const romRows = systems.map((system) => {
    const emulator = emulatorFor(emulators, system.system);
    return {
      id: `rom:${system.system}`,
      kind: "system",
      source: "roms",
      name: system.system,
      files: system.files,
      sizeBytes: system.bytes,
      emulator: emulator ? emulator.name : null,
      playable: Boolean(emulator),
    };
  });

  const emulatorRows = emulators.map((emulator) => ({
    id: emulator.key ?? emulator.name,
    kind: "emulator",
    source: "emulators",
    name: emulator.name,
    exe: emulator.exe,
    systems: emulator.systems ?? [],
  }));

  const sections = [
    { id: "emulators", label: LABELS.emulators, games: emulatorRows },
    { id: "roms", label: LABELS.roms, games: romRows },
    { id: "steam", label: LABELS.steam, games: steam },
    { id: "epic", label: LABELS.epic, games: epic },
    { id: "gog", label: LABELS.gog, games: gog },
    { id: "itch", label: LABELS.itch, games: itch },
  ].filter((section) => section.games.length);

  return {
    at: Date.now(),
    sections,
    counts: Object.fromEntries(sections.map((section) => [section.id, section.games.length])),
    total: sections.reduce((sum, section) => sum + section.games.length, 0),
  };
}

export function createLibrary({ paths, toUnix }) {
  let cache = null;
  let inflight = null;

  const scan = async () => {
    const steam = scanSteam({ roots: rootsFrom(paths.steamDefaults, toUnix), toUnix });
    const epic = scanEpic(paths.epicFile);
    const gog = scanGog(paths.gogDir);
    const itch = scanItch(paths.itchDir);
    const emulated = scanEmulators({ emulatorsFile: paths.emulatorsFile, indexFile: paths.indexFile });
    return buildLibrary({
      steam: steam.games ?? [],
      epic: epic.games ?? [],
      gog: gog.games ?? [],
      itch: itch.games ?? [],
      emulators: emulated.emulators,
      systems: emulated.systems,
    });
  };

  return {
    async get({ maxAge = 5 * 60_000, force = false } = {}) {
      if (!force && cache && Date.now() - cache.at < maxAge) return cache;
      if (inflight) return inflight;
      inflight = scan().then((library) => { cache = library; inflight = null; return library; }).catch((error) => {
        inflight = null;
        return { at: Date.now(), sections: [], counts: {}, total: 0, error: String(error?.message ?? error) };
      });
      return inflight;
    },
  };
}

export { SECTIONS };
