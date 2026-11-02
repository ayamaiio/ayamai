import test from "node:test";
import { PAGE, SYSTEMS, systemCommand, systemIso } from "./server.mjs";
import assert from "node:assert/strict";

import { libraryRoots, pairs, parseAppManifest } from "./sources/steam.mjs";
import { parseInstalled } from "./sources/epic.mjs";
import { parseInfo } from "./sources/gog.mjs";
import { titleFrom } from "./sources/itch.mjs";
import { parseEmulators, parseIndex, emulatorFor, listRomDir } from "./sources/emulators.mjs";
import { launchCommand, toWindows } from "./launch.mjs";
import { buildLibrary, search } from "./library.mjs";

const toUnix = (value) => String(value).replace(/^([A-Za-z]):[\\/]?/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, "/").replace(/\/{2,}/g, "/");

test("steam: libraries and app manifests, with the escapes Valve writes", () => {
  const vdf = `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"Z:\\\\SteamLibrary"\n\t}\n}`;
  assert.deepEqual(libraryRoots(vdf, toUnix), ["/mnt/c/Program Files (x86)/Steam", "/mnt/z/SteamLibrary"]);
  assert.deepEqual(pairs('"a" "1"\n"b" "2"'), [["a", "1"], ["b", "2"]]);

  const acf = `"AppState"\n{\n\t"appid"\t\t"10"\n\t"name"\t\t"Counter-Strike"\n\t"installdir"\t\t"Half-Life"\n\t"SizeOnDisk"\t\t"318799907"\n}`;
  const game = parseAppManifest(acf, "10");
  assert.equal(game.id, "10");
  assert.equal(game.name, "Counter-Strike");
  assert.equal(game.sizeBytes, 318799907);
  assert.equal(parseAppManifest(`"AppState"\n{\n\t"appid"\t\t"1"\n}`, "1"), null, "no name, not a game");
});

test("epic: engine components are not games", () => {
  const dat = JSON.stringify({ InstallationList: [
    { AppName: "QuixelBridge_5.5", InstallLocation: "C:\\Program Files\\Epic Games\\UE_5.5" },
    { AppName: "Fortnite", InstallLocation: "C:\\Program Files\\Epic Games\\Fortnite" },
  ] });
  const result = parseInstalled(dat);
  assert.equal(result.games.length, 1);
  assert.equal(result.games[0].name, "Fortnite");
  assert.equal(parseInstalled("not json").ok, false);
});

test("gog and itch read what they are given", () => {
  assert.equal(parseInfo('{"gameId":"1","name":"Sang-Froid","exe":"game.exe"}').name, "Sang-Froid");
  assert.equal(parseInfo("{}"), null);
  assert.equal(titleFrom("my-cool_game"), "My Cool Game");
});

test("emulators and their systems", () => {
  const list = parseEmulators(`\uFEFF[{"key":"retroarch","name":"RetroArch","exe":"C:\\\\r.exe","systems":["NES","PS2"]}]`);
  assert.equal(list.length, 1);
  assert.equal(emulatorFor(list, "PS2").name, "RetroArch");
  assert.equal(emulatorFor(list, "Switch"), null);
  const index = parseIndex('{"PS2":{"files":10,"bytes":2048}}');
  assert.deepEqual(index, [{ system: "PS2", files: 10, bytes: 2048 }]);
});

test("the rom browser stays inside the library", () => {
  assert.equal(listRomDir("/mnt/z/Roms", "../etc").ok, false);
  assert.equal(listRomDir("/mnt/z/Roms", "/etc").ok, false);
});

test("launch commands are built, never shelled", () => {
  assert.deepEqual(launchCommand({ kind: "steam", id: "413150" }),
    { command: "cmd.exe", args: ["/c", "start", "", "steam://run/413150"] });
  assert.match(launchCommand({ kind: "epic", id: "Fortnite" }).args[3], /com\.epicgames\.launcher:\/\/apps\/Fortnite/);
  assert.equal(launchCommand({ kind: "steam", id: "abc" }).error, "steam id must be numeric");
  assert.equal(launchCommand({ kind: "rom", exe: "C:\\e.exe", rom: "../../etc/passwd" }, { romRoot: "/mnt/z/Roms" }).error, "outside the ROM library");
  assert.equal(launchCommand({ kind: "rom", rom: "PS2/x.iso" }, { romRoot: "/mnt/z/Roms" }).error, "no emulator covers this system");
  assert.equal(launchCommand({ kind: "nope" }).error, 'unknown kind "nope"');
  assert.deepEqual(launchCommand({ kind: "folder", folder: "3DS" }, { romRoot: "/mnt/z/Roms" }),
    { command: "explorer.exe", args: ["Z:\\Roms\\3DS"] });
  assert.equal(launchCommand({ kind: "folder", folder: "../../etc" }, { romRoot: "/mnt/z/Roms" }).error, "outside the ROM library");
  assert.equal(toWindows("/mnt/z/Roms/x.iso"), "Z:\\Roms\\x.iso");
});

test("the library merges sections in a stable order and counts them", () => {
  const lib = buildLibrary({
    steam: [{ id: "1", kind: "steam", name: "A" }],
    emulators: [{ key: "mgba", name: "mGBA", exe: "m.exe", systems: ["GBA"] }],
    systems: [{ system: "GBA", files: 3, bytes: 10 }, { system: "PS2", files: 1, bytes: 10 }],
  });
  assert.deepEqual(lib.sections.map((section) => section.id), ["emulators", "roms", "steam"]);
  assert.equal(lib.counts.roms, 2);
  assert.equal(lib.sections[1].games[0].playable, true);
  assert.equal(lib.sections[1].games[1].playable, false, "no emulator for PS2");
  assert.equal(lib.total, 4);
});

test("search is case-insensitive over name, source and system", () => {
  const games = [{ name: "Hades", source: "steam" }, { name: "Metal Gear", source: "gog" }];
  assert.equal(search(games, "had").length, 1);
  assert.equal(search(games, "GOG")[0].name, "Metal Gear");
  assert.equal(search(games, "").length, 2);
});

test("every system boots with an argv a test can read", () => {
  const temple = systemCommand(SYSTEMS.templeos, "Y:\\ayamai\\system\\TempleOS.ISO", null, "C:\\qemu\\qemu.exe");
  assert.deepEqual(temple.args.slice(0, 2), ["-cdrom", "Y:\\ayamai\\system\\TempleOS.ISO"]);
  assert.ok(temple.args.includes("512"), "it gets real memory");
  assert.equal(temple.args.includes("-drive"), false, "no disk for a live CD");

  const xp = systemCommand(SYSTEMS.windowsxp, "Y:\\images\\xp.iso", "Y:\\images\\xp.qcow2", "C:\\qemu\\qemu.exe");
  assert.ok(xp.args.includes("-drive"), "windows gets a disk to install onto");
  assert.ok(String(xp.args[xp.args.indexOf("-drive") + 1]).includes("format=qcow2"));
  assert.ok(xp.args.includes("d"), "and boots from the CD first");
});

test("an unknown system has no image path", () => {
  assert.ok(systemIso("templeos").endsWith("TempleOS.ISO"));
  assert.equal(systemIso("beos"), null);
});


test("gemu's page script compiles, and pages its library", () => {
  // the page is a template literal: one stray newline in a regex broke seiri once
  const scripts = [...PAGE.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 1, "there is an inline script");
  for (const source of scripts) assert.doesNotThrow(() => new Function(source), "the page script must compile");
  assert.ok(PAGE.includes("SECTION_PAGE"), "the library renders a section at a time");
});
