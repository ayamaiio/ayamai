// The catalog and the path guards, tested without a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as fs from "node:fs";
const require_fs = () => fs;

import { validateEntry, loadCatalog, shortPath, wslWindowsPath, editorUri, revealUri, resolveEntry, SCHEMA, LEGACY_SCHEMA } from "./catalog.mjs";
import { renderMarkdown, escapeHtml } from "../../packages/gehirn/markdown.mjs";
import { safeResolve, listTree, readFileSafe, MAX_FILE } from "../../packages/gehirn/files.mjs";

const root = mkdtempSync(path.join(tmpdir(), "ayamai-catalog-"));
mkdirSync(path.join(root, "projects", "yoru"), { recursive: true });
mkdirSync(path.join(root, "packages", "gehirn"), { recursive: true });
writeFileSync(path.join(root, "projects", "yoru", "README.md"), "# yoru\n");
writeFileSync(path.join(root, "projects", "yoru", "code.js"), "console.log(1)\n");
writeFileSync(path.join(root, "packages", "gehirn", "page.mjs"), "export const x = 1;\n");

const entry = () => ({ id: "yoru", name: "yoru", jp: "夜", kind: "project", path: "projects/yoru", docs: ["README.md"] });

test("a well-formed entry validates against the tree", () => {
  assert.deepEqual(validateEntry(entry(), root), []);
});

test("bad kinds, missing paths and missing docs are named", () => {
  assert.ok(validateEntry({ ...entry(), kind: "toy" }, root)[0].includes("kind"));
  assert.ok(validateEntry({ ...entry(), path: "nope" }, root).some((e) => e.includes("does not exist")));
  assert.ok(validateEntry({ ...entry(), docs: ["MISSING.md"] }, root).some((e) => e.includes("doc missing")));
  assert.ok(validateEntry({ ...entry(), path: "../outside" }, root).some((e) => e.includes("escapes")));
});

test("a doc may live at the repository's docs/ instead of beside the project", () => {
  const { mkdirSync, writeFileSync } = require_fs();
  mkdirSync(path.join(root, "docs", "projects"), { recursive: true });
  writeFileSync(path.join(root, "docs", "projects", "yoru.md"), "# yoru\n");
  const withRepoDoc = { ...entry(), docs: ["docs/projects/yoru.md"] };
  assert.deepEqual(validateEntry(withRepoDoc, root), []);
});

function catalogFile(payload) {
  writeFileSync(path.join(root, "catalog.json"), JSON.stringify(payload));
}

const people = [{ id: "ikari", name: "ikari" }];
const organizations = [{ id: "ayamai", name: "ayamai", owner: "ikari" }];
const owned = () => ({ ...entry(), org: "ayamai" });

test("the loader keeps one broken entry from hiding the others", () => {
  catalogFile({ $schema: SCHEMA, people, organizations, entries: [owned(), { ...owned(), id: "broken", path: "nope" }] });
  const { entries, invalid } = loadCatalog(root);
  assert.equal(entries.length, 1);
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].id, "broken");
});

test("people and organizations load, and an entry carries its org", () => {
  catalogFile({ $schema: SCHEMA, people, organizations, entries: [owned()] });
  const catalog = loadCatalog(root);
  assert.equal(catalog.people.length, 1);
  assert.equal(catalog.organizations.length, 1);
  const resolved = resolveEntry(catalog.entries[0], root, catalog);
  assert.equal(resolved.org.id, "ayamai");
  assert.equal(resolved.org.ownerName, "ikari");
});

test("an entry pointing at a missing organization is refused, and named", () => {
  catalogFile({ $schema: SCHEMA, people, organizations, entries: [{ ...entry(), org: "nope" }] });
  const { entries, invalid } = loadCatalog(root);
  assert.equal(entries.length, 0);
  assert.ok(invalid[0].errors.some((error) => error.includes('org "nope" is not defined')));
});

test("an organization pointing at a missing owner is refused", () => {
  catalogFile({ $schema: SCHEMA, people, organizations: [{ id: "ayamai", name: "ayamai", owner: "nobody" }], entries: [] });
  const { organizations: loaded, invalid } = loadCatalog(root);
  assert.equal(loaded.length, 0);
  assert.ok(invalid[0].errors.some((error) => error.includes('owner "nobody" is not a person')));
});

