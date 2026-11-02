#!/usr/bin/env node
// play - the shelf. One page, derived from the manifests, every time it is asked.
//
//   node packages/play/index.mjs          -> http://127.0.0.1:4680/play/
//
// It owns no product list: a product appears because it declared a play face in
// its own project.json, and its dot is a probe of the service that serves it.
import { createServer } from "node:http";
import { connect } from "node:net";
import path from "node:path";

import { dataRoot, loadRegistry } from "../core/registry.mjs";
import { faceFor, hasPlayFace, readMode } from "../core/mode.mjs";
import { shelfRow, renderShelf } from "./page.mjs";

const PORT = Number(process.env.PLAY_PORT ?? 4680);
const BASE = (process.env.BASE_PREFIX ?? "").replace(/\/$/, "");
const REPO = process.env.AYAMAI_REPO ?? path.resolve(import.meta.dirname, "../..");

/** Pure: which service answers for a project, and on what port. */
export function serviceOf(project) {
  const service = (project.services ?? [])[0];
  return service ? { id: service.id, port: Number(service.port) } : null;
}

/** Pure: is that port answering? */
export function probe(port, timeout = 700) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.setTimeout(timeout);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
}

async function products() {
  const registry = loadRegistry(REPO);
  const listed = registry.projects.filter(hasPlayFace);
  return Promise.all(listed.map(async (project) => {
    const service = serviceOf(project);
    return shelfRow({ ...project, href: faceFor(project, "play") }, { up: service ? await probe(service.port) : null });
  }));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/healthz") { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true}'); return; }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "" || url.pathname === "/play" || url.pathname === "/play/")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(renderShelf({ products: await products(), mode: readMode(dataRoot()).mode }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("the shelf fell over: " + String(error.message ?? error));
  }
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) server.listen(PORT, "127.0.0.1", () => console.log("play: http://127.0.0.1:" + PORT + "/play/"));
