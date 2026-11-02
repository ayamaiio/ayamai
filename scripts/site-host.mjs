#!/usr/bin/env node
// Which host the page claims to live on.
//
//   node scripts/site-host.mjs            # what it says now
//   node scripts/site-host.mjs apex       # ayamai.io
//   node scripts/site-host.mjs www        # www.ayamai.io
//
// The canonical host is a promise: the URL a crawler is told to trust. Flipping
// it before that host actually serves this page is worse than not having one, so
// the deploy refuses when the canonical does not answer with this page.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const SITE = path.join(REPO, "site");
export const HOSTS = { apex: "https://ayamai.io", www: "https://www.ayamai.io" };

/** Pure: every place the canonical host appears, moved to `host`. */
export function rewriteHost(text, host) {
  return String(text)
    .replace(/https:\/\/(?:www\.)?ayamai\.io(?=[/"<\s]|$)/g, host)
    .replace(/https:\/\/ayamai-io\.pages\.dev/g, host);
}

export function currentHost(files) {
  const html = files["index.html"] ?? "";
  const match = html.match(/<link rel="canonical" href="(https:\/\/[^"]+)"/);
  return match ? match[1].replace(/\/$/, "") : null;
}

const FILES = ["index.html", "robots.txt", "sitemap.xml"];

function main() {
  const want = process.argv[2];
  const files = Object.fromEntries(FILES.map((name) => [name, readFileSync(path.join(SITE, name), "utf8")]));
  const have = currentHost(files);

  if (!want || want === "--print") {
    console.log(`canonical  ${have ?? "(none — the page does not say)"}`);
    return 0;
  }
  if (!HOSTS[want]) {
    console.error(`unknown host "${want}" — use apex or www`);
    return 1;
  }
  if (have === HOSTS[want]) {
    console.log(`canonical  already ${HOSTS[want]}`);
    return 0;
  }

  for (const name of FILES) {
    const next = rewriteHost(files[name], HOSTS[want]);
    if (next !== files[name]) {
      writeFileSync(path.join(SITE, name), next);
      console.log(`  updated site/${name}`);
    }
  }
  console.log(`canonical  ${HOSTS[want]}`);
  console.log("");
  console.log("deploy it with:  node scripts/deploy-site.mjs");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) process.exit(main());
