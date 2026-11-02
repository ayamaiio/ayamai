// Machines: one file per environment that the environment itself can run.
//
// A manifest holds the facts; `ayamai bootstrap` renders a runnable script and a
// readable twin from it; `ayamai handoff` says what the machine you are not
// sitting at needs. Nothing here talks to the network.
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/** The floor is 20.11, not 20: the platform uses `import.meta.dirname`. */
export const NODE_FLOOR = "20.11";
export const PNPM_MAJOR = "10";
export const OSES = ["darwin", "linux", "win32"];

const SCRIPT_EXT = { darwin: "command", linux: "sh", win32: "ps1" };
const OS_TITLE = { darwin: "macOS", linux: "Linux", win32: "Windows" };

export function machinesDir(repo) {
  return path.join(repo, "machines");
}

/** Read and validate every manifest. Broken manifests are reported, not thrown. */
export function loadMachines(repo) {
  const dir = machinesDir(repo);
  const valid = [];
  const invalid = [];
  let files = [];
  try { files = readdirSync(dir).filter((file) => file.endsWith(".json")); } catch { return { valid, invalid }; }
  for (const file of files.sort()) {
    let raw;
    try { raw = JSON.parse(readFileSync(path.join(dir, file), "utf8")); } catch (error) {
      invalid.push({ file, errors: [`not valid JSON: ${error.message}`] });
      continue;
    }
    const check = validateMachine(raw, file);
    if (check.ok) valid.push(raw); else invalid.push({ file, errors: check.errors });
  }
  const seen = new Set();
  for (const machine of valid) {
    if (seen.has(machine.id)) invalid.push({ file: `${machine.id}.json`, errors: [`duplicate machine id "${machine.id}"`] });
    seen.add(machine.id);
  }
  return { valid: valid.filter((machine) => !invalid.some((bad) => bad.file === `${machine.id}.json`)), invalid };
}

export function validateMachine(raw, file = "") {
  const errors = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["not an object"] };
  if (typeof raw.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(raw.id)) errors.push(`id must be lowercase kebab-case (${file})`);
  if (typeof raw.label !== "string" || !raw.label.trim()) errors.push("label is required");
  if (!OSES.includes(raw.os)) errors.push(`os must be one of ${OSES.join(", ")}`);
  if (raw.role !== undefined && typeof raw.role !== "string") errors.push("role must be a string");
  if (raw.sudo !== undefined && typeof raw.sudo !== "boolean") errors.push("sudo must be true or false");
  if (raw.notes !== undefined && (!Array.isArray(raw.notes) || raw.notes.some((note) => typeof note !== "string"))) {
    errors.push("notes must be an array of strings");
  }
  return { ok: errors.length === 0, errors };
}

export function scriptName(machine) {
  return `${machine.id}.${SCRIPT_EXT[machine.os] ?? "sh"}`;
}

export function textName(machine) {
  return `${machine.id}.txt`;
}

/** The URL the script ends on: the name when it will own port 80, the port when not. */
export function machineUrl(machine) {
  return machine.sudo === false ? "http://localhost:25222" : "http://ayamai.local";
}

/**
 * Pure: the steps of a bootstrap, as data. One list renders both the runnable
 * script and the readable text, so they cannot drift apart.
 */
export function bootstrapSteps(machine) {
  const sudo = machine.sudo !== false;
  const url = machineUrl(machine);
  const steps = [
    {
      hard: true,
      title: `node ${NODE_FLOOR} or newer`,
      check: "command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(\".\").map(Number); process.exit(a>20||(a===20&&b>=11)?0:1)'",
      fail: machine.os === "darwin"
        ? `node is missing or older than ${NODE_FLOOR}. Run ./machines/preflight.command — it names the installer for this macOS (no Xcode needed).`
        : `node is missing or older than ${NODE_FLOOR}. Install it from nodejs.org (LTS, 20.11 or newer).`,
      line: "",
    },
    {
      hard: true,
      title: `pnpm ${PNPM_MAJOR}`,
      check: "command -v pnpm >/dev/null 2>&1",
      fail: `pnpm not found. Run: corepack enable && corepack prepare pnpm@${PNPM_MAJOR} --activate`,
      line: "",
    },
    {
      title: "the workspace",
      check: '[ -d node_modules ] && [ ! package.json -nt node_modules ] && [ ! pnpm-lock.yaml -nt node_modules ]',
      fail: "",
      line: "pnpm install --frozen-lockfile",
    },
  ];
  if (sudo) {
    steps.push({
      title: "the name on this machine (asks for your password once)",
      check: "grep -q ayamai.local /etc/hosts 2>/dev/null",
      fail: "",
      line: "node packages/cli/index.mjs install",
    });
  }
  steps.push(
    { title: "the platform", check: "", fail: "", line: "node packages/cli/index.mjs up" },
    { title: "the check", check: "", fail: "", line: "node packages/cli/index.mjs doctor" },
  );
  return { steps, url, sudo };
}

const xml = (text) => String(text).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);

