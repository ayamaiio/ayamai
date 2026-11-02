// Which face the platform is wearing: play, or dev.
//
// One value for the machine, not for a browser: this is a personal platform on
// one box, and a mode that forgets itself when a different browser opens is not
// a mode. Default is dev - a machine with no mode file behaves as before.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MODES = ["play", "dev"];
export const DEFAULT_MODE = "dev";

/** Pure: does this product declare a play face? That is what puts it on the shelf. */
export function hasPlayFace(project) {
  return Boolean(project?.faces?.play);
}

/** Pure: the path a product owns, with its route prefix in front. */
function prefixOf(project) {
  const prefix = String(project?.routes?.[0]?.prefix ?? "");
  return prefix.startsWith("/") ? prefix.replace(/\/$/, "") : "";
}

/**
 * Pure: where this product opens in this mode.
 * Declared face wins; otherwise the product's own root.
 */
export function faceFor(project, mode) {
  const key = normalizeMode(mode);
  const face = String(project?.faces?.[key] ?? "/");
  return prefixOf(project) + (face.startsWith("/") ? face : "/" + face);
}

export const modeFile = (data) => path.join(data, "state", "mode.json");

/** Pure: anything that is not play is dev. */
export function normalizeMode(value) {
  return String(value ?? "").toLowerCase() === "play" ? "play" : DEFAULT_MODE;
}

/** Pure: where the door leads. */
export function targetFor(mode) {
  return normalizeMode(mode) === "play" ? "/play/" : "/gehirn/";
}

/**
 * Pure: the same projects, ordered by the face. Play first in play mode, the
 * work first in dev. Stable, and nothing is removed: this is a sort, not a filter.
 */
export function rankProjects(projects, mode) {
  const play = normalizeMode(mode) === "play";
  const weight = (project) => {
    const isPlay = hasPlayFace(project);
    return play ? (isPlay ? 0 : 1) : (isPlay ? 1 : 0);
  };
  return (Array.isArray(projects) ? projects : [])
    .map((project, index) => ({ project, index }))
    .sort((a, b) => weight(a.project) - weight(b.project) || a.index - b.index)
    .map((entry) => entry.project);
}

export function readMode(data) {
  try {
    const parsed = JSON.parse(readFileSync(modeFile(data), "utf8"));
    return { mode: normalizeMode(parsed?.mode), at: parsed?.at ?? null };
  } catch {
    return { mode: DEFAULT_MODE, at: null };
  }
}

export function writeMode(data, mode) {
  const value = { mode: normalizeMode(mode), at: new Date().toISOString() };
  mkdirSync(path.dirname(modeFile(data)), { recursive: true });
  const temp = modeFile(data) + "." + process.pid + ".tmp";
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  renameSync(temp, modeFile(data));
  return value;
}
