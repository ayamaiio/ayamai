import { Router, type IRouter } from "express";
import { createWriteStream } from "node:fs";
import { copyFile, readdir } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { db, mediaItemsTable as media } from "@workspace/db";
import { emitCapture, onCapture, recentCaptures } from "../lib/capture-events";
import { sql } from "drizzle-orm";

/**
 * Catch something while browsing.
 *
 * The extension sends a URL; this fetches it server-side (the machine has the
 * network, the browser tab may not have permission to read it), writes the file
 * into the vault and registers it as a media row tagged web-capture. From there
 * it is in the library and in the labeling queue like anything else.
 *
 * Local mode only. Guarded against obvious SSRF: no credentials, no query-based
 * auth trickery, no private hosts, http(s) only.
 */
const router: IRouter = Router();

const MAX_BYTES = 512 * 1024 * 1024;
const TYPES: Record<string, { ext: string; media: "image" | "video" }> = {
  "image/jpeg": { ext: "jpg", media: "image" },
  "image/png": { ext: "png", media: "image" },
  "image/gif": { ext: "gif", media: "image" },
  "image/webp": { ext: "webp", media: "image" },
  "image/avif": { ext: "avif", media: "image" },
  "video/mp4": { ext: "mp4", media: "video" },
  "video/webm": { ext: "webm", media: "video" },
  "video/quicktime": { ext: "mov", media: "video" },
};

function privateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (/^(0|10|127)\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === "::1" || host.startsWith("[::1]") || host.startsWith("169.254.")) return true;
  return false;
}

// The overlay runs inside a page, so a direct POST is a cross-origin request.
// Loopback only, and it writes nothing but a captured file.
router.options("/capture/url", (req, res) => {
  res.set({
    "Access-Control-Allow-Origin": req.header("origin") ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-ayamai-uid",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
  }).sendStatus(204);
});

router.post("/capture/url", async (req, res): Promise<void> => {
  res.set("Access-Control-Allow-Origin", req.header("origin") ?? "*");
  res.set("Access-Control-Allow-Private-Network", "true");
  const root = process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim();
  if (!root) { res.status(409).json({ error: "Capture needs the local library." }); return; }

  const userId = req.header("x-ayamai-uid") || process.env.AYAMAI_LOCAL_FOUNDER_ID || "local-dev-founder";
  const raw = String(req.body?.url ?? "");
  let url: URL;
  try { url = new URL(raw); } catch { res.status(400).json({ error: "Not a URL." }); return; }
  if (url.protocol !== "https:" && url.protocol !== "http:") { res.status(400).json({ error: "Only http(s)." }); return; }
  if (url.username || url.password || privateHost(url.hostname)) { res.status(400).json({ error: "Refusing that host." }); return; }

  const pageUrl = String(req.body?.pageUrl ?? "");
  const headers: Record<string, string> = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  if (/^https?:\/\//i.test(pageUrl)) headers.referer = pageUrl;
  const response = await fetch(url, {
    redirect: "follow",
    headers,
    signal: AbortSignal.timeout(120_000),
  }).catch((error) => {
    console.error("capture fetch failed:", (error as Error)?.message);
    return null;
  });
  if (!response || !response.ok || !response.body) {
    res.status(502).json({ error: `Fetch failed${response ? ` (${response.status})` : ""}.` });
    return;
  }

  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const type = TYPES[mime];
  if (!type) { res.status(415).json({ error: `Unsupported type: ${mime || "unknown"}.` }); return; }

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) { res.status(413).json({ error: "Larger than 512 MB." }); return; }

  const key = `media/${userId}/${randomUUID()}.${type.ext}`;
  const target = resolve(root, ...key.split("/"));
  if (!target.startsWith(`${resolve(root)}${sep}`)) { res.status(400).json({ error: "Bad path." }); return; }

  let written = 0;
  try {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await pipeline(
      Readable.fromWeb(response.body as never),
      async function* (source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          written += chunk.byteLength;
          if (written > MAX_BYTES) throw new Error("too large");
          yield chunk;
        }
      },
      createWriteStream(target, { mode: 0o600 }),
    );
  } catch {
    await rm(target, { force: true });
    res.status(413).json({ error: "Download failed or exceeded 512 MB." });
    return;
  }
  if (!written) { await rm(target, { force: true }); res.status(502).json({ error: "Empty response." }); return; }

  let name = url.pathname.split("/").filter(Boolean).pop() ?? `capture.${type.ext}`;
  try { name = decodeURIComponent(name); } catch { /* keep the raw segment */ }
  const title = String(req.body?.title ?? "").trim().slice(0, 200) || name.replace(/\.[^.]+$/, "");
  try {
    const [row] = await db.insert(media).values({
    userId,
    title,
    description: `Captured from ${url.href}\nPage: ${String(req.body?.pageUrl ?? "").slice(0, 500)}`,
    tags: ["web-capture"],
    originalName: name.slice(0, 200),
    objectKey: key,
    contentType: mime,
    mediaType: type.media,
    size: (await stat(target)).size,
    collection: "Inbox",
    }).returning({ id: media.id, title: media.title, mediaType: media.mediaType });
    res.set("Cache-Control", "private, no-store");
    res.json({ ok: true, item: row, bytes: written });
  } catch (error) {
    await rm(target, { force: true });
    console.error("capture insert failed:", (error as Error)?.message);
    res.status(500).json({ error: (error as Error)?.message ?? "insert failed" });
  }
});