test("duplicate ids are refused", () => {
  catalogFile({ $schema: SCHEMA, people: [people[0], people[0]], organizations, entries: [] });
  const { invalid } = loadCatalog(root);
  assert.ok(invalid.some((item) => item.errors.includes("duplicate person id")));
});

test("a @1 catalog still loads, with no organizations", () => {
  catalogFile({ $schema: LEGACY_SCHEMA, entries: [entry()] });
  const catalog = loadCatalog(root);
  assert.equal(catalog.legacy, true);
  assert.equal(catalog.entries.length, 1);
  assert.equal(catalog.organizations.length, 0);
  assert.equal(resolveEntry(catalog.entries[0], root).org, null);
});

test("paths are shortened, converted for Windows, and turned into editor URIs", () => {
  assert.ok(shortPath(path.join(process.env.HOME ?? "", "x")).startsWith("~"));
  assert.equal(wslWindowsPath("/home/x/y", "Ubuntu"), "\\\\wsl$\\Ubuntu\\home\\x\\y");
  assert.equal(editorUri("/home/x/y"), "vscode://file//home/x/y");
  assert.ok(revealUri("/home/x/y", { wsl: true }).includes("wsl$"));
});

test("a resolved entry carries everything the panel needs", () => {
  const resolved = resolveEntry(entry(), root);
  assert.ok(resolved.absPath.endsWith("projects/yoru"));
  assert.equal(resolved.docsResolved[0].exists, true);
  assert.ok(resolved.editorUri.startsWith("vscode://file/"));
});

test("markdown escapes first and builds only its own tags", () => {
  assert.equal(escapeHtml('<script>"x"</script>'), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  const html = renderMarkdown("# Title\n\nA **bold** and `code` and <script>bad</script>.\n\n```\n<b>fence</b>\n```\n\n- one\n- two\n");
  assert.ok(html.includes("<h1>Title</h1>"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("&lt;script&gt;bad&lt;/script&gt;"));
  assert.ok(html.includes("&lt;b&gt;fence&lt;/b&gt;"));
  assert.ok(html.includes("<ul>"));
  assert.ok(!html.includes("<script>"));
});

test("links are rendered, external ones neutered", () => {
  const html = renderMarkdown("[site](https://example.com)\n\n[local](/yoru/)");
  assert.ok(html.includes('rel="noreferrer"'));
  assert.ok(html.includes('href="/yoru/"'));
});

test("the file guard stops traversal, absolutes and symlink escapes", () => {
  assert.equal(safeResolve(path.join(root, "projects/yoru"), "../../etc/passwd").ok, false);
  assert.equal(safeResolve(path.join(root, "projects/yoru"), "/etc/passwd").ok, false);
  const link = path.join(root, "projects/yoru", "escape");
  symlinkSync("/etc", link);
  assert.equal(safeResolve(path.join(root, "projects/yoru"), "escape/passwd").ok, false);
  assert.equal(safeResolve(path.join(root, "projects/yoru"), "README.md").ok, true);
});

test("a directory lists one level and skips noise", () => {
  mkdirSync(path.join(root, "projects/yoru/node_modules"), { recursive: true });
  const listing = listTree(path.join(root, "projects/yoru"));
  assert.equal(listing.ok, true);
  assert.ok(listing.entries.some((row) => row.name === "README.md"));
  assert.ok(!listing.entries.some((row) => row.name === "node_modules"));
});

test("a file comes back as text, a directory and a binary do not", () => {
  const file = readFileSafe(path.join(root, "projects/yoru"), "code.js");
  assert.equal(file.ok, true);
  assert.ok(file.text.includes("console.log"));
  assert.equal(readFileSafe(path.join(root, "projects/yoru"), ".").ok, false);
  writeFileSync(path.join(root, "projects/yoru", "blob.bin"), Buffer.from([1, 0, 2, 3]));
  assert.equal(readFileSafe(path.join(root, "projects/yoru"), "blob.bin").error, "binary");
  assert.ok(MAX_FILE > 1024);
});
