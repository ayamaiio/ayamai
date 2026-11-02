#!/usr/bin/env node
// Retire the backlog that predates the foundation.
//
// Snapshot first (JSON + readable markdown), then retire every item and clear the
// ideas inbox. Nothing is deleted: the event log keeps the history, and the
// archive says what the board looked like on the day.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const PLAN = path.join(REPO, "toys/plan/plan.mjs");
const IDEAS = path.join(REPO, ".plan/ideas.jsonl");
const DAY = new Date().toISOString().slice(0, 10);
const OUT = path.join(REPO, "docs/archive/plan");
const STEM = `${DAY}-pre-foundation`;

const plan = (...args) => execFileSync(process.execPath, [PLAN, ...args], { cwd: REPO, encoding: "utf8" });
const head = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();

function readLines(file) {
  try { return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; }
}

const items = JSON.parse(plan("list", "--all", "--json"));
const ideas = readLines(IDEAS);
const events = readLines(path.join(REPO, ".plan/events.jsonl")).length;

mkdirSync(OUT, { recursive: true });

const snapshot = {
  what: "the plan board before the foundation was settled",
  retiredAt: new Date().toISOString(),
  fromCommit: head(),
  eventsInLog: events,
  counts: {
    items: items.length,
    open: items.filter((item) => item.status !== "done" && item.status !== "retired").length,
    ideas: ideas.length,
  },
  items,
  ideas,
};
writeFileSync(path.join(OUT, `${STEM}.json`), JSON.stringify(snapshot, null, 2) + "\n");

const byProject = new Map();
for (const item of [...items].sort((a, b) => (a.project || "~").localeCompare(b.project || "~") || a.priority - b.priority)) {
  const key = item.project || "unscoped";
  if (!byProject.has(key)) byProject.set(key, []);
  byProject.get(key).push(item);
}

const md = [
  `# The pre-foundation board — ${DAY}`,
  "",
  `${items.length} items (${snapshot.counts.open} open) and ${ideas.length} captured ideas,`,
  `retired in one pass because they were written before the project settled on what it`,
  `is. Snapshot taken at commit \`${snapshot.fromCommit.slice(0, 7)}\`, ${events} events into`,
  "the log. Nothing was deleted: every item is still in `.plan/events.jsonl` and can be",
  "revived with `plan set <id> --status todo`.",
  "",
  "## Items",
  "",
];
for (const [project, group] of byProject) {
  md.push(`### ${project}`, "");
  for (const item of group) {
    md.push(`- **#${item.id}** P${item.priority} · ${item.status} — ${item.title}`);
    if (item.body) md.push("", ...item.body.split("\n").map((line) => line ? `  ${line}` : ""), "");
  }
  md.push("");
}
if (ideas.length) {
  md.push("## Ideas inbox", "");
  for (const idea of ideas) md.push(`- ${idea.text ?? JSON.stringify(idea)}`);
  md.push("");
}
writeFileSync(path.join(OUT, `${STEM}.md`), md.join("\n"));

console.log(`snapshot  docs/archive/plan/${STEM}.json`);
console.log(`readable  docs/archive/plan/${STEM}.md`);
console.log(`retiring  ${items.length} items`);

console.log(plan("retire", "--all"));

// The inbox is the same era's half-formed thoughts; archived above, then cleared.
if (existsSync(IDEAS)) {
  writeFileSync(IDEAS, "");
  console.log(`cleared   .plan/ideas.jsonl (${ideas.length} archived)`);
}

const after = JSON.parse(plan("list", "--all", "--json"));
console.log(`now       ${after.filter((item) => item.status === "retired").length} retired, ` +
  `${after.filter((item) => item.status !== "done" && item.status !== "retired").length} open`);
