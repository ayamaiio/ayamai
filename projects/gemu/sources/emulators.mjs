// Emulators and ROMs, read from the inventory the scanner already wrote.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const BOM = /^\uFEFF/;

/** Pure: emulators.json as a list, tolerant of a BOM. */
export function parseEmulators(text) {
  try {
    const list = JSON.parse(String(text ?? "").replace(BOM, ""));
    return Array.isArray(list) ? list.filter((entry) => entry?.exe) : [];
  } catch { return []; }
}

/** Pure: the per-system counts the index holds. */
export function parseIndex(text) {
  try {
    const parsed = JSON.parse(String(text ?? "").replace(BOM, ""));
    return Object.entries(parsed ?? {}).map(([system, stats]) => ({ system, files: Number(stats.files ?? 0), bytes: Number(stats.bytes ?? 0) }));
  } catch { return []; }
}

export function scan({ emulatorsFile, indexFile }) {
  const emulators = emulatorsFile && existsSync(emulatorsFile)
    ? parseEmulators(readFileSync(emulatorsFile, "utf8"))
    : [];
  const systems = indexFile && existsSync(indexFile)
    ? parseIndex(readFileSync(indexFile, "utf8"))
    : [];
  return { ok: true, emulators, systems };
}

/** Which emulator covers a system, best match first. */
export function emulatorFor(emulators, system) {
  return (emulators ?? []).find((emulator) => (emulator.systems ?? []).includes(system)) ?? null;
}

/** One directory of the ROM tree — never the whole thing. */
export function listRomDir(root, relative, limit = 300) {
  const base = path.resolve(root);
  const target = path.resolve(base, String(relative ?? "").replace(/^\/+/, ""));
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return { ok: false, error: "outside the ROM library" };
  let entries = [];
  try { entries = readdirSync(target, { withFileTypes: true }); } catch { return { ok: false, error: "unreadable" }; }
  const rows = entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => {
      let size = 0;
      try { size = entry.isDirectory() ? 0 : statSync(path.join(target, entry.name)).size; } catch { /* gone */ }
      return { name: entry.name, dir: entry.isDirectory(), size, path: path.relative(base, path.join(target, entry.name)).split(path.sep).join("/") };
    })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    .slice(0, limit);
  return { ok: true, relative: path.relative(base, target).split(path.sep).join("/"), entries: rows };
}
