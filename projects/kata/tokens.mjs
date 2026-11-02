// The tokens, and the rules for changing them.
//
// One file is the source of truth for every surface: the plain-CSS kit that
// gehirn, seiri and the toys use, the showroom, and yoru's Tailwind world.
import { readFileSync } from "node:fs";
import path from "node:path";

export const SCHEMA = "ayamai/tokens@1";
export const GROUPS = ["color", "typography", "radius", "spacing"];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const LENGTH = /^(?:0|[0-9.]+)(?:px|rem|em)$/;
const KEY = /^[a-z0-9][a-z0-9-]{0,23}$/;

export function loadTokens(file = path.join(import.meta.dirname, "tokens.json")) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Pure: every key and value obeys the schema. */
export function validateTokens(tokens) {
  const errors = [];
  if (!tokens || typeof tokens !== "object") return ["tokens are not an object"];
  if (tokens.$schema !== SCHEMA) errors.push(`$schema must be ${SCHEMA}`);
  for (const group of Object.keys(tokens)) {
    if (group === "$schema") continue;
    if (!GROUPS.includes(group)) { errors.push(`unknown group "${group}"`); continue; }
    const values = tokens[group];
    if (!values || typeof values !== "object") { errors.push(`${group} must be an object`); continue; }
    for (const [key, value] of Object.entries(values)) {
      if (!KEY.test(key)) errors.push(`${group}.${key}: key must be a lowercase slug`);
      if (typeof value !== "string" || !value.trim()) { errors.push(`${group}.${key}: value must be a non-empty string`); continue; }
      if (group === "color" && !HEX.test(value)) errors.push(`${group}.${key}: expected a hex colour`);
      if (group === "radius" || group === "spacing") {
        if (!LENGTH.test(value)) errors.push(`${group}.${key}: expected a px/rem length`);
      }
      if (group === "typography" && value.length > 120) errors.push(`${group}.${key}: family list is too long`);
    }
  }
  for (const group of GROUPS) if (!tokens[group]) errors.push(`${group} is required`);
  return errors;
}

/** Pure: one token changed, or a reason why not. */
export function setToken(tokens, tokenPath, value) {
  const [group, key] = String(tokenPath ?? "").split(".");
  if (!GROUPS.includes(group)) return { ok: false, error: `unknown group "${group}"` };
  if (!tokens[group] || !(key in tokens[group])) return { ok: false, error: `unknown token "${tokenPath}"` };
  const next = structuredClone(tokens);
  next[group][key] = String(value ?? "").trim();
  const errors = validateTokens(next);
  if (errors.length) return { ok: false, error: errors[0] };
  return { ok: true, tokens: next };
}

/** Pure: the :root block the plain-CSS kit consumes. */
export function renderCssVariables(tokens) {
  const lines = ["/* generated from projects/kata/tokens.json - do not edit */", ":root {"];
  for (const [key, value] of Object.entries(tokens.color)) lines.push(`  --${key}: ${value};`);
  for (const [key, value] of Object.entries(tokens.radius)) lines.push(`  --radius-${key}: ${value};`);
  for (const [key, value] of Object.entries(tokens.spacing)) lines.push(`  --space-${key}: ${value};`);
  lines.push(`  --serif: ${tokens.typography.serif};`);
  lines.push(`  --sans: ${tokens.typography.sans};`);
  lines.push(`  --mono: ${tokens.typography.mono};`);
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

/** Pure: the @theme block yoru's Tailwind world consumes. */
export function renderTailwindTheme(tokens) {
  const lines = ["/* generated from projects/kata/tokens.json - do not edit */", "@theme {"];
  for (const [key, value] of Object.entries(tokens.color)) lines.push(`  --color-${key}: ${value};`);
  for (const [key, value] of Object.entries(tokens.radius)) lines.push(`  --radius-${key}: ${value};`);
  for (const [key, value] of Object.entries(tokens.spacing)) lines.push(`  --spacing-${key}: ${value};`);
  lines.push(`  --font-serif: ${tokens.typography.serif};`);
  lines.push(`  --font-sans: ${tokens.typography.sans};`);
  lines.push(`  --font-mono: ${tokens.typography.mono};`);
  lines.push("}");
  return `${lines.join("\n")}\n`;
}