/**
 * Pixels from the page itself. The browser already decoded the image, so this
 * needs no request to anyone's server: the extension screenshots the element
 * through the debugger and posts the bytes here.
 */
router.options("/capture/bytes", (req, res) => {
  res.set({
    "Access-Control-Allow-Origin": req.header("origin") ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Private-Network": "true",
  }).sendStatus(204);
});

router.post("/capture/bytes", async (req, res): Promise<void> => {
  try {
  const root = process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim();
  if (!root) { res.status(409).json({ error: "Capture needs the local library." }); return; }
  res.set("Access-Control-Allow-Origin", req.header("origin") ?? "*");
  res.set("Access-Control-Allow-Private-Network", "true");

  const userId = req.header("x-ayamai-uid") || process.env.AYAMAI_LOCAL_FOUNDER_ID || "local-dev-founder";
  const raw = String(req.body?.data ?? "").replace(/^data:[^;]+;base64,/, "");
  if (!raw || raw.length > 40 * 1024 * 1024) { res.status(413).json({ error: "Missing or oversized image." }); return; }

  let body: Buffer;
  try { body = Buffer.from(raw, "base64"); } catch { res.status(400).json({ error: "Bad base64." }); return; }
  if (body.length < 64) { res.status(400).json({ error: "Empty image." }); return; }

  const isPng = body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpg = body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (!isPng && !isJpg) { res.status(415).json({ error: "Only PNG or JPEG bytes." }); return; }
  const mime = isPng ? "image/png" : "image/jpeg";
  const ext = isPng ? "png" : "jpg";

  const key = `media/${userId}/${randomUUID()}.${ext}`;
  const target = resolve(root, ...key.split("/"));
  if (!target.startsWith(`${resolve(root)}${sep}`)) { res.status(400).json({ error: "Bad path." }); return; }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, body, { mode: 0o600 });

  const title = String(req.body?.title ?? "").trim().slice(0, 200) || `capture ${new Date().toISOString().slice(0, 19)}`;
  const artist = String(req.body?.artist ?? "").trim().slice(0, 120);
  const groupId = String(req.body?.groupId ?? "").slice(0, 60);
  const index = Number(req.body?.index ?? 0);
  const count = Number(req.body?.count ?? 1);
  const extraTags = Array.isArray(req.body?.tags)
    ? req.body.tags.map((t: unknown) => String(t).trim().toLowerCase().replace(/^#/, "").slice(0, 40)).filter(Boolean).slice(0, 30)
    : [];
  try {
    const [row] = await db.insert(media).values({
      userId,
      title,
      description: [
        "Captured from screen",
        artist ? `Artist: ${artist}` : "",
        groupId ? `Post: ${groupId}${count > 1 ? ` (${index + 1}/${count})` : ""}` : "",
        `Page: ${String(req.body?.pageUrl ?? "").slice(0, 500)}`,
        `Source: ${String(req.body?.url ?? "").slice(0, 500)}`,
      ].filter(Boolean).join("\n"),
      tags: [...new Set(["web-capture", "screenshot", ...(artist ? [artist.toLowerCase().replace(/\s+/g, "-")] : []), ...extraTags])],
      originalName: `${title.slice(0, 80)}.${ext}`,
      objectKey: key,
      contentType: mime,
      mediaType: "image",
      size: body.length,
      collection: "Inbox",
    }).returning({ id: media.id, title: media.title });
    res.json({ ok: true, item: row, bytes: body.length });
  } catch (error) {
    await rm(target, { force: true }).catch(() => {});
    res.status(500).json({ error: (error as Error)?.message ?? "insert failed" });
  }
  } catch (error) {
    console.error("capture/bytes failed:", (error as Error)?.message);
    if (!res.headersSent) res.status(500).json({ error: (error as Error)?.message ?? "capture failed" });
  }
});

/**
 * The browser downloaded the originals (it has the cookies, and a header rule
 * gives pixiv the Referer it wants). This picks them up off disk, writes them
 * into the vault and stamps the post metadata on every row.
 */
const INBOX = process.env.AYAMAI_CAPTURE_INBOX?.trim() || "/mnt/c/Users/admin/Downloads/ayamai-inbox";

router.options("/capture/import", (req, res) => {
  res.set({
    "Access-Control-Allow-Origin": req.header("origin") ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Private-Network": "true",
  }).sendStatus(204);
});

router.post("/capture/import", async (req, res): Promise<void> => {
  res.set("Access-Control-Allow-Origin", req.header("origin") ?? "*");
  res.set("Access-Control-Allow-Private-Network", "true");
  const root = process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim();
  const folder = String(req.body?.folder ?? "");
  if (!root) { res.status(409).json({ error: "Capture needs the local library." }); return; }
  if (!/^[a-z0-9-]{1,40}$/i.test(folder)) { res.status(400).json({ error: "Bad folder." }); return; }

  const dir = join(INBOX, folder);
  const files = await readdir(dir).catch(() => []);
  if (!files.length) { res.json({ ok: true, imported: 0 }); return; }

  const userId = req.header("x-ayamai-uid") || process.env.AYAMAI_LOCAL_FOUNDER_ID || "local-dev-founder";
  const title = String(req.body?.title ?? "").trim().slice(0, 160) || "captured post";
  const artist = String(req.body?.artist ?? "").trim().slice(0, 120);
  const pageUrl = String(req.body?.pageUrl ?? "").slice(0, 500);
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags.map((t: unknown) => String(t).trim().toLowerCase().replace(/^#/, "").slice(0, 40)).filter(Boolean).slice(0, 30)
    : [];

  // One post, one row: first file is the cover, the rest are attachments.
  const written: { objectKey: string; originalName: string; contentType: string; size: number }[] = [];
  for (const name of files.sort()) {
    const source = join(dir, name);
    const info = await stat(source).catch(() => null);
    if (!info?.isFile() || info.size === 0 || info.size > MAX_BYTES) continue;
    const ext = (name.split(".").pop() ?? "jpg").toLowerCase();
    const mime = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" } as Record<string, string>)[ext];
    if (!mime) continue;
    const key = `media/${userId}/${randomUUID()}.${ext}`;
    const target = resolve(root, ...key.split("/"));
    if (!target.startsWith(`${resolve(root)}${sep}`)) continue;
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(source, target);
    written.push({ objectKey: key, originalName: name.slice(0, 200), contentType: mime, size: info.size });
  }

  let imported = 0;
  if (written.length) {
    const [cover, ...rest] = written;
    await db.insert(media).values({
      userId,
      title: written.length > 1 ? title : title,
      description: ["Captured from the web", artist ? `Artist: ${artist}` : "", `Page: ${pageUrl}`].filter(Boolean).join("\n"),
      tags: [...new Set(["web-capture", ...(artist ? [artist.toLowerCase().replace(/\s+/g, "-")] : []), ...tags])],
      originalName: cover.originalName,
      objectKey: cover.objectKey,
      contentType: cover.contentType,
      mediaType: cover.contentType.startsWith("video/") ? "video" : "image",
      size: written.reduce((total, file) => total + file.size, 0),
      collection: "Inbox",
      galleryImages: rest.map((file) => ({
        id: randomUUID(),
        objectKey: file.objectKey,
        originalName: file.originalName,
        contentType: file.contentType,
        size: file.size,
      })),
    });
    imported = written.length;
  }
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  res.json({ ok: true, imported });
});

/** The extension's eyes. Every attempt lands here, so the box can see what the
 *  browser is doing without anyone reading a console. */
router.post("/capture/log", async (req, res): Promise<void> => {
  res.set("Access-Control-Allow-Origin", req.header("origin") ?? "*");
  res.set("Access-Control-Allow-Private-Network", "true");
  const stage = String(req.body?.stage ?? "").slice(0, 40);
  const message = String(req.body?.message ?? "").slice(0, 300);
  const detail = req.body?.detail === undefined ? "" : JSON.stringify(req.body.detail).slice(0, 400);
  console.log(`[capture] ${stage} ${message} ${detail}`);
  res.json({ ok: true });
});

router.options("/capture/log", (req, res) => {
  res.set({
    "Access-Control-Allow-Origin": req.header("origin") ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Private-Network": "true",
  }).sendStatus(204);
});

/**
 * A post, handed over by the page itself.
 *
 * The bookmarklet runs on pixiv.net, so its fetch of /ajax/illust/<id> carries
 * the session and returns the original URLs. Images it could read come as
 * base64; the rest are fetched here with the referer pixiv demands.
 */
router.options("/capture/from-json", (req, res) => {
  res.set({
    "Access-Control-Allow-Origin": req.header("origin") ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Private-Network": "true",
  }).sendStatus(204);
});

router.post("/capture/from-json", async (req, res): Promise<void> => {
  res.set("Access-Control-Allow-Origin", req.header("origin") ?? "*");
  res.set("Access-Control-Allow-Private-Network", "true");
  if (typeof req.body?.payload === "string") {
    try { req.body = JSON.parse(req.body.payload); } catch { /* leave as-is */ }
  }
  const root = process.env.AYAMAI_LOCAL_MEDIA_ROOT?.trim();
  if (!root) { res.status(409).json({ error: "Capture needs the local library." }); return; }
  const userId = req.header("x-ayamai-uid") || process.env.AYAMAI_LOCAL_FOUNDER_ID || "local-dev-founder";
  const title = String(req.body?.title ?? "").trim().slice(0, 160) || "captured post";
  const artist = String(req.body?.artist ?? "").trim().slice(0, 120);
  const pageUrl = String(req.body?.pageUrl ?? "").slice(0, 500);
  const tags = Array.isArray(req.body?.tags) ? req.body.tags.map((t: unknown) => String(t).trim().toLowerCase().replace(/^#/, "").slice(0, 40)).filter(Boolean).slice(0, 30) : [];
  const images = Array.isArray(req.body?.images) ? req.body.images.slice(0, 60) : [];

  const job = randomUUID();
  const failures: string[] = [];
  emitCapture({ job, stage: "start", title, total: images.length });
  const written: { objectKey: string; originalName: string; contentType: string; size: number; mime: string }[] = [];

  for (const [index, entry] of images.entries()) {
    const url = String(entry?.url ?? "");
    let body: Buffer | null = null;
    let mime = "image/jpeg";
    if (typeof entry?.data === "string" && entry.data.length > 64) {
      body = Buffer.from(entry.data.replace(/^data:[^;]+;base64,/, ""), "base64");
      if (entry.type) mime = String(entry.type);
    } else if (/^https?:\/\//i.test(url)) {
      const got = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          referer: "https://www.pixiv.net/",
        },
        signal: AbortSignal.timeout(60_000),
      }).catch(() => null);
      if (got?.ok) {
        body = Buffer.from(await got.arrayBuffer());
        mime = got.headers.get("content-type")?.split(";")[0]?.trim() || mime;
      } else {
        failures.push(`${got?.status ?? "err"} ${url.slice(-30)}`);
      }
    }
    if (!body || body.length < 64) continue;
    emitCapture({ job, stage: "page", title, index: index + 1, total: images.length });
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg";
    const key = `media/${userId}/${randomUUID()}.${ext}`;
    const target = resolve(root, ...key.split("/"));
    if (!target.startsWith(`${resolve(root)}${sep}`)) continue;
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, body, { mode: 0o600 });
    written.push({ objectKey: key, originalName: `${title.slice(0, 60)}-${String(index + 1).padStart(2, "0")}.${ext}`, contentType: mime, size: body.length, mime });
  }

  emitCapture({ job, stage: "done", title, imported: written.length, total: images.length, failed: failures.length });

  // One post, one row. Pages hang off it as attachments; the first page is the cover.
  let imported = 0;
  if (written.length) {
    const [cover, ...rest] = written;
    await db.insert(media).values({
      userId,
      title,
      description: ["Captured from the web", artist ? `Artist: ${artist}` : "", `Page: ${pageUrl}`].filter(Boolean).join("\n"),
      tags: [...new Set(["web-capture", "pixiv-post", ...(artist ? [artist.toLowerCase().replace(/\s+/g, "-")] : []), ...tags])],
      originalName: cover.originalName,
      objectKey: cover.objectKey,
      contentType: cover.contentType,
      mediaType: "image",
      size: written.reduce((total, file) => total + file.size, 0),
      collection: "Inbox",
      galleryImages: rest.map((file) => ({
        id: randomUUID(),
        objectKey: file.objectKey,
        originalName: file.originalName,
        contentType: file.contentType,
        size: file.size,
      })),
    });
    imported = written.length;
  }

  if (String(req.headers.accept ?? "").includes("text/html")) {
    const tagLine = tags.slice(0, 8).map((tag: string) => `#${tag}`).join("  ");
    res.type("html").send(`<!doctype html><meta charset="utf-8"><title>${title.slice(0, 60)}</title>
<style>
  html,body { margin:0; height:100%; }
  body { background:#0b0d14; color:#e6ecff; display:grid; place-items:center;
         font:14px/1.6 ui-sans-serif,system-ui,sans-serif; }
  .card { width:min(520px,86vw); padding:36px; border:1px solid #202A5A; border-radius:18px;
          background:linear-gradient(180deg,rgba(32,42,90,.35),rgba(11,13,20,.6)); }
  .kicker { font:600 9px/1 ui-monospace,monospace; letter-spacing:.32em; text-transform:uppercase; color:#91b7b3; }
  h1 { font-family:"Cormorant Garamond",Georgia,serif; font-weight:400; font-size:26px; line-height:1.2; margin:14px 0 6px; }
  .artist { color:#a3adc3; font-size:13px; }
  .count { font:600 40px/1 ui-monospace,monospace; color:#A9B7E8; margin:24px 0 4px; }
  .sub { font:500 10px/1 ui-monospace,monospace; letter-spacing:.18em; text-transform:uppercase; color:rgba(230,236,255,.45); }
  .tags { margin-top:22px; font:400 11px/1.8 ui-monospace,monospace; color:#a3adc3; }
  a { display:inline-block; margin-top:26px; color:#0b0d14; background:#A9B7E8; text-decoration:none;
      padding:10px 18px; border-radius:8px; font:600 11px/1 ui-monospace,monospace; letter-spacing:.14em; text-transform:uppercase; }
</style>
<div class="card">
  <div class="kicker">saved to the library</div>
  <h1>${title.replace(/[<>&]/g, "")}</h1>
  <div class="artist">${artist.replace(/[<>&]/g, "") || "unknown artist"}</div>
  <div class="count">${imported}</div>
  <div class="sub">pages · one post</div>
  <div class="tags">${tagLine.replace(/[<>&]/g, "")}</div>
  <a href="http://localhost:25222/library">open in ayamai</a>
</div>
<script>setTimeout(() => window.close(), 9000)</script>`);
    return;
  }
  res.json({ ok: true, imported, failed: failures.slice(0, 5) });
});

/**
 * The relay window. It lives on this origin, so it can post the payload and
 * subscribe to the event stream; it forwards every step back to the page that
 * opened it, which is where the indicator actually belongs.
 */
router.get("/capture/live", (req, res): void => {
  res.type("html").send(`<!doctype html><meta charset="utf-8"><title>ayamai capture</title>
<style>
  body { margin:0; height:100vh; display:grid; place-items:center; background:#0b0d14; color:#e6ecff;
         font:12px/1.6 ui-monospace,monospace; }
  .box { width:100%; padding:18px 20px; }
  .label { letter-spacing:.24em; text-transform:uppercase; font-size:9px; color:#A9B7E8; }
  .title { margin:6px 0 12px; font-size:13px; color:#E6ECFF; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bar { height:3px; background:rgba(255,255,255,.12); border-radius:2px; overflow:hidden; }
  .fill { height:100%; width:6%; background:#A9B7E8; transition:width .25s; }
  .meta { margin-top:10px; font-size:9px; letter-spacing:.18em; text-transform:uppercase; color:rgba(255,255,255,.4); }
</style>
<div class="box">
  <div class="label" id="label">waiting for the page</div>
  <div class="title" id="title">ayamai</div>
  <div class="bar"><div class="fill" id="fill"></div></div>
  <div class="meta" id="meta">handing over the post…</div>
</div>
<script>
  const label = document.getElementById("label");
  const title = document.getElementById("title");
  const fill = document.getElementById("fill");
  const meta = document.getElementById("meta");
  const say = (data) => { try { window.opener && window.opener.postMessage({ ...data, relay: true }, "*"); } catch {} };
  let started = false;

  function fromHash() {
    try {
      const raw = decodeURIComponent(location.hash.slice(1));
      if (!raw) return null;
      const json = decodeURIComponent(escape(atob(raw)));
      return JSON.parse(json);
    } catch { return null; }
  }

  const boot = fromHash();
  if (boot) window.postMessage({ type: "ayamai-payload", payload: boot }, "*");

  window.addEventListener("message", async (event) => {
    if (!event.data || event.data.type !== "ayamai-payload" || started) return;
    started = true;
    const payload = event.data.payload;
    title.textContent = payload.title || "post";
    say({ type: "ayamai-relay", stage: "start", total: payload.images.length, title: payload.title });

    const source = new EventSource("/api/capture/events");
    source.onmessage = (message) => {
      let e; try { e = JSON.parse(message.data); } catch { return; }
      if (e.total !== payload.images.length || (payload.title && e.title && e.title !== payload.title)) return;
      label.textContent = e.stage === "done" ? "post added" : "collecting";
      fill.style.width = e.stage === "done" ? "100%" : Math.round(((e.index || 0) / (e.total || 1)) * 100) + "%";
      meta.textContent = e.stage === "done" ? (e.imported || 0) + " pages → 1 post" : "page " + (e.index || 0) + " of " + (e.total || 0);
      say({ type: "ayamai-relay", ...e });
      if (e.stage === "done" || e.stage === "error") {
        fill.style.background = e.stage === "done" ? "#91b7b3" : "#E53935";
        setTimeout(() => window.close(), 900);
      }
    };

    const body = new URLSearchParams({ payload: JSON.stringify(payload) });
    fetch("/api/capture/from-json", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } })
      .then((r) => r.json())
      .then((out) => { if (!out.ok) { label.textContent = "nothing saved"; fill.style.background = "#E53935"; say({ type: "ayamai-relay", stage: "error" }); } })
      .catch(() => { label.textContent = "could not reach the box"; say({ type: "ayamai-relay", stage: "error" }); });
  });

  window.opener && window.opener.postMessage({ type: "ayamai-ready" }, "*");
</script>`);
});

/** Live feed of captures: the app subscribes to this and paints them. */
router.get("/capture/events", (req, res): void => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": req.header("origin") ?? "*",
  });
  res.flushHeaders?.();
  for (const event of recentCaptures()) res.write(`data: ${JSON.stringify(event)}\n\n`);
  const unsubscribe = onCapture((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => { clearInterval(keepAlive); unsubscribe(); });
});

