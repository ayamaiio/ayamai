#!/usr/bin/env node
// Preview the landing page exactly as it will deploy, but locally.
//
//   node scripts/site-preview.mjs        → http://localhost:4640/
//
// It stamps the release version into the footer, serves the brand files from
// ui/brand/ (the single source), and sets no-store so a refresh always shows the
// current file. Nothing is uploaded; `scripts/deploy-site.mjs` does that.
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { filesIn, version } from "./deploy-site.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const SITE = path.join(REPO, "site");
const BRAND = path.join(REPO, "ui/brand");
const PORT = Number(process.env.SITE_PORT ?? 4640);
const HOST = process.env.SITE_HOST ?? "0.0.0.0";

const TYPES = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
};

const typeOf = (file) => TYPES[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";

/** Pure: the page without its opening. A preview convenience — the deploy never
 *  strips it, and the page itself keeps no JavaScript. */
/** Pure: move the whole reveal to the first frame, so it can be watched quickly. */
export function withIntroEnd(html, value = "0s") {
  return html.replace("</style>", `:root{--intro-end:${value}}</style>`);
}

/** Pure: the finished page, nothing moving. */
export function freeze(html) {
  return html.replace("</style>", "*,*::before,*::after{animation:none!important;transition:none!important}" +
    ".piece,.title .lf{opacity:1!important;clip-path:none!important;transform:none!important}" +
    ".slash.piece{width:44px!important}</style>");
}

export function stripIntro(html) {
  return html
    .replace(/<section class="intro">[\s\S]*?<\/section>\n/, "")
    .replace(/<div class="intro-brand">[\s\S]*?<\/div>\n<\/div>\n/, "")
    // the staged fades would otherwise still hold the page back
    .replace("</style>", "header.top .mark,.hero,.interested,footer.wrap{opacity:1!important;animation:none!important;transform:none!important}</style>");
}

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "/index.html") pathname = "/index.html";

  try {
    if (pathname === "/index.html") {
      let html = readFileSync(path.join(SITE, "index.html"), "utf8");
      // ?intro=0 skips the opening and plays the reveal from the first frame;
      // ?static=1 shows the finished page.
      const intro = url.searchParams.get("intro") ?? "";
      if (["0", "off", "none"].includes(intro)) html = withIntroEnd(stripIntro(html));
      if (["1", "on"].includes(url.searchParams.get("static") ?? "")) html = freeze(stripIntro(html));
      // the other difference from the file: the version the deploy would stamp
      send(res, 200, html.replace("{{VERSION}}", version()), TYPES.html);
      return;
    }
    // the page asks for /brand/* — the files live in ui/brand
    if (pathname.startsWith("/brand/")) {
      const file = path.join(BRAND, pathname.slice("/brand/".length));
      if (!file.startsWith(BRAND) || !statSync(file).isFile()) throw new Error("not found");
      send(res, 200, readFileSync(file), typeOf(file));
      return;
    }
    if (pathname.startsWith("/img/")) {
      const file = path.join(SITE, pathname);
      if (!file.startsWith(SITE) || !statSync(file).isFile()) throw new Error("not found");
      send(res, 200, readFileSync(file), typeOf(file));
      return;
    }
  } catch {
    send(res, 404, "not found", "text/plain; charset=utf-8");
    return;
  }
  send(res, 404, "not found", "text/plain; charset=utf-8");
});

/** Importing this file (a test does) must not bind a port. */
export function start() {
  server.listen(PORT, HOST, () => {
    const count = filesIn().length;
    console.log(`landing page · ${count} file(s) · v${version()}`);
    console.log(`http://localhost:${PORT}/`);
    // The phone and any other machine on the LAN use the same URL through the name.
    console.log(`http://ayamai.local:${PORT}/`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) start();
