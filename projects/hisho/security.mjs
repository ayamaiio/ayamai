// What an agent may touch, and the record of what it did.
//
// The jail is a resolved path inside the repo; the allowlist is code, not
// configuration, so an agent cannot widen it by editing a file.
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const REPO = process.env.AYAMAI_REPO ?? path.resolve(import.meta.dirname, "../..");
export const READ_LIMIT = 512 * 1024;
export const RETURN_LIMIT = 16 * 1024;
export const RUN_TIMEOUT = 120_000;

const DENY = [/^\.git(\/|$)/, /(^|\/)node_modules(\/|$)/, /(^|\/)\.env/, /\.(key|pem|p12)$/, /(^|\/)\.plan\/events\.jsonl$/];

export function dataPath(name) {
  const base = process.env.AYAMAI_DATA ?? path.join(process.env.HOME ?? ".", ".local", "share", "ayamai");
  mkdirSync(base, { recursive: true });
  return path.join(base, name);
}

/** Pure-ish: does a relative path land inside the repo and pass the deny list? */
export function checkPath(relative) {
  const raw = String(relative ?? "");
  // An absolute path is never a repo path, even if it happens to resolve inside it.
  if (raw.startsWith("/") || /^[a-z]:/i.test(raw)) return { ok: false, error: "absolute paths are not allowed" };
  const cleaned = raw.replace(/^\/+/, "");
  if (!cleaned) return { ok: false, error: "path is required" };
  if (cleaned.split("/").includes("..")) return { ok: false, error: "traversal is not allowed" };
  const abs = path.resolve(REPO, cleaned);
  if (abs !== REPO && !abs.startsWith(`${REPO}${path.sep}`)) return { ok: false, error: "outside the repository" };
  const rel = path.relative(REPO, abs).split(path.sep).join("/");
  if (DENY.some((pattern) => pattern.test(rel))) return { ok: false, error: `${rel} is not readable by agents` };
  return { ok: true, abs, rel };
}

export function readText(relative, { offset = 1, limit } = {}) {
  const checked = checkPath(relative);
  if (!checked.ok) return checked;
  let info;
  try { info = statSync(checked.abs); } catch { return { ok: false, error: "not found" }; }
  if (info.isDirectory()) return { ok: false, error: "is a directory — use file.list" };
  if (info.size > READ_LIMIT) return { ok: false, error: `too large (${Math.round(info.size / 1024)} KB)` };
  const text = readFileSync(checked.abs, "utf8");
  const lines = text.split("\n");
  const start = Math.max(1, Number(offset) || 1);
  const end = limit ? start + Number(limit) - 1 : lines.length;
  return { ok: true, rel: checked.rel, text: lines.slice(start - 1, end).join("\n"), lines: lines.length, from: start, to: Math.min(end, lines.length) };
}

export function writeText(relative, content) {
  const checked = checkPath(relative);
  if (!checked.ok) return checked;
  if (String(content ?? "").length > READ_LIMIT) return { ok: false, error: "content is too large" };
  let before = "";
  try { before = readFileSync(checked.abs, "utf8"); } catch { before = ""; }
  mkdirSync(path.dirname(checked.abs), { recursive: true });
  writeFileSync(checked.abs, content ?? "");
  return { ok: true, rel: checked.rel, created: before === "", before, after: content ?? "" };
}

export function listDir(relative = "") {
  const checked = relative ? checkPath(relative) : { ok: true, abs: REPO, rel: "" };
  if (!checked.ok) return checked;
  let entries;
  try { entries = readdirSync(checked.abs, { withFileTypes: true }); } catch { return { ok: false, error: "unreadable" }; }
  const rows = entries
    .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
    .map((entry) => {
      let size = 0;
      try { size = entry.isDirectory() ? 0 : statSync(path.join(checked.abs, entry.name)).size; } catch { /* gone */ }
      return { name: entry.name, dir: entry.isDirectory(), size };
    })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    .slice(0, 300);
  return { ok: true, rel: checked.rel, entries: rows };
}

/** A tiny glob for the two patterns we actually need: a/*\/b.test.mjs */
export function expand(pattern) {
  const [head, tail] = pattern.split("/*/");
  const dir = path.join(REPO, head);
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!tail) { files.push(path.join(dir, entry.name)); continue; }
    const candidate = path.join(dir, entry.name, tail);
    try { if (statSync(candidate).isFile()) files.push(candidate); } catch { /* no match */ }
  }
  return files.sort();
}

const plan = (...args) => [process.execPath, [path.join(REPO, "toys/plan/plan.mjs"), ...args]];

/** The only commands an agent may run. Named, argv, no shell. */
export function runs() {
  const testFiles = [...expand("packages/*/*.test.mjs"), ...expand("projects/*/*.test.mjs")];
  return {
    test: { argv: [[process.execPath, ["--test", ...testFiles]]], note: "the platform and project suites" },
    "docs-check": { argv: [[process.execPath, [path.join(REPO, "scripts/check-docs.mjs")]]], note: "dead links in the docs" },
    verify: {
      argv: [
        [process.execPath, ["--test", ...testFiles]],
        [process.execPath, [path.join(REPO, "scripts/check-docs.mjs")]],
      ],
      note: "tests plus the docs check",
    },
    "git-status": { argv: [["git", ["-C", REPO, "status", "--short"]]], note: "uncommitted files" },
    "git-diff": { argv: [["git", ["-C", REPO, "diff", "--stat"]]], note: "diff summary" },
    "git-log": { argv: [["git", ["-C", REPO, "log", "--oneline", "-15"]]], note: "recent commits" },
    plan,
  };
}

export function run(name) {
  const table = runs();
  const entry = table[name];
  if (!entry || name === "plan") return { ok: false, error: `unknown command "${name}"`, allowed: Object.keys(table).filter((key) => key !== "plan") };
  return new Promise((resolve) => {
    const outputs = [];
    let index = 0;
    const next = () => {
      if (index >= entry.argv.length) return resolve({ ok: true, name, note: entry.note, output: outputs.join("\n").slice(-RETURN_LIMIT) });
      const [command, args] = entry.argv[index++];
      execFile(command, args, { cwd: REPO, timeout: RUN_TIMEOUT, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        outputs.push(`$ ${path.basename(command)} ${args.slice(0, 4).join(" ")}${args.length > 4 ? " …" : ""}\n${String(stdout || stderr).slice(-RETURN_LIMIT)}${error ? `\n[exit ${error.code ?? 1}]` : ""}`);
        next();
      });
    };
    next();
  });
}

export function planTool(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(REPO, "toys/plan/plan.mjs"), ...args], { cwd: REPO, timeout: 20_000 }, (error, stdout, stderr) =>
      resolve({ ok: !error, out: String(stdout).trim(), error: error ? String(stderr || error.message).split("\n")[0] : "" }));
  });
}

/** One line per call. Contents never go in the log; paths and sizes do. */
export function audit(entry) {
  try {
    appendFileSync(dataPath("hisho-audit.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch { /* auditing must never break a call */ }
}

export function recentAudit(limit = 20) {
  try {
    return readFileSync(dataPath("hisho-audit.jsonl"), "utf8").trim().split("\n").filter(Boolean).slice(-limit)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean).reverse();
  } catch { return []; }
}