/**
 * Paste a link. If it is an artwork, ask pixiv for its pages and pull them all;
 * if it is a direct image, take that. Public posts work without a session;
 * R-18 posts answer "needs a browser" because they withhold the urls from us.
 */
router.post("/capture/link", async (req, res): Promise<void> => {
  const raw = String(req.body?.url ?? "").trim();
  const match = raw.match(/pixiv\.net\/(?:en\/)?artworks\/(\d+)/) || raw.match(/^https?:\/\/.*[?&]illust_id=(\d+)/);
  const image = raw.match(/^https:\/\/[a-z.]*pximg\.net\/.+\.(?:jpg|jpeg|png|gif|webp)$/i);

  if (image) {
    res.json({ ok: true, mode: "image", url: raw });
    return;
  }
  if (!match) { res.status(400).json({ error: "That is not a pixiv artwork link." }); return; }

  const id = match[1];
  const meta = await fetch(`https://www.pixiv.net/ajax/illust/${id}`, {
    headers: { "user-agent": "Mozilla/5.0", referer: `https://www.pixiv.net/artworks/${id}` },
    signal: AbortSignal.timeout(30_000),
  }).then((r) => r.json() as Promise<{ body?: { illustTitle?: string; userName?: string; pageCount?: number; tags?: { tags?: { tag: string }[] }; urls?: { original?: string } } }>)
    .catch(() => null);

  const body = meta?.body;
  const original = body?.urls?.original;
  if (!body || !original) {
    res.status(409).json({ error: "pixiv will not hand this one to the box — use the browser bookmark.", needsBrowser: true, id });
    return;
  }
  res.json({
    ok: true,
    mode: "post",
    id,
    title: body.illustTitle,
    artist: body.userName,
    tags: (body.tags?.tags ?? []).map((t: { tag: string }) => t.tag),
    images: Array.from({ length: Math.max(1, body.pageCount ?? 1) }, (_, i) => ({
      url: String(original).replace(/_p\d+\./, `_p${i}.`),
    })),
  });
});

/**
 * What is already home, so a sweep can resume instead of repeating itself.
 * Only artwork ids cross the wire; the library stays the only truth.
 */
router.get("/capture/existing", async (req, res): Promise<void> => {
  const kind = String(req.query.kind ?? "pixiv");
  if (kind !== "pixiv") { res.status(400).json({ error: "unknown kind" }); return; }
  const result = await db.execute(sql`
    select distinct substring(description from 'artworks/([0-9]+)') as id
    from media_items
    where description like '%pixiv.net/artworks/%'
    limit 20000
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ?? [];
  const ids = rows
    .map((row) => String((row as { id?: string }).id ?? ""))
    .filter(Boolean);
  res.set("Cache-Control", "no-store").json({ ids, count: ids.length });
});

export default router;
