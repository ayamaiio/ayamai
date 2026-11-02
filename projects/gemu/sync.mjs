#!/usr/bin/env node
// Turn the emulators the scanner found into child projects of gemu.
//
//   node projects/gemu/sync.mjs            # create what is missing
//   node projects/gemu/sync.mjs --check    # say what it would do
//
// Never overwrites: once we have taken an emulator over, the manifest is ours.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "../..");
const INVENTORY = "/mnt/y/ayamai/state/emulators.json";
const ROOT = path.join(REPO, "projects/gemu/emulators");

/** What we know before anyone has forked anything. */
export const UPSTREAM = {
  azahar: { repo: "https://github.com/azahar-emu/azahar", license: "GPL-3.0" },
  retroarch: { repo: "https://github.com/libretro/RetroArch", license: "GPL-3.0" },
  pcsx2: { repo: "https://github.com/PCSX2/pcsx2", license: "LGPL-3.0" },
  ppsspp: { repo: "https://github.com/hrydgard/ppsspp", license: "GPL-2.0" },
  mgba: { repo: "https://github.com/mgba-emu/mgba", license: "MPL-2.0" },
  project64: { repo: "https://github.com/project64/project64", license: "GPL-2.0" },
  eden: { repo: "https://git.eden-emu.dev/eden-emu/eden", license: "GPL-3.0" },
  shadps4: { repo: "https://github.com/shadps4-emu/shadPS4", license: "GPL-2.0" },
};

/** Pure: the folder-safe id an emulator key becomes. */
export function slug(key) {
  return String(key ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Pure: emulators.json → the child manifests that should exist. */
export function plan(emulators, known = UPSTREAM) {
  return (emulators ?? [])
    .filter((emulator) => emulator?.key && emulator?.exe)
    .map((emulator) => {
      const id = slug(emulator.key);
      const upstream = known[id] ?? { repo: "", license: "" };
      return {
        id,
        project: {
          $schema: "ayamai/project@1",
          id,
          parent: "gemu",
          name: String(emulator.name ?? id).toLowerCase(),
          kind: "source",
          version: "0.1.0",
          description: `${(emulator.systems ?? []).join(", ") || "emulator"} — forked from ${emulator.name ?? id}`,
          upstream: { repo: upstream.repo, license: upstream.license, tag: "" },
          fork: { repo: "", branch: "main" },
          emulator: { key: emulator.key, exe: String(emulator.exe), systems: emulator.systems ?? [] },
        },
      };
    });
}

function readme(project) {
  const name = project.name;
  return `# ${name}

A child project of **gemu**: our fork of ${name}, or the place where that fork will live.

| | |
|---|---|
| upstream | ${project.upstream.repo || "unknown — fill this in"} |
| license | ${project.upstream.license || "unknown"} |
| pinned tag | ${project.upstream.tag || "—"} |
| fork | ${project.fork.repo || "not forked yet"} |
| systems | ${project.emulator.systems.join(", ") || "—"} |
| installed | \`${project.emulator.exe}\` |

## Patches

Diffs we carry live in \`patches/\`, named \`<issue>.<what>.patch\`, applied in order.
${project.upstream.license ? `\n**${project.upstream.license}**: a fork that is distributed must keep its source available — the fork link above is that obligation, not paperwork.` : ""}
`;
}

function main() {
  const check = process.argv.includes("--check");
  if (!existsSync(INVENTORY)) { console.log(`no inventory at ${INVENTORY} — run scripts/scan-emulators.ps1`); return; }
  let emulators = [];
  try { emulators = JSON.parse(readFileSync(INVENTORY, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { console.log(`could not read the inventory: ${String(error.message).split("\n")[0]}`); return; }

  const rows = plan(emulators);
  let created = 0;
  for (const { id, project } of rows) {
    const dir = path.join(ROOT, id);
    const manifest = path.join(dir, "project.json");
    if (existsSync(manifest)) { console.log(`exists   ${id}`); continue; }
    if (check) { console.log(`would    ${id}  upstream ${project.upstream.repo || "(unknown)"}`); continue; }
    mkdirSync(path.join(dir, "patches"), { recursive: true });
    writeFileSync(manifest, JSON.stringify(project, null, 2) + "\n");
    writeFileSync(path.join(dir, "README.md"), readme(project));
    writeFileSync(path.join(dir, "patches", ".gitkeep"), "");
    created += 1;
    console.log(`created  ${id}  upstream ${project.upstream.repo || "(unknown)"}`);
  }
  console.log(`\n${created} created, ${rows.length - created} already there`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
