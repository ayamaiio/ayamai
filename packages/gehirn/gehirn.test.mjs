// The gehirn's decisions, tested without touching the machine.
import test from "node:test";
import assert from "node:assert/strict";

import { SERVICES, commandFor, pidOnPort, blockedReason } from "./services.mjs";
import { isTrustedRequest, ALLOWED_ORIGINS } from "./actions.mjs";
import { planOpen } from "./projects.mjs";

test("every service with a launcher resolves to argv, never a shell", () => {
  for (const service of SERVICES) {
    for (const action of ["start", "stop"]) {
      const argv = commandFor(service.id, action, { rom: "/mnt/z/Roms/test.gb" });
      if (!argv) continue;
      assert.ok(Array.isArray(argv) && argv.length === 2, `${service.id} ${action}`);
      assert.equal(typeof argv[0], "string");
      assert.ok(Array.isArray(argv[1]));
      assert.ok(!argv[1].some((arg) => /[;&|`$]/.test(String(arg))), `${service.id} ${action} looks like shell`);
    }
  }
});

test("unknown ids and actions are refused", () => {
  assert.equal(commandFor("nope", "start"), null);
  assert.equal(commandFor("web", "sideways"), null);
});

test("the managed services use the launcher, not a bespoke command", () => {
  assert.deepEqual(commandFor("api", "start"),
    ["python3", ["scripts/local-dev.py", "start", "--service", "api"]]);
  assert.deepEqual(commandFor("storybook", "start"),
    ["python3", ["scripts/local-dev.py", "start", "--service", "magi"]]);
  assert.deepEqual(commandFor("db", "stop"),
    ["docker", ["stop", "ayamai-dev-5ff1196a34fe"]]);
});

test("studio and gehirn cannot be started", () => {
  assert.equal(commandFor("studio", "start"), null);
  assert.equal(blockedReason({ self: true }), "this page");
});

test("only our own page may act", () => {
  const base = { "x-cockpit": "1", origin: "http://ayamai.local" };
  assert.equal(isTrustedRequest(base), true);
  assert.equal(isTrustedRequest({ ...base, origin: "http://localhost:25222" }), true);
  assert.equal(isTrustedRequest({ ...base, origin: "http://something.localhost:25222" }), true);
  assert.equal(isTrustedRequest({ ...base, origin: "https://evil.example" }), false);
  assert.equal(isTrustedRequest({ origin: "http://ayamai.local" }), false);
  assert.equal(isTrustedRequest({ "x-cockpit": "1" }), true); // local tooling
  assert.ok(ALLOWED_ORIGINS.has("http://ayamai.local"));
});

test("pid lookup reads a real ss line", () => {
  const dump = [
    'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process',
    'LISTEN 0      511        127.0.0.1:25222      0.0.0.0:*    users:(("node",pid=4242,fd=21))',
    'LISTEN 0      511        127.0.0.1:8081       0.0.0.0:*    users:(("node",pid=4343,fd=22))',
  ].join("\n");
  assert.equal(pidOnPort(dump, 25222), 4242);
  assert.equal(pidOnPort(dump, 8081), 4343);
  assert.equal(pidOnPort(dump, 9999), null);
  assert.equal(pidOnPort("", 25222), null);
});

test("plan counts match the terminal status command", () => {
  const events = [
    '{"t":"add","id":1}',
    '{"t":"add","id":2}',
    '{"t":"set","id":1,"fields":{"status":"done"}}',
    '{"t":"add","id":3}',
    '{"t":"rm","id":2}',
    "",
    "not json",
  ].join("\n");
  assert.equal(planOpen(events), 1); // 1 done, 2 removed, 3 still open
  assert.equal(planOpen(""), 0);
  assert.equal(planOpen(undefined), 0);
});
