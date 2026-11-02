// The design kit, served once.
//
// Pages reference /ui/... through the door; nothing is duplicated per project.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Only these paths exist. Anything else is a 404, traversal included. */
export const UI_ASSETS = new Map([
  ["/ui/ui.css", "text/css; charset=utf-8"],
  ["/ui/tokens.css", "text/css; charset=utf-8"],
  ["/ui/brand.css", "text/css; charset=utf-8"],
  ["/ui/brand/mark.png", "image/png"],
  ["/ui/brand/favicon.svg", "image/svg+xml"],
  ["/ui/brand/favicon.ico", "image/x-icon"],
  ["/ui/brand/favicon-32x32.png", "image/png"],
  ["/ui/brand/apple-touch-icon.png", "image/png"],
  // The source art the brand came from: not used by a page, used by the storybook
  // and by anyone extracting assets.
  ["/ui/brand/source/wordmark.png", "image/png"],
  ["/ui/brand/source/approved-lockup.png", "image/png"],
]);

export function assetMeta(pathname, repo) {
  const type = UI_ASSETS.get(pathname);
  if (!type) return null;
  const relative = pathname.replace(/^\/ui\//, "");
  const file = path.join(repo, "ui", relative);
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return null;
    return { file, type, mtime: stat.mtimeMs };
  } catch {
    return null;
  }
}

export function serveUiAsset(req, res, pathname, repo) {
  const meta = assetMeta(pathname, repo);
  if (!meta) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("not found");
    return;
  }
  const body = readFileSync(meta.file);
  // CSS changes constantly while the design is being worked on; the logo does not.
  const immutable = !pathname.endsWith(".css");
  res.writeHead(200, {
    "content-type": meta.type,
    "content-length": body.length,
    "cache-control": immutable ? "public, max-age=604800" : "no-store",
    etag: `"${Math.round(meta.mtime).toString(36)}"`,
  });
  if (req.method === "HEAD") { res.end(); return; }
  res.end(body);
}
