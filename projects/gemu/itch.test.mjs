import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { locate, resolveInside, scanAll, scanRoot, slugFrom, titleFrom } from "./itch/catalog.mjs";
import { commonPrefix, safeEntry } from "./itch/install.mjs";
import { gameHeaders } from "./itch/serve.mjs";
import { defaults } from "./itch/sources.mjs";

const scratch = () => mkdtempSync(path.join(tmpdir(), "itch-"));

function plant() {
  const root = scratch();
  // a build at the top of the folder
  mkdirSync(path.join(root, "WebGame"), { recursive: true });
  writeFileSync(path.join(root, "WebGame", "index.html"), "<html>game</html>");
  // a build inside one wrapper folder, the way itch unpacks
  mkdirSync(path.join(root, "Nested-1.0-pc", "Nested-1.0-pc"), { recursive: true });
  writeFileSync(path.join(root, "Nested-1.0-pc", "Nested-1.0-pc", "Nested.exe"), "MZ");
  // a single-file html export
  mkdirSync(path.join(root, "Export"), { recursive: true });
  writeFileSync(path.join(root, "Export", "Game 1.0.html"), "x".repeat(70 * 1024));
  // a flash game
  mkdirSync(path.join(root, "Flashy"), { recursive: true });
  writeFileSync(path.join(root, "Flashy", "flashy.swf"), "FWS");
  // a folder with nothing runnable
  mkdirSync(path.join(root, "Docs"), { recursive: true });
  writeFileSync(path.join(root, "Docs", "readme.txt"), "hi");
  return root;
}

test("slugs and titles are stable and readable", () => {
  assert.equal(slugFrom("Eternum-0.9.5-pc"), "eternum-0-9-5-pc");
  assert.equal(slugFrom("!!!"), "game");
  assert.equal(titleFrom("companion-of-darkness-win"), "Companion Of Darkness Win");
});

test("a build is found at the top, one level down, or as a single html export", () => {
  const root = plant();
  assert.equal(locate(path.join(root, "WebGame")).kind, "web");
  const nested = locate(path.join(root, "Nested-1.0-pc"));
  assert.equal(nested.kind, "native");
  assert.ok(nested.exe.endsWith("Nested.exe"));
  assert.equal(nested.depth, 1, "found below the wrapper");
  const exported = locate(path.join(root, "Export"));
  assert.equal(exported.kind, "web", "a 70 KB html is a game, a 5 KB one is a readme");
  assert.equal(locate(path.join(root, "Flashy")).kind, "flash");
  assert.equal(locate(path.join(root, "Docs")), null);
});

test("a folder with nothing runnable is not in the catalog", () => {
  const root = plant();
  const report = scanRoot(root);
  assert.deepEqual(report.games.map((game) => game.folder).sort(), ["Export", "Flashy", "Nested-1.0-pc", "WebGame"]);
  assert.ok(report.games.every((game) => game.kind !== "unknown"));
});

test("the earlier root wins a slug, and that is reported", () => {
  const first = plant();
  const second = plant();
  const both = scanAll([first, second]);
  assert.equal(both.games.length, 4);
  assert.equal(both.duplicates, 4, "every game exists twice");
  assert.equal(both.games[0].path.startsWith(first), true, "the first root wins");
});

test("the server never leaves the game folder", () => {
  const root = plant();
  const web = path.join(root, "WebGame");
  assert.equal(resolveInside(web, "index.html"), path.join(web, "index.html"));
  assert.equal(resolveInside(web, "../Docs/readme.txt"), null);
  assert.equal(resolveInside(web, "/etc/passwd"), null);
  assert.equal(resolveInside(web, "..%2f..%2fetc%2fpasswd"), null);
  assert.equal(resolveInside(web, ""), null);
});

test("zip entries are judged before they are written", () => {
  assert.equal(safeEntry("Game/index.html"), "Game/index.html");
  assert.equal(safeEntry("../../evil"), null);
  assert.equal(safeEntry("/absolute"), null);
  assert.equal(safeEntry("C:/windows/system32"), null);
  assert.equal(commonPrefix(["Game/a", "Game/b"]), "Game/");
  assert.equal(commonPrefix(["a", "b"]), "");
});

test("every game response is isolated and knows its type", () => {
  const headers = gameHeaders("/x/game.wasm", 1234);
  assert.equal(headers["content-type"], "application/wasm");
  assert.equal(headers["cross-origin-embedder-policy"], "require-corp");
  assert.equal(headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(gameHeaders("/x/thing.data", 1)["content-type"], "application/octet-stream");
});

test("the default roots are the client, the vault and the inbox", () => {
  const roots = defaults({ itchApps: "/mnt/c/itch/apps", vault: "/mnt/y/ayamai" });
  assert.deepEqual(roots, ["/mnt/c/itch/apps", "/mnt/y/ayamai/itch", "/mnt/y/ayamai/itch/_incoming"]);
});
