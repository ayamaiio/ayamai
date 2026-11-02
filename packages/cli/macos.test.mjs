import test from "node:test";
import assert from "node:assert/strict";

import { execFileSync } from "node:child_process";
import { daemonPlist, agentPlist, installSteps, uninstallSteps, DAEMON_LABEL, AGENT_LABEL, DAEMON_PATH } from "./macos.mjs";

const facts = { node: "/opt/homebrew/bin/node", repo: "/Users/mark/ayamai", user: "mark", uid: 501, listen: 80, door: 25222 };

test("the daemon forwards 80 to the door and runs as root at boot", () => {
  const plist = daemonPlist(facts);
  assert.ok(plist.includes(`<string>${DAEMON_LABEL}</string>`));
  assert.ok(plist.includes("/Users/mark/ayamai/scripts/forward.mjs"));
  assert.ok(plist.includes("<string>80</string>") && plist.includes("<string>25222</string>"));
  assert.ok(plist.includes("<key>RunAtLoad</key>"));
  assert.ok(plist.includes("<key>KeepAlive</key>"));
});

test("the agent supervises the platform with a usable PATH", () => {
  const plist = agentPlist(facts);
  assert.ok(plist.includes(`<string>${AGENT_LABEL}</string>`));
  assert.ok(plist.includes("scripts/platform-up.mjs"));
  assert.ok(plist.includes("/opt/homebrew/bin:/usr/local/bin") || plist.includes("PATH"));
  assert.ok(plist.includes("<key>EnvironmentVariables</key>"));
});

test("paths and arguments are escaped into the plist, not interpolated raw", () => {
  const plist = daemonPlist({ ...facts, repo: "/Users/m & <m>/ayamai" });
  assert.ok(plist.includes("&amp;") && plist.includes("&lt;"));
  assert.ok(!plist.includes("<m>"));
});

test("install steps run in order: hosts, daemon, daemon load, agent, agent load", () => {
  const steps = installSteps(facts);
  assert.equal(steps.length, 6);
  assert.ok(steps[0].display.includes("hosts"));
  assert.ok(steps[1].display.includes("LaunchDaemon"));
  assert.ok(steps[1].shell.includes(DAEMON_PATH));
  assert.equal(steps.filter((step) => step.needsSudo).length, 3);
  assert.ok(steps[4].shell.includes("launchctl bootstrap gui/501"));
  assert.ok(steps[5].display.includes("open at login"));
  assert.ok(steps[5].shell.includes("local.ayamai.open"));
  assert.ok(steps[5].shell.includes("open-when-ready.mjs"));
});

test("uninstall removes both jobs and the hosts line", () => {
  const steps = uninstallSteps(facts);
  assert.equal(steps.length, 3);
  assert.ok(steps[0].shell.includes(DAEMON_LABEL));
  assert.ok(steps[2].shell.includes("sed -i ''"));
});

test("every shell step parses, and every plist is well-formed XML", () => {
  const facts = { node: "/opt/homebrew/bin/node", repo: "/Users/mark/ayamai", user: "mark", uid: 501, door: 25222 };
  for (const step of [...installSteps(facts), ...uninstallSteps(facts)]) {
    // sh -n parses without executing: quoting and heredocs are the usual bugs.
    execFileSync("sh", ["-n", "-c", step.shell.replace(/<<'PLIST'\n[\s\S]*?\nPLIST/,
      "<<'PLIST'\nplaceholder\nPLIST")]);
  }
  for (const plist of [daemonPlist(facts), agentPlist(facts)]) {
    assert.ok(plist.startsWith('<?xml version="1.0"'));
    assert.equal((plist.match(/<dict>/g) || []).length, (plist.match(/<\/dict>/g) || []).length);
    assert.equal((plist.match(/<array>/g) || []).length, (plist.match(/<\/array>/g) || []).length);
    assert.ok(plist.trimEnd().endsWith("</plist>"));
  }
});
