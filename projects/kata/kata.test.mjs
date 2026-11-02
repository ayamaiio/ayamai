import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { validateTokens, setToken, renderCssVariables, renderTailwindTheme, SCHEMA } from "./tokens.mjs";
import { renderAll } from "./build.mjs";
import { COMPONENTS } from "./catalog.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const tokens = () => JSON.parse(readFileSync(path.join(import.meta.dirname, "tokens.json"), "utf8"));

test("the committed tokens are valid", () => {
  assert.deepEqual(validateTokens(tokens()), []);
});

test("bad colours, unknown groups and empty values are refused", () => {
  const base = tokens();
  assert.ok(validateTokens({ ...base, color: { ...base.color, rei: "blue" } }).some((e) => e.includes("hex")));
  assert.ok(validateTokens({ ...base, shadow: { a: "1px" } }).some((e) => e.includes("unknown group")));
  assert.ok(validateTokens({ ...base, color: { ...base.color, rei: "" } }).some((e) => e.includes("non-empty")));
  assert.ok(validateTokens({ ...base, spacing: { 1: "4" } }).some((e) => e.includes("px/rem")));
});

test("a token changes only when it is known and valid", () => {
  const base = tokens();
  assert.equal(setToken(base, "color.rei", "#ffffff").ok, true);
  assert.equal(setToken(base, "color.nope", "#ffffff").ok, false);
  assert.equal(setToken(base, "shadow.x", "#ffffff").ok, false);
  assert.equal(setToken(base, "color.rei", "nope").ok, false);
  assert.equal(base.color.rei, "#a9b7e8", "the source object is untouched");
});

test("rendering is stable and both worlds get the same values", () => {
  const base = tokens();
  const css = renderCssVariables(base);
  const tailwind = renderTailwindTheme(base);
  assert.ok(css.includes(`--rei: ${base.color.rei};`));
  assert.ok(tailwind.includes(`--color-rei: ${base.color.rei};`));
  assert.ok(css.includes("do not edit"));
  assert.equal(css, renderCssVariables(tokens()));
});

test("committed stylesheets match a fresh render", () => {
  for (const { file, text } of renderAll(tokens())) {
    const committed = readFileSync(path.join(REPO, file), "utf8");
    assert.equal(committed, text, `${file} is out of date — run node projects/kata/build.mjs`);
  }
});

test("every component is documented and its markup uses its own classes", () => {
  assert.ok(COMPONENTS.length >= 10);
  const names = new Set();
  for (const component of COMPONENTS) {
    assert.ok(component.name && component.note && component.markup, component.name);
    assert.ok(!names.has(component.name), `${component.name} is listed twice`);
    names.add(component.name);
    for (const cls of component.classes) {
      assert.ok(component.markup.includes(cls), `${component.name}: markup does not use ${cls}`);
    }
  }
});

test("the schema constant does not drift from the file", () => {
  assert.equal(tokens().$schema, SCHEMA);
});
