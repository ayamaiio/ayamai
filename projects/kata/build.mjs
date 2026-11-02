#!/usr/bin/env node
// tokens.json → every stylesheet that consumes it. Deterministic: same input,
// byte-identical output. Run it after an edit; CI proves it ran.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadTokens, renderCssVariables, renderTailwindTheme, validateTokens } from "./tokens.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");

export const OUTPUTS = [
  { file: "ui/tokens.css", render: renderCssVariables },
  { file: "projects/kata/public/tokens.css", render: renderCssVariables },
  { file: "projects/yoru/design-system/src/generated/tokens.css", render: renderTailwindTheme },
];

export function renderAll(tokens) {
  return OUTPUTS.map((output) => ({ file: output.file, text: output.render(tokens) }));
}

export function build() {
  const tokens = loadTokens(path.join(import.meta.dirname, "tokens.json"));
  const errors = validateTokens(tokens);
  if (errors.length) throw new Error(`invalid tokens: ${errors[0]}`);
  const written = [];
  for (const { file, text } of renderAll(tokens)) {
    const target = path.join(REPO, file);
    mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, text);
    renameSync(temp, target);
    written.push(file);
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const files = build();
    console.log(`kata: wrote ${files.join(", ")}`);
  } catch (error) {
    console.error(`kata: ${error.message}`);
    process.exit(1);
  }
}
