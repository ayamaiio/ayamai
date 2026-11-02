// The hosts-line rules, tested as strings so nothing needs root.
import test from "node:test";
import assert from "node:assert/strict";

import {
  MARKER, DEFAULT_HOSTNAME, hostFilePath, hasEntry, addEntry, removeEntry, plan,
} from "./hostname.mjs";

const sample = [
  "127.0.0.1\tlocalhost",
  "::1\tlocalhost",
  "",
].join("\r\n");

test("the hosts path is the real one, per platform", () => {
  assert.equal(hostFilePath("linux"), "/etc/hosts");
  assert.equal(hostFilePath("darwin"), "/etc/hosts");
  assert.match(hostFilePath("win32", { SystemRoot: "D:\\Windows" }), /D:\\Windows.*drivers.*etc.*hosts$/);
});

test("an entry is detected however it was written", () => {
  assert.equal(hasEntry(sample, DEFAULT_HOSTNAME), false);
  assert.equal(hasEntry(`127.0.0.1  ayamai.local ${MARKER}\n`, DEFAULT_HOSTNAME), true);
  assert.equal(hasEntry(`127.0.0.1\tayamai.local\t${MARKER}\r\n`, DEFAULT_HOSTNAME), true);
  assert.equal(hasEntry("127.0.0.1 other.local # ayamai\n", DEFAULT_HOSTNAME), false);
});

test("adding keeps the file's newline style and is idempotent", () => {
  const once = addEntry(sample, DEFAULT_HOSTNAME);
  assert.ok(once.includes("\r\n"), "CRLF preserved");
  assert.ok(once.includes(`127.0.0.1 ${DEFAULT_HOSTNAME} ${MARKER}`));
  assert.equal(addEntry(once, DEFAULT_HOSTNAME), once);
});

test("removing takes our line and leaves the others", () => {
  const withEntry = addEntry(sample, DEFAULT_HOSTNAME);
  const cleaned = removeEntry(withEntry, DEFAULT_HOSTNAME);
  assert.ok(!cleaned.includes(DEFAULT_HOSTNAME));
  assert.ok(cleaned.includes("127.0.0.1\tlocalhost"));
});

test("the elevated step is printable without running anything", () => {
  const unix = plan("linux", DEFAULT_HOSTNAME, "/etc/hosts");
  assert.equal(unix.elevated[0], "sudo");
  assert.ok(unix.display.includes("/etc/hosts"));

  const windows = plan("win32", DEFAULT_HOSTNAME, "C:\\Windows\\System32\\drivers\\etc\\hosts");
  assert.equal(windows.elevated[0], "powershell.exe");
  assert.ok(windows.elevated[1].join(" ").includes("RunAs"));
});