/** Pure: the runnable script for a machine. */
export function renderScript(machine) {
  const { steps, url } = bootstrapSteps(machine);
  const header = (comment) => `# ayamai — ${machine.label}
# Generated by \`ayamai bootstrap ${machine.id}\`. Edit machines/${machine.id}.json, not this file.
`;

  if (machine.os === "win32") {
    const body = steps.filter((step) => step.line).map((step) => `Write-Host "· ${step.title}"
${step.line}`).join("\n\n");
    return `${header()}$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") { Write-Host "this is the windows script; you are on $($env:OS)"; exit 1 }

Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "node not found — install Node ${NODE_FLOOR} or newer"; exit 1 }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Write-Host "pnpm not found — run: corepack enable"; exit 1 }

${body}

Write-Host ""
Write-Host "ayamai is up — ${url}"
`;
  }

  const guard = machine.os === "linux"
    ? `[ "$(uname -s)" = "Linux" ] || { echo "this is the linux script; you are on $(uname -s)"; exit 1; }`
    : `[ "$(uname -s)" = "Darwin" ] || { echo "this is the darwin script; you are on $(uname -s)"; exit 1; }`;

  const body = steps.map((step) => {
    if (step.hard) {
      return `# ${step.title}
if ${step.check}; then
  echo "· ${step.title}: ok"
else
  echo "${step.fail}"
  exit 1
fi`;
    }
    if (step.check) {
      return `# ${step.title}
if ${step.check}; then
  echo "· ${step.title}: already done"
else
  ${step.line}
fi`;
    }
    return `# ${step.title}
${step.line}`;
  }).join("\n\n");

  return `#!/bin/sh
${header()}
set -eu

echo "ayamai — ${machine.label}"

${guard}

cd "$(dirname "$0")/.."

${body}

echo ""
echo "ayamai is up — ${url}"
`;
}

/** Pure: the readable twin, for reading and pasting. */
export function renderText(machine) {
  const { steps, url } = bootstrapSteps(machine);
  const lines = [
    `ayamai on ${machine.label} (${OS_TITLE[machine.os] ?? machine.os})`,
    "=".repeat(`ayamai on ${machine.label}`.length + 6),
    "",
    `Role: ${machine.role ?? "platform"}`,
    "",
    "Run it, or paste the commands one at a time:",
    "",
    `  ./machines/${scriptName(machine)}`,
    "",
  ];
  for (const step of steps) {
    if (!step.line) continue;
    lines.push(`  ${step.line}${step.title ? `    # ${step.title}` : ""}`);
  }
  lines.push("", "Then open", "", `  ${url}`, "");
  if (machine.os === "darwin") {
    lines.push("Xcode", "-----", "",
      "  Not needed. ayamai has no native modules; Xcode only buys python3,",
      "  git upgrades and Homebrew. Run ./machines/preflight.command to see",
      "  which Node installer this macOS can actually use.", "");
  }
  if (machine.notes?.length) {
    lines.push("Notes for this machine", "---------------------", "");
    for (const note of machine.notes) lines.push(`  - ${note}`);
    lines.push("");
  }
  if (machine.sudo === false) {
    lines.push("No sudo here", "------------", "",
      "  This script skips the hosts entry and port 80; the panel answers on", "  http://localhost:25222 instead of the name.", "");
  }
  lines.push("Keeping it current", "------------------", "",
    "  cd <repo> && git pull", "",
    "The generated files are checked into git; edit machines/*.json and re-run", "`ayamai bootstrap <id>` to change one.", "");
  return lines.join("\n");
}

/** Pure: what a commit subject says about whether a bootstrap is needed. */
export function needsBootstrap(subjects = []) {
  return subjects.some((subject) =>
    /\b(install\w*|bootstrap|machines|package\.json|lockfile|lock file|node|pnpm)\b/i.test(subject));
}

/** Pure: the sentence `handoff` prints for one machine. */
export function describeHandoff({ machine, behind = null, lastSubject = null }) {
  const run = `cd <repo> && git pull && ./machines/${scriptName(machine)}`;
  if (behind === null) return { machine, run, line: "bootstrap files have not changed in the last 20 commits — `git pull && ayamai up` is enough" };
  if (behind === 0) return { machine, run, line: `bootstrap-shaped change in the last commit${lastSubject ? ` (${lastSubject})` : ""} — run the script again` };
  return { machine, run, line: `${behind} commit${behind === 1 ? "" : "s"} since the last bootstrap-shaped change — \`git pull && ayamai up\` is enough` };
}

/** The git side, kept out of the pure functions. */
export function handoffFacts(repo, machine, { limit = 20 } = {}) {
  const paths = ["package.json", "pnpm-lock.yaml", "scripts/install.sh", "scripts/install.ps1", "packages/cli", `machines/${machine.id}.json`];
  try {
    const log = execFileSync("git", ["log", `-${limit}`, "--format=%h%x09%s", "--", ...paths], { cwd: repo, encoding: "utf8" }).trim();
    if (!log) return { behind: null, lastSubject: null, recent: [] };
    const rows = log.split("\n").map((line) => {
      const [sha, ...rest] = line.split("\t");
      return { sha, subject: rest.join("\t") };
    });
    const index = rows.findIndex((row) => needsBootstrap([row.subject]));
    return {
      behind: index < 0 ? null : index,
      lastSubject: index < 0 ? null : rows[index].subject,
      recent: rows.slice(0, 5),
    };
  } catch {
    return { behind: null, lastSubject: null, recent: [], noGit: true };
  }
}
