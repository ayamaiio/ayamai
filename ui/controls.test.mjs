// The kit is the only place a control gets its face.
//
// A native button is white in WebKit and in forced colours, and `background: none`
// does not hide it - only `appearance: none` does. This test is the rule, so the
// next page that restyles a button fails here instead of in somebody's browser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const KIT = path.join(REPO, "ui", "ui.css");

/** Pure: the rules of a stylesheet, as text blocks between braces at depth 1. */
export function cssBlocks(css) {
  const text = String(css ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) blocks.push(text.slice(start, i + 1));
    }
  }
  return blocks;
}

/** Pure: does this block style a button without neutralising its appearance? */
export function offends(block) {
  const selector = String(block ?? "").split("{")[0];
  const body = String(block ?? "").slice(String(block ?? "").indexOf("{") + 1);
  const targetsButton = /(^|[,{\s])(button|\.btn\b|\.seg\b)/.test(selector);
  if (!targetsButton) return false;
  const paintsFace = /background\s*:\s*none/.test(body);
  const resets = /appearance\s*:\s*none/.test(body);
  return paintsFace && !resets;
}

test("the kit neutralises the browser's control face", () => {
  const css = readFileSync(KIT, "utf8");
  assert.match(css, /\.btn,[^{]*\.seg button[^{]*\{[^}]*appearance:\s*none/, "the reset covers .btn, .input and .seg button");
  assert.ok(css.includes(".seg button[aria-pressed=\"true\"]"), "and there is a segmented control to reuse");
});

test("the blanket rule covers buttons with no class at all", () => {
  const css = readFileSync(KIT, "utf8");
  assert.match(css, /(^|\n)button\s*\{[^}]*appearance:\s*none/, "a page that forgets a class still gets the reset");
});

test("a control that paints over the browser face must reset it", () => {
  assert.equal(offends(".btn { background: none; border: 0; }"), true, "the bug, in miniature");
  assert.equal(offends(".btn { background: none; appearance: none; }"), false, "the fix");
  assert.equal(offends(".list li { background: none; }"), false, "not every rule is a control");
});

test("every page that draws a button neutralises the browser face", () => {
  const pages = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!["node_modules", ".git", "dist", "build"].includes(name)) walk(full);
        continue;
      }
      if (!/\.(mjs|html)$/.test(name)) continue;
      if (name.includes(".test.")) continue;
      pages.push(full);
    }
  };
  for (const dir of ["packages", "projects", "ui"]) walk(path.join(REPO, dir));

  const offenders = [];
  for (const file of pages) {
    const text = readFileSync(file, "utf8");
    // a page with a <button> in its markup needs the reset somewhere in its styles
    // the tag, not the word: a CLI comment mentioning <button> is not a page
    // a page: it has its own stylesheet and it draws a button
    if (!/<style/i.test(text) || !/<button\b/i.test(text)) continue;
    if (/appearance\s*:\s*none/.test(text)) continue;
    // the kit resets every button it draws, so linking it is enough
    if (text.includes("/ui/ui.css") || text.includes("/ui/tokens.css")) continue;
    offenders.push(path.relative(REPO, file));
  }
  assert.deepEqual(offenders, [], "these pages draw buttons without appearance: none");
});


test("a page that links the kit does not carry a palette of its own", () => {
  // two palettes in one product is how --rei came to mean red on one page and
  // lilac on another
  const PALETTE = /--(void|pale|line|card|rei|violet|dim|muted|ok|warn|red)\s*:/;
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
    if (PALETTE.test(text)) offenders.push(path.relative(REPO, file));
  }
  assert.deepEqual(offenders, [], "these pages link the kit and then define its tokens again");
});
