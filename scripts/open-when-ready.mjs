// Open ayamai.local once the door is actually answering.
//
// Startup items race the services they depend on: the browser arrives, the door
// is still binding, and you get a connection error for a page that is two
// seconds away. This waits, then opens. If it never comes up it opens anyway, so
// the failure is visible instead of silent.
//
//   node scripts/open-when-ready.mjs [--timeout 60] [--url http://ayamai.local/]
import { execFile } from "node:child_process";
import http from "node:http";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1]) : fallback;
};

const url = option("--url", "http://ayamai.local/");
const timeoutSeconds = Number(option("--timeout", "60"));

function answering() {
  return new Promise((resolve) => {
    const req = http.get(`${url.replace(/\/$/, "")}/health.json`, { timeout: 1500 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 0) === 200);
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

function opener() {
  if (process.platform === "darwin") return ["open", [url]];
  if (process.platform === "win32") return ["cmd.exe", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

async function main() {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (await answering()) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const ready = await answering();
  const [command, commandArgs] = opener();
  execFile(command, commandArgs, { timeout: 15_000 }, () => {});
  console.log(`open-when-ready: ${ready ? "door answered" : "door did not answer, opening anyway"} — ${url}`);
}

main();
