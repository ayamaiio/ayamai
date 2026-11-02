#!/usr/bin/env node
// hisho over stdio — the entry an MCP client spawns.
//
//   claude mcp add ayamai -- node /path/to/projects/hisho/stdio.mjs
import { createInterface } from "node:readline";

import { handle } from "./server.mjs";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Set();
let closed = false;

lines.on("line", async (line) => {
  if (!line.trim()) return;
  const work = (async () => {
  let message;
  try { message = JSON.parse(line); } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n");
    return;
  }
    const response = await handle(message);
    if (response) process.stdout.write(JSON.stringify(response) + "\n");
  })();
  pending.add(work);
  work.finally(() => { pending.delete(work); if (closed && pending.size === 0) process.exit(0); });
});

lines.on("close", () => {
  // A client that writes one line and closes still expects the answer.
  closed = true;
  if (pending.size === 0) process.exit(0);
});
