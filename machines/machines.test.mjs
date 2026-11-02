// The machine files are generated, committed, and checked. Editing one by hand
// fails here rather than being silently overwritten by the next render.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  bootstrapSteps, describeHandoff, loadMachines, machineUrl, needsBootstrap,
  renderScript, renderText, scriptName, textName, validateMachine,
} from "../packages/cli/machines.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const { valid, invalid } = loadMachines(REPO);

test("every manifest is valid", () => {
  assert.deepEqual(invalid, [], "no broken manifests");
  assert.ok(valid.length >= 2, "at least this PC and the MacBook");
});

test("a machine renders the same way twice", () => {
  for (const machine of valid) {
    assert.equal(renderScript(machine), renderScript(machine));
    assert.equal(renderText(machine), renderText(machine));
  }
});

test("the extension follows the operating system", () => {
  assert.equal(scriptName({ id: "x", os: "darwin" }), "x.command");
  assert.equal(scriptName({ id: "x", os: "linux" }), "x.sh");
  assert.equal(scriptName({ id: "x", os: "win32" }), "x.ps1");
  assert.equal(textName({ id: "x", os: "darwin" }), "x.txt");
});

test("the script refuses the wrong operating system", () => {
  const mac = renderScript({ id: "m", label: "M", os: "darwin", sudo: true });
  assert.match(mac, /uname -s\)" = "Darwin"/);
  assert.match(mac, /this is the darwin script/);
  const linux = renderScript({ id: "l", label: "L", os: "linux", sudo: true });
  assert.match(linux, /uname -s\)" = "Linux"/);
});

test("no sudo means no privileged step, and a port instead of a name", () => {
  const machine = { id: "m", label: "M", os: "darwin", sudo: false };
  assert.ok(!renderScript(machine).includes("index.mjs install"), "no hosts step");
  assert.equal(machineUrl(machine), "http://localhost:25222");
  assert.equal(machineUrl({ ...machine, sudo: true }), "http://ayamai.local");
  assert.ok(renderText(machine).includes("No sudo here"));
});

test("the steps carry the floor, the workspace and the check", () => {
  const { steps } = bootstrapSteps({ id: "m", label: "M", os: "linux", sudo: true });
  const text = steps.map((step) => `${step.title} ${step.line}`).join("\n");
  assert.match(text, /20\.11/);
  assert.match(text, /pnpm install --frozen-lockfile/);
  assert.match(text, /index\.mjs up/);
  assert.match(text, /index\.mjs doctor/);
  assert.match(text, /index\.mjs install/);
});

test("the committed files are exactly what the renderer says", () => {
  for (const machine of valid) {
    const script = readFileSync(path.join(REPO, "machines", scriptName(machine)), "utf8");
    const text = readFileSync(path.join(REPO, "machines", textName(machine)), "utf8");
    assert.equal(script, renderScript(machine), `${scriptName(machine)} is stale — run: ayamai bootstrap ${machine.id}`);
    assert.equal(text, renderText(machine), `${textName(machine)} is stale — run: ayamai bootstrap ${machine.id}`);
  }
});

test("a bad manifest is refused with a sentence", () => {
  assert.equal(validateMachine({ id: "Bad Id", label: "x", os: "darwin" }).ok, false);
  assert.match(validateMachine({ id: "ok", label: "", os: "darwin" }).errors.join(" "), /label/);
  assert.match(validateMachine({ id: "ok", label: "x", os: "beos" }).errors.join(" "), /os must be one of/);
  assert.match(validateMachine({ id: "ok", label: "x", os: "darwin", notes: "nope" }).errors.join(" "), /notes/);
});

test("handoff says whether a bootstrap is needed", () => {
  const machine = { id: "macbook", label: "MacBook", os: "darwin" };
  assert.match(describeHandoff({ machine, behind: 0, lastSubject: "chore: lockfile" }).line, /run the script again/);
  assert.match(describeHandoff({ machine, behind: 3, lastSubject: "feat: x" }).line, /3 commits since/);
  assert.match(describeHandoff({ machine, behind: null }).line, /ayamai up/);

  assert.equal(needsBootstrap(["docs: typos"]), false);
  assert.equal(needsBootstrap(["chore(deps): bump package.json"]), true);
  assert.equal(needsBootstrap(["installer: macos daemon"]), true);
});

test("the bootstrap points at preflight, not at Homebrew", () => {
  const mac = renderScript({ id: "m", label: "M", os: "darwin", sudo: true });
  assert.match(mac, /preflight\.command/, "the Mac is told to ask its own version");
  assert.ok(!mac.includes("brew install node"), "and never at brew first");
  const linux = renderScript({ id: "l", label: "L", os: "linux", sudo: true });
  assert.ok(!linux.includes("brew install node"));
  assert.match(linux, /nodejs\.org/);
  assert.match(renderText({ id: "m", label: "M", os: "darwin", sudo: true }), /Xcode[\s\S]*Not needed/);
});

test("preflight parses, and picks an installer for each macOS era", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const preflight = path.join(REPO, "machines", "preflight.command");
  execFileSync("sh", ["-n", preflight], { stdio: "pipe" });

  const bin = mkdtempSync(path.join(tmpdir(), "preflight-"));
  writeFileSync(path.join(bin, "uname"), '#!/bin/sh\ncase "$1" in -s) echo Darwin ;; -m) echo arm64 ;; *) echo Darwin ;; esac\n');
  writeFileSync(path.join(bin, "sw_vers"), '#!/bin/sh\ncase "$1" in -productVersion) echo "$FAKE_MACOS" ;; -buildVersion) echo 21H1320 ;; esac\n');
  chmodSync(path.join(bin, "uname"), 0o755);
  chmodSync(path.join(bin, "sw_vers"), 0o755);

  const verdict = (version) => execFileSync("sh", [preflight], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_MACOS: version },
  });

  assert.match(verdict("14.2.1"), /latest-v24\.x/);
  assert.match(verdict("13.6"), /latest-v24\.x/);
  assert.match(verdict("12.7.6"), /latest-v22\.x/);
  assert.match(verdict("10.14.6"), /cannot run on this machine until macOS is upgraded/);
});
