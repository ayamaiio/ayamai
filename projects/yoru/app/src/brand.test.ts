// The brand is a few values in a few places. This is the guard that they stay.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname);
const read = (file: string) => readFileSync(path.join(SRC, file), "utf8");

/** Every source file under src/, so a new screen cannot reintroduce the old palette. */
function sources(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) { sources(full, out); continue; }
    if (/\.(tsx?|css)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

const LEGACY = ["#202a5a", "#e53935", "#263450", "#3d5684"];

describe("the app wears the platform's palette", () => {
  it("has no legacy hex left anywhere in src", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const hex of LEGACY) if (text.includes(hex)) offenders.push(`${path.relative(SRC, file)} → ${hex}`);
    }
    expect(offenders).toEqual([]);
  });

  it("is dark by construction", () => {
    const css = read("index.css");
    expect(css).toContain("color-scheme: dark");
    expect(css).not.toContain("color-scheme: light");
  });

  it("gets its tokens from the design system, not a local palette", () => {
    expect(read("index.css")).toContain("@workspace/ayamai-design-system/styles.css");
  });
});
