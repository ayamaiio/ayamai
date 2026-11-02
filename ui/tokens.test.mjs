// Every token a stylesheet uses must be a token somebody defines.
//
// --eva was used five times in the kit and defined nowhere: links, hovers, focus
// rings and a progress bar all fell back to currentColor, and nothing said so.
// This is the check that would have.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const TOKENS = path.join(REPO, "ui", "tokens.css");
const KIT = path.join(REPO, "ui", "ui.css");

/** Pure: the custom properties a stylesheet defines at :root or anywhere. */
export function defines(css) {
  const names = new Set();
  for (const match of String(css ?? "").matchAll(/(--[a-z0-9-]+)\s*:/g)) names.add(match[1]);
  return names;
}

/** Pure: every custom property a stylesheet reads. */
export function uses(css) {
  const names = new Set();
  for (const match of String(css ?? "").matchAll(/var\(\s*(--[a-z0-9-]+)/g)) names.add(match[1]);
  return names;
}

/** Pure: reads with no definition. `known` is what the environment provides. */
export function unresolved(css, known) {
  return [...uses(css)].filter((name) => !known.has(name) && !defines(css).has(name));
}

test("the kit only reads tokens it defines", () => {
  const css = readFileSync(KIT, "utf8");
  const known = defines(readFileSync(TOKENS, "utf8"));
  assert.deepEqual(unresolved(css, known), [], "these tokens are read but never defined");
});

test("a page that links the kit resolves its variables against it", () => {
  const known = defines(readFileSync(TOKENS, "utf8") + readFileSync(KIT, "utf8"));
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!["node_modules", ".git"].includes(name)) walk(full);
        continue;
      }
      if (/\.(mjs|html)$/.test(name) && !name.includes(".test.")) files.push(full);
    }
  };
  for (const dir of ["packages", "projects"]) walk(path.join(REPO, dir));

  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("/ui/ui.css") && !text.includes("/ui/tokens.css")) continue;
    for (const name of unresolved(text, known)) offenders.push(path.relative(REPO, file) + ": " + name);
  }
  assert.deepEqual(offenders, [], "these variables have no definition anywhere");
});
