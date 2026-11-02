#!/usr/bin/env node
// Deploy site/ to Cloudflare Pages.
//
//   node scripts/deploy-site.mjs --dry-run   # files, version, target — no network
//   node scripts/deploy-site.mjs             # upload
//
// Credentials live in .local/cloudflare.env (0600, gitignored):
//   CLOUDFLARE_API_TOKEN=...   (Account → Cloudflare Pages → Edit)
//   CLOUDFLARE_ACCOUNT_ID=...
//
// The upload itself is wrangler's job: Pages direct upload needs BLAKE3 content
// hashes, and Node has no BLAKE3, so reimplementing it would mean a dependency
// anyway. `npx wrangler` is fetched on demand and nothing is added to the repo.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
const SITE = path.join(REPO, "site");
const PROJECT = process.env.CLOUDFLARE_PAGES_PROJECT ?? "ayamai-io";
const ENV_FILE = path.join(REPO, ".local/cloudflare.env");

/** The brand files the page needs, copied from the one canonical place. */
export const BRAND_FILES = [
  ["ui/brand/mark.png", "brand/mark.png"],
  ["ui/brand/favicon.svg", "brand/favicon.svg"],
  ["ui/brand/favicon-32x32.png", "brand/favicon-32x32.png"],
  ["ui/brand/apple-touch-icon.png", "brand/apple-touch-icon.png"],
];

/** Every file that ships, relative to site/. Hidden files are not accidentally published. */
export function filesIn(dir = SITE, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name.endsWith(".test.mjs")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesIn(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return out.sort();
}

/** The platform version, so the page cannot claim a release that does not exist. */
export function version(repo = REPO) {
  const catalog = JSON.parse(readFileSync(path.join(repo, "catalog.json"), "utf8"));
  return (catalog.entries ?? []).find((entry) => entry.kind === "platform")?.version ?? "0.0.0";
}

/** Fill the footer placeholder exactly once. */
export function stamp(html, value) {
  return html.replace("{{VERSION}}", value);
}

function credentials() {
  const file = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const fromFile = Object.fromEntries(file.split("\n").filter((line) => line.includes("=")).map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, "")];
  }));
  return {
    token: process.env.CLOUDFLARE_API_TOKEN ?? fromFile.CLOUDFLARE_API_TOKEN ?? "",
    account: process.env.CLOUDFLARE_ACCOUNT_ID ?? fromFile.CLOUDFLARE_ACCOUNT_ID ?? "",
  };
}

async function cf(pathname, init, token) {
  const answer = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await answer.json();
  if (!body.success) {
    const reason = (body.errors ?? []).map((error) => error.message).join("; ") || `HTTP ${answer.status}`;
    throw new Error(reason);
  }
  return body.result;
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const files = filesIn();
  const value = version();
  const html = readFileSync(path.join(SITE, "index.html"), "utf8");
  if (!html.includes("{{VERSION}}")) throw new Error("the footer placeholder is gone; the page would ship without a version");
  if ((html.match(/\{\{VERSION\}\}/g) ?? []).length !== 1) throw new Error("the version placeholder must appear exactly once");

  console.log(`site      ${files.length} file(s)`);
  for (const file of files) console.log(`  ${file}`);
  console.log(`brand     4 file(s) from ui/brand/`);
  console.log(`version   ${value}`);
  console.log(`project   ${PROJECT}  →  https://${PROJECT}.pages.dev`);

  if (dry) { console.log("\ndry run — nothing uploaded"); return; }

  const { token, account } = credentials();
  if (!token || !account) {
    throw new Error("no credentials — put CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .local/cloudflare.env (token needs Account → Cloudflare Pages → Edit)");
  }

  // The upload is done from a temporary copy with the version stamped in.
  for (const [from, to] of BRAND_FILES) {
    if (!existsSync(path.join(REPO, from))) throw new Error(`missing ${from} — the page would ship a broken logo`);
  }

  const staging = path.join(REPO, ".local/site-build");
  execFileSync("rm", ["-rf", staging]);
  execFileSync("mkdir", ["-p", staging]);
  for (const [from, to] of BRAND_FILES) {
    execFileSync("mkdir", ["-p", path.dirname(path.join(staging, to))]);
    execFileSync("cp", [path.join(REPO, from), path.join(staging, to)]);
  }
  for (const file of files) {
    const to = path.join(staging, file);
    execFileSync("mkdir", ["-p", path.dirname(to)]);
    if (file === "index.html") execFileSync("sh", ["-c", `cat > "${to}"`], { input: stamp(html, value) });
    else execFileSync("cp", [path.join(SITE, file), to]);
  }

  const projects = await cf(`/accounts/${account}/pages/projects`, {}, token);
  if (!projects.some((project) => project.name === PROJECT)) {
    console.log(`creating project ${PROJECT}`);
    await cf(`/accounts/${account}/pages/projects`, { method: "POST", body: JSON.stringify({ name: PROJECT, production_branch: "main" }) }, token);
  }

  const output = execFileSync("npx", ["--yes", "wrangler@4", "pages", "deploy", staging, "--project-name", PROJECT, "--branch", "main", "--commit-dirty=true"], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
  });
  const url = /https:\/\/[a-z0-9-]+\.pages\.dev/.exec(output)?.[0] ?? `https://${PROJECT}.pages.dev`;
  console.log(`\ndeployed → ${url}`);
  console.log(`latest   → https://${PROJECT}.pages.dev`);
}

// Importing this file (tests do) must not deploy anything.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`deploy-site: ${String(error.message ?? error).split("\n")[0]}`);
    process.exit(1);
  });
}
