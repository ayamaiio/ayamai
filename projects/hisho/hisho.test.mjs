import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { renderContext, BUDGET } from "./context.mjs";
import { checkPath, readText, writeText, run } from "./security.mjs";
import { handle } from "./server.mjs";
import { TOOLS } from "./tools.mjs";

test("the brief is stable, capped and under budget", () => {
  const parts = {
    identity: "x".repeat(9000),
    architecture: "a".repeat(9000),
    operations: "o".repeat(9000),
    rules: "r".repeat(9000),
    state: "s".repeat(9000),
    queue: "q".repeat(9000),
    task: "t".repeat(9000),
  };
  const first = renderContext(parts);
  assert.equal(first, renderContext(parts), "deterministic");
  assert.ok(first.length < BUDGET * 5, "stays under the budget");
  assert.ok(first.includes("# ayamai context"));
  assert.ok(first.split("\n").every((line) => line.length < 6000), "no single section explodes");
});

test("the path jail refuses escapes and secrets", () => {
  assert.equal(checkPath("../etc/passwd").ok, false);
  assert.equal(checkPath("/etc/passwd").ok, false);
  assert.equal(checkPath(".git/config").ok, false);
  assert.equal(checkPath(".env").ok, false);
  assert.equal(checkPath("deploy.pem").ok, false);
  assert.equal(checkPath("docs/PRODUCT.md").ok, true);
});

test("read and write round trip inside the repo", () => {
  const read = readText("docs/PRODUCT.md", { limit: 3 });
  assert.equal(read.ok, true);
  assert.equal(read.lines > 3, true);
  const temp = `hisho-test-${process.pid}.md`;
  const write = writeText(temp, "hello\n");
  assert.equal(write.ok, true);
  assert.equal(readText(temp).text, "hello\n");
  execFileSync("rm", ["-f", path.join(process.cwd(), temp)]);
});

test("only allowlisted commands run", async () => {
  const refused = await run("rm -rf /");
  assert.equal(refused.ok, false);
  assert.ok(refused.allowed.includes("verify"));
  const git = await run("git-status");
  assert.equal(git.ok, true);
});

test("the protocol speaks tools, resources and prompts", async () => {
  const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(init.result.serverInfo.name, "hisho");
  assert.equal(init.result.protocolVersion, "2024-11-05");

  const list = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(list.result.tools.length, TOOLS.length);
  assert.ok(list.result.tools.some((tool) => tool.name === "plan.next"));

  const resources = await handle({ jsonrpc: "2.0", id: 3, method: "resources/list" });
  assert.ok(resources.result.resources.some((resource) => resource.uri === "ayamai://docs/PRODUCT.md"));

  const read = await handle({ jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "ayamai://AGENTS.md" } });
  assert.ok(read.result.contents[0].text.length > 100);

  const missing = await handle({ jsonrpc: "2.0", id: 5, method: "nope" });
  assert.equal(missing.error.code, -32601);
});

test("a tool call is audited and a refusal is explained", async () => {
  const ok = await handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "project.list", arguments: {} } });
  assert.ok(ok.result.content[0].text.includes("hisho"));

  const refused = await handle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "file.read", arguments: { path: "/etc/passwd" } } });
  assert.ok(refused.result.content[0].text.startsWith("refused"));
  assert.equal(refused.result.isError, true);
});
