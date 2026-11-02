// The gehirn's decisions, tested without touching the machine.
import test from "node:test";
import assert from "node:assert/strict";

import { SERVICES, commandFor, pidOnPort, blockedReason, statusLine, sortServices, startOrder, projectSummary } from "./services.mjs";
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

test("the header names what is down, and what is old", () => {
  const healthy = statusLine([{ name: "a", up: true }, { name: "b", up: true }]);
  assert.equal(healthy.text, "2 / 2 up");

  const two = statusLine([{ name: "a", up: true }, { name: "studio", up: false }, { name: "gemu", up: false }]);
  assert.equal(two.text, "1 / 3 up · studio, gemu", "names them");

  const many = statusLine([
    { name: "a", up: false }, { name: "b", up: false }, { name: "c", up: false }, { name: "d", up: true },
  ]);
  assert.equal(many.text, "1 / 4 up · a, b +1 more", "and stops naming after two");

  const ageing = statusLine([{ name: "hisho", up: true, stale: true }]);
  assert.equal(ageing.text, "1 / 1 up · 1 stale");
});

test("broken first, then old, then alphabetical", () => {
  const sorted = sortServices([
    { id: "zeta", name: "zeta", up: true },
    { id: "alpha", name: "alpha", up: true },
    { id: "old", name: "old", up: true, stale: true },
    { id: "down", name: "down", up: false },
  ]).map((service) => service.id);
  assert.deepEqual(sorted, ["down", "old", "alpha", "zeta"]);
});

test("the panel is a tool, and it reads like one", async () => {
  const { renderPage } = await import("./page.mjs");
  const html = renderPage({ hostname: "machine", phone: "phone", startedAt: Date.now() });

  assert.ok(html.includes('id="summary"') && html.includes('class="btn ghost sm"'), "the header is a control from the kit");
  assert.ok(html.includes('id="service-filter"'), "services can be filtered");
  assert.ok(html.includes('id="palette"'), "there is a jump palette");
  assert.ok(html.includes("jump to a project or service"), "and it says what it is");
  assert.ok(html.includes('id="log-toggle"'), "the log folds");
  assert.ok(html.includes('"restart"'), "a stale service can be restarted from its row");
});

test("a project starts its dependencies first, and stops in reverse", () => {
  assert.deepEqual(startOrder(["web", "api", "db"]), ["db", "api", "web"]);
  assert.deepEqual(startOrder(["agent", "api"]), ["api", "agent"]);
  const unknown = startOrder(["zzz", "db", "aaa"]);
  assert.equal(unknown[0], "db", "known ids rank first");
  assert.deepEqual(unknown.slice(1).sort(), ["aaa", "zzz"], "unknowns follow");
});

test("the project chip counts only what can be started", () => {
  const services = [
    { id: "db", project: "yoru", up: true },
    { id: "api", project: "yoru", up: false },
    { id: "web", project: "yoru", up: false },
    { id: "studio", project: "yoru", up: false, blocked: "unmanaged" },
    { id: "other", project: "uta", up: true },
  ];
  const summary = projectSummary(services, "yoru");
  assert.equal(summary.total, 3, "the blocked service is not counted");
  assert.equal(summary.up, 1);
  assert.deepEqual(summary.down, ["api", "web"]);
  assert.equal(summary.canStart, true);
  assert.equal(summary.chip, undefined);
  assert.equal(summary.label, "1 of 3 up");

  const allUp = projectSummary([{ id: "a", project: "x", up: true }], "x");
  assert.equal(allUp.canStart, false);
  assert.equal(allUp.canStop, true);

  const nothing = projectSummary([{ id: "a", project: "x", up: false, blocked: "no launcher" }], "x");
  assert.equal(nothing.hasButton, false, "no button when nothing can start");
  assert.equal(nothing.blockedReason, "no launcher");
  assert.equal(projectSummary([], "x").hasButton, false);
});

test("freshness says when a project was last touched", async () => {
  const { summarise, openByProject, NEGLECTED_DAYS } = await import("./freshness.mjs");
  const now = Date.UTC(2026, 10, 2, 12, 0, 0);
  const day = 24 * 60 * 60 * 1000;

  const fresh = summarise({ id: "uta", now, lastCommit: { at: (now - 2 * day) / 1000, sha: "abc", subject: "x" }, open: 3 });
  assert.match(fresh.line, /last touched 2 days ago/);
  assert.match(fresh.line, /3 open/);
  assert.equal(fresh.neglected, false);

  const quiet = summarise({ id: "gemu", now, lastCommit: { at: (now - (NEGLECTED_DAYS + 1) * day) / 1000 }, open: 0 });
  assert.equal(quiet.neglected, true, "past the threshold");
  assert.match(quiet.line, /nothing open/);

  const never = summarise({ id: "new", now });
  assert.equal(never.days, null);
  assert.match(never.line, /no commits/);
  assert.equal(never.neglected, false, "unknown is not neglected");
});

test("open counts are per project, and retired is not open", async () => {
  const { openByProject } = await import("./freshness.mjs");
  const counts = openByProject([
    '{"t":"add","id":1,"title":"a","project":"uta"}',
    '{"t":"add","id":2,"title":"b","project":"uta"}',
    '{"t":"add","id":3,"title":"c","project":"gemu"}',
    '{"t":"set","id":2,"ts":"x","fields":{"status":"retired"}}',
    '{"t":"set","id":3,"ts":"x","fields":{"status":"done"}}',
  ].join(String.fromCharCode(10)));
  assert.equal(counts.uta, 1);
  assert.equal(counts.gemu, undefined, "done is not open");
});
