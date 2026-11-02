#!/usr/bin/env node
// The pre-push hook: a shim around one pure rule.
//
//   node scripts/hook-pre-push.mjs <remote-name> <remote-url>
//
// Reads the lines git feeds a pre-push hook on stdin (ignored) and refuses a push
// to the cold-storage remote unless `ayamai publish` set AYAMAI_PUBLISH=1.
import { allowPush } from "../packages/core/publish.mjs";

const [, , , remoteUrl = ""] = process.argv;
const verdict = allowPush({ url: remoteUrl, env: process.env });
if (!verdict.ok) {
  console.error(verdict.error);
  process.exit(1);
}
process.exit(0);
