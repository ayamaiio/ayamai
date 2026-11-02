// Serving a web build: the game's own files, and nothing else.
//
// A build asks for .wasm, .data, .pck, .unityweb, fonts, audio, and sometimes
// SharedArrayBuffer, which the browser withholds unless the page is isolated.
// Those are the two things that make a served build actually run.
import { createReadStream, statSync } from "node:fs";
import path from "node:path";

import { resolveInside } from "./catalog.mjs";

export const MIME = new Map(Object.entries({
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".unityweb": "application/octet-stream",
  ".pck": "application/octet-stream",
  ".br": "application/octet-stream",
  ".gz": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".swf": "application/x-shockwave-flash",
  ".txt": "text/plain; charset=utf-8",
}));

/** Pure: the headers every game response carries. */
export function gameHeaders(file, size) {
  return {
    "content-type": MIME.get(path.extname(file).toLowerCase()) ?? "application/octet-stream",
    "content-length": String(size),
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
    // a build that needs threads needs a cross-origin isolated page
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
    "cross-origin-resource-policy": "same-origin",
  };
}

/** The whole response for one request, or null when the file is not inside the game. */
export function serveGameFile(req, res, root, requestPath) {
  const file = resolveInside(root, requestPath);
  if (!file) return false;

  let size = 0;
  try { size = statSync(file).size; } catch { return false; }
  const headers = gameHeaders(file, size);
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));

  if (!range) {
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
    return true;
  }

  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (!(start < size && end >= start)) {
    res.writeHead(416, { "content-range": "bytes */" + size });
    res.end();
    return true;
  }
  res.writeHead(206, {
    ...headers,
    "content-length": String(end - start + 1),
    "content-range": "bytes " + start + "-" + end + "/" + size,
  });
  createReadStream(file, { start, end }).pipe(res);
  return true;
}
