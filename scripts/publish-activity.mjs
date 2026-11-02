#!/usr/bin/env node
// Publishes the current local import state next to the vault, so the app can say
// what the box is doing without asking any other process.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim();
const LOG = process.env.AYAMAI_IMPORT_LOG?.trim();
if (!ROOT || !LOG) {
  console.error("AYAMAI_LOCAL_MEDIA_ROOT and AYAMAI_IMPORT_LOG are required.");
  process.exit(1);
}
const OUT = path.resolve(ROOT, "..", "state", "activity.json");
const INTERVAL_MS = Number(process.env.AYAMAI_ACTIVITY_INTERVAL ?? 5000);

/** Derive state from the newest stage block in the import log. */
export function readActivity(text, now = () => new Date()) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("=== START ")) { start = i; break; }
  }
  if (start === -1) return null;
  const block = lines.slice(start);
  if (block.some((line) => line.startsWith("ALL DONE"))) return null;

  const label = block[0].slice("=== START ".length).trim().split(/\s+/)[0] ?? "";
  if (!label) return null;

  let total = 0;
  let done = 0;
  for (const line of block) {
    const scanned = /^scanned=\d+ supported=(\d+)/.exec(line);
    if (scanned) total = Number(scanned[1]);
    const progress = /^progress=(\d+)/.exec(line);
    if (progress) done = Number(progress[1]);
  }
  return { label, done, total, updatedAt: now().toISOString() };
}

async function publish() {
  try {
    const activity = readActivity(await readFile(LOG, "utf8"));
    if (!activity) return;
    await mkdir(path.dirname(OUT), { recursive: true });
    const tmp = `${OUT}.tmp-${process.pid}`;
    await writeFile(tmp, JSON.stringify(activity));
    await rename(tmp, OUT);
  } catch {
    // No log yet simply means there is nothing to publish.
  }
}

await publish();
setInterval(() => void publish(), INTERVAL_MS);
