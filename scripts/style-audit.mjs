#!/usr/bin/env node
// Every control on every page, and whether the browser is drawing its own face.
//
//   node scripts/style-audit.mjs /gehirn/ /play/ /uta/ /seiri/ /gemu/
//
// The check is `appearance`: a button left at `auto` is white in WebKit and in
// forced colours, which no screenshot from a dark-mode desktop will reveal. It
// drives the same headless Chrome as scripts/shot.mjs, so there is one browser
// story in this repository, not two.
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const ORIGIN = process.env.AYAMAI_ORIGIN ?? "http://127.0.0.1:25222";
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ["/gehirn/", "/play/", "/uta/", "/seiri/", "/gemu/"];

/** The audit, as a string of browser code: it reports through document.title. */
export const AUDIT = `(function(){
  var controls = Array.prototype.slice.call(document.querySelectorAll("button, input[type=submit], input[type=button], select"));
  var bad = controls.filter(function (node) {
    var style = getComputedStyle(node);
    var appearance = style.appearance || style.webkitAppearance || "auto";
    var transparent = style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent";
    return appearance !== "none" && transparent;
  });
  document.title = JSON.stringify({
    total: controls.length,
    bad: bad.map(function (node) {
      return (node.id ? "#" + node.id : node.className ? "." + String(node.className).split(" ")[0] : node.tagName.toLowerCase()) + "|" + getComputedStyle(node).appearance;
    })
  });
})()`;

function audit(page) {
  const result = spawnSync(process.execPath, [path.join(REPO, "scripts/shot.mjs"), ORIGIN + page, "/tmp/style-audit.png", "--width", "1200", "--wait", "3000", "--eval", AUDIT], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 60_000,
  });
  const line = String(result.stdout ?? "").split("\n").reverse().find((entry) => entry.includes('"title"'));
  if (!line) return { page, error: "no answer from the browser", bad: [], total: 0 };
  try {
    const parsed = JSON.parse(line).title;
    return { page, ...JSON.parse(parsed) };
  } catch {
    return { page, error: "could not read the audit", bad: [], total: 0 };
  }
}

let offenders = 0;
for (const page of pages) {
  const result = audit(page);
  if (result.error) {
    console.log(`  ?? ${page.padEnd(12)} ${result.error}`);
    offenders += 1;
    continue;
  }
  const tone = result.bad.length ? "!!" : "ok";
  console.log(`  ${tone} ${page.padEnd(12)} ${result.total} control(s)${result.bad.length ? " - native face on " + result.bad.join(", ") : ""}`);
  offenders += result.bad.length;
}

console.log(offenders ? `\n${offenders} control(s) still wear the browser's face.` : "\nevery control wears the platform's face.");
process.exit(offenders ? 1 : 0);
