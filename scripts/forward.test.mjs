// The forwarder, exercised for real on an unprivileged port.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";

const listen = 18765;
const target = 18766;

function serving(port, answer) {
  const server = net.createServer((socket) => socket.end(answer));
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

function ask(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let data = "";
    socket.on("data", (chunk) => { data += chunk; });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

test("forward.mjs carries a connection to the target port", async () => {
  const upstream = await serving(target, "hello from the door");
  const child = spawn(process.execPath, ["scripts/forward.mjs", String(listen), String(target)], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 700));
  try {
    assert.equal(await ask(listen), "hello from the door");
  } finally {
    child.kill("SIGTERM");
    upstream.close();
  }
});

test("forward.mjs refuses a nonsense port instead of listening", async () => {
  const child = spawn(process.execPath, ["scripts/forward.mjs", "0", String(target)], { stdio: "ignore" });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 2);
});
