import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const hook = (url, env = {}) => {
  try {
    execFileSync(process.execPath, ["scripts/hook-pre-push.mjs", "origin", url], {
      env: { ...process.env, ...env }, stdio: "pipe", encoding: "utf8",
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, output: String(error.stderr ?? error.message) };
  }
};

test("the local mirror takes a push without ceremony", () => {
  assert.equal(hook("/mnt/y/git/ayamai.git").ok, true);
  assert.equal(hook("https://github.com/markfoster314/ayamai.git").ok, true);
});

test("the org refuses an ordinary push and says what to run", () => {
  const refused = hook("git@github.com:ayamaiio/ayamai.git");
  assert.equal(refused.ok, false);
  assert.match(refused.output, /ayamai publish/);
});

test("publish, and only publish, may push to the org", () => {
  assert.equal(hook("git@github.com:ayamaiio/ayamai.git", { AYAMAI_PUBLISH: "1" }).ok, true);
});
