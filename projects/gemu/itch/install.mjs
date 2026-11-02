// A zip has no "where it came from", so it is the one thing that lands somewhere.
//
//   installZip(zip, { vault })  ->  { ok, slug, path, entries }
//
// Extraction goes to a temporary folder beside the destination and is renamed
// into place, so a failed or cancelled run never leaves half a game behind.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { slugFrom, WEB_FILES } from "./catalog.mjs";

/** Pure: is this archive entry safe to write? */
export function safeEntry(name) {
  const entry = String(name ?? "").replace(/\\/g, "/");
  if (!entry || entry.startsWith("/") || entry.includes("\u0000")) return null;
  if (/^[a-zA-Z]:/.test(entry)) return null;
  const parts = entry.split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) return null;
  return parts.join("/") || null;
}

/** Pure: the common top-level folder, when every entry shares one. */
export function commonPrefix(entries) {
  const clean = entries.map(safeEntry).filter(Boolean);
  if (!clean.length) return "";
  const [first] = clean;
  const top = first.split("/")[0];
  if (!top || !clean.every((entry) => entry === top || entry.startsWith(top + "/"))) return "";
  return top + "/";
}

/** Pure: does this archive look like a web build? */
export function isWebArchive(entries) {
  const prefix = commonPrefix(entries);
  return entries.some((entry) => {
    const clean = safeEntry(entry);
    if (!clean) return false;
    const relative = prefix && clean.startsWith(prefix) ? clean.slice(prefix.length) : clean;
    const depth = relative.split("/").length;
    return depth <= 2 && WEB_FILES.includes(path.basename(relative));
  });
}

const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", maxBuffer: 8 << 20, ...options });

export function listZip(zip) {
  try { return run("unzip", ["-Z1", zip]).split("\n").filter(Boolean); } catch { return []; }
}

/** Extract a zip into a folder of its own. Re-installing replaces only on success. */
export function installZip(zip, { vault }) {
  const base = path.basename(zip).replace(/\.zip$/i, "");
  const slug = slugFrom(base);
  const entries = listZip(zip);
  if (!entries.length) return { ok: false, error: "not a readable zip" };
  if (entries.length > 200_000) return { ok: false, error: "too many entries" };
  if (entries.some((entry) => !safeEntry(entry))) return { ok: false, error: "the archive contains unsafe paths" };

  const target = path.join(vault, slug);
  const staging = path.join(vault, "." + slug + ".incoming");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  try {
    run("unzip", ["-q", "-o", zip, "-d", staging]);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, error: "unzip failed: " + (error.message ?? "") };
  }

  // strip the single top-level folder itch always ships
  const children = listDir(staging);
  let source = staging;
  if (children.length === 1 && isDirectory(path.join(staging, children[0]))) source = path.join(staging, children[0]);

  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  renameSync(source, target);
  rmSync(staging, { recursive: true, force: true });
  return { ok: true, slug, path: target, entries: entries.length };
}

function listDir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

function isDirectory(target) {
  try { return statSync(target).isDirectory(); } catch { return false; }
}

export const exists = existsSync;
