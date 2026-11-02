#!/usr/bin/env node
// Fetch Ruffle, the Flash player, so old .swf games still run.
//
//   node scripts/fetch-ruffle.mjs            download, verify, install
//   node scripts/fetch-ruffle.mjs --check    verify what is here
//
// @ruffle-rs/ruffle is MIT OR Apache-2.0. One pinned tarball, one checksum: the
// package ships hashed chunks, so pinning the tarball is simpler than pinning a
// list of names that change every release.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
export const DEST = path.join(REPO, "projects/gemu/public/ruffle");
export const VERSION = "0.7.1";
export const TARBALL = "https://registry.npmjs.org/@ruffle-rs/ruffle/-/ruffle-" + VERSION + ".tgz";
export const SHA256 = "dc9e7407549a91accc41a14932b0b9d9a9d51a3742ce6f020888c8a76682b157";
/** The files the player needs: the loader, its chunks, the wasm, the licences. */
export const KEEP = /\.(js|wasm|txt|md)$|^LICENSE/i;

export function digest(file) {
  try { return createHash("sha256").update(readFileSync(file)).digest("hex"); } catch { return null; }
}

/** Pure: is everything the player needs present? */
export function missing(dir = DEST) {
  if (!existsSync(dir)) return ["(nothing)"];
  const files = readdirSync(dir);
  const needed = ["ruffle.js", "LICENSE_MIT", "LICENSE_APACHE"];
  const gone = needed.filter((file) => !files.includes(file));
  if (!files.some((file) => file.endsWith(".wasm"))) gone.push("*.wasm");
  return gone;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const gone = missing();
  if (!gone.length) {
    console.log("ruffle " + VERSION + " is here.");
    return 0;
  }
  if (checkOnly) {
    console.error("missing: " + gone.join(", ") + " - run node scripts/fetch-ruffle.mjs");
    return 1;
  }

  const temp = path.join(REPO, ".ruffle-" + process.pid);
  mkdirSync(temp, { recursive: true });
  const tarball = path.join(temp, "ruffle.tgz");
  console.log("  fetching ruffle " + VERSION + "...");
  const response = await fetch(TARBALL, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) { console.error("HTTP " + response.status); return 1; }
  writeFileSync(tarball, Buffer.from(await response.arrayBuffer()));

  const actual = digest(tarball);
  if (actual !== SHA256) {
    rmSync(temp, { recursive: true, force: true });
    console.error("checksum mismatch: " + actual + " - refusing to install");
    return 1;
  }

  execFileSync("tar", ["-xzf", tarball, "-C", temp], { stdio: "ignore" });
  mkdirSync(DEST, { recursive: true });
  let copied = 0;
  for (const file of readdirSync(path.join(temp, "package"))) {
    if (!KEEP.test(file) || file.endsWith(".map")) continue;
    copyFileSync(path.join(temp, "package", file), path.join(DEST, file));
    copied += 1;
  }
  rmSync(temp, { recursive: true, force: true });
  writeFileSync(path.join(DEST, "VERSION"), VERSION + "\n" + SHA256 + "\n");

  const after = missing();
  if (after.length) {
    console.error("still missing after install: " + after.join(", "));
    return 1;
  }
  console.log("  installed " + copied + " files into projects/gemu/public/ruffle");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) process.exit(await main());
