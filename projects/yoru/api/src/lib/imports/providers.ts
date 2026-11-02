import { Readable } from "node:stream";
import { API, File as MegaFile } from "megajs";
import { fileTypeFromBuffer } from "file-type";
import { ImportError, readLimited, safeRequest, type Provider } from "./network";
import { isSupportedMediaContentType, maxSingleUploadBytes } from "../r2Storage";

export type SourceFile = { sourceId: string; name: string; size: number };
export function sanitizeName(name: string) {
  return name.normalize("NFC").replace(/[/\\\u0000-\u001f\u007f]/g, "_").slice(0, 255).trim() || "Imported media";
}
export function parseShareLink(input: string): { provider: Provider; url: string } {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new ImportError("Paste a complete HTTPS share link."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new ImportError("Use a secure HTTPS share link.");
  const host = url.hostname.toLowerCase();
  if (host === "drive.google.com") {
    if (url.pathname.includes("/folders/")) throw new ImportError("For Google Drive, paste an individual file link. Folder browsing requires account authorization and is not part of share-link imports.");
    const id = url.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? url.searchParams.get("id");
    if (!id || !/^[\w-]{10,200}$/.test(id)) throw new ImportError("Use a Google Drive file sharing link.");
    const canonical = new URL("https://drive.google.com/uc");
    canonical.search = new URLSearchParams({ export: "download", id, ...(url.searchParams.get("resourcekey") ? { resourcekey: url.searchParams.get("resourcekey")! } : {}) }).toString();
    return { provider: "drive", url: canonical.href };
  }
  if (host === "dropbox.com" || host === "www.dropbox.com") {
    if (url.pathname.startsWith("/scl/fo/") || url.pathname.startsWith("/sh/")) throw new ImportError("For Dropbox, paste an individual file link, not a shared folder link.");
    if (!/^\/(s\/|scl\/fi\/)/.test(url.pathname)) throw new ImportError("Use a Dropbox file sharing link.");
    url.searchParams.delete("raw");
    url.searchParams.set("dl", "1");
    url.hash = "";
    return { provider: "dropbox", url: url.href };
  }
  if (host === "mega.nz" || host === "mega.co.nz") {
    if (!/^\/(file|folder)\/[\w-]{8}$/.test(url.pathname) && !(url.pathname === "/" && /^#!?/.test(url.hash))) throw new ImportError("Use a MEGA file or folder share link including its decryption key.");
    if (!url.hash || url.hash.length < 15) throw new ImportError("This MEGA link is missing its decryption key. Copy the complete share link.");
    return { provider: "mega", url: url.href };
  }
  throw new ImportError("Supported links are Google Drive, Dropbox, and MEGA shared files.");
}

export async function detectMedia(prefix: Buffer) {
  const detected = await fileTypeFromBuffer(prefix).catch(() => undefined);
  const mime = detected?.mime === "video/x-matroska" ? "video/x-matroska" : detected?.mime;
  const mediaType = mime?.startsWith("image/") ? "image" : "video";
  if (!mime || !isSupportedMediaContentType(mediaType, mime)) throw new ImportError("This file is not a supported image, GIF, or video. HTML pages and archives cannot be imported.");
  return { contentType: mime, mediaType };
}

export function validateSize(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxSingleUploadBytes) throw new ImportError("Shared files must have a known size between 1 byte and 5 GB.");
}

function megaApi(signal: AbortSignal, transport = safeRequest) {
  // MEGAJS accepts a fetch implementation. Keep its decrypted stream native to Node
  // so pipe backpressure is respected, and apply the same pinned-DNS policy to every request.
  const guardedFetch: typeof fetch = async (input, init) => {
    const combined = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    const response = await transport(String(input), "mega", combined, {
      method: init?.method, body: typeof init?.body === "string" ? init.body : undefined,
      headers: { "Content-Type": "application/json" },
    });
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    return {
      ok: true, status: response.statusCode, headers, body: response,
      json: async () => JSON.parse((await readLimited(response)).toString()),
      arrayBuffer: async () => {
        const data = await readLimited(response, 16 * 1024 * 1024);
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      },
    } as unknown as Response;
  };
  return new API(false, { fetch: guardedFetch });
}

async function loadMega(url: string, signal: AbortSignal, transport = safeRequest) {
  const api = megaApi(signal, transport);
  try {
    const root = MegaFile.fromURL(url, { api });
    const selected = await root.loadAttributes();
    // MEGAJS constructs folder descendants with its global API, not the root's
    // custom API. Rebind the entire tree before any child can be downloaded.
    const pending = [root];
    let visited = 0;
    while (pending.length) {
      const node = pending.pop()!;
      if (++visited > 2000) throw new ImportError("This folder is too large. Use a smaller shared folder.");
      node.api = api;
      if (node.children) pending.push(...node.children);
    }
    selected.api = api;
    return { root: selected, api };
  } catch (err) { api.close(); throw err; }
}

export function megaSourceId(file: MegaFile): string {
  // Runtime MEGAJS uses [shareHandle, nodeHandle] for folder children although
  // its published declaration types downloadId as a string. Serialize handles,
  // never an array reference, so database round-trips and tree reloads match.
  const value: unknown = file.downloadId;
  const handles = Array.isArray(value) ? value : [value];
  if (!handles.length || handles.some((handle) => typeof handle !== "string" || !/^[\w-]+$/.test(handle))) {
    throw new ImportError("MEGA returned an invalid file identifier.");
  }
  return JSON.stringify(handles);
}

function flattenMega(root: MegaFile): MegaFile[] {
  const pending = [root];
  const files: MegaFile[] = [];
  let visited = 0;
  while (pending.length) {
    const file = pending.pop()!;
    if (++visited > 2000) throw new ImportError("This folder is too large. Share a smaller folder with up to 200 media files.");
    if (file.directory) pending.push(...file.children ?? []);
    else files.push(file);
    if (files.length > 200) throw new ImportError("Import up to 200 files at once. Share a smaller folder.");
  }
  return files;
}

async function directResponse(url: string, provider: Provider, signal: AbortSignal, preview = false) {
  const options = preview ? { headers: { Range: "bytes=0-8191" } } : {};
  let response = await safeRequest(url, provider, signal, options);
  if (provider === "drive" && response.headers["content-type"]?.includes("text/html")) {
    const html = (await readLimited(response, 512 * 1024)).toString();
    // Google's large-file confirmation form contains a server-issued UUID token.
    const action = html.match(/<form[^>]*action="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&");
    if (!action) throw new ImportError("Google Drive requires sign-in or permission. Enable 'Anyone with the link' for this file and try again.");
    const target = new URL(action, "https://drive.google.com");
    if (target.hostname !== "drive.usercontent.google.com" || target.pathname !== "/download") throw new ImportError("Google Drive requires authorization or this file cannot be downloaded.");
    for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
      const name = match[0].match(/\bname="([^"]+)"/i)?.[1];
      const value = match[0].match(/\bvalue="([^"]*)"/i)?.[1]?.replace(/&amp;/g, "&");
      if (name && value && ["id", "export", "confirm", "uuid", "resourcekey"].includes(name)) target.searchParams.set(name, value);
    }
    response = await safeRequest(target.href, provider, signal, options);
  }
  return response;
}

export async function previewSource(provider: Provider, url: string, signal: AbortSignal, transport = safeRequest): Promise<SourceFile[]> {
  if (provider === "mega") {
    const { root, api } = await loadMega(url, signal, transport);
    try {
      const files = flattenMega(root).filter((file) => /\.(avif|bmp|gif|heic|heif|jpe?g|png|webp|3gp|mp4|mpe?g|mov|webm|m4v|mkv|avi)$/i.test(file.name ?? ""));
      if (!files.length) throw new ImportError("No supported images or videos were found in this link.");
      return files.map((file) => {
        validateSize(file.size ?? 0);
        return { sourceId: megaSourceId(file), name: sanitizeName(file.name ?? "Imported media"), size: file.size! };
      });
    } finally { api.close(); }
  }
  const response = await directResponse(url, provider, signal, true);
  try {
    const rangeSize = response.headers["content-range"]?.match(/\/(\d+)$/)?.[1];
    const size = Number(rangeSize ?? response.headers["content-length"]);
    validateSize(size);
    const disposition = response.headers["content-disposition"] ?? "";
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    let name = disposition.match(/filename="([^"]+)"/i)?.[1] ?? disposition.match(/filename=([^;]+)/i)?.[1] ?? new URL(url).pathname.split("/").pop() ?? "Imported media";
    if (encodedName) { try { name = decodeURIComponent(encodedName); } catch { /* fall back to plain filename */ } }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of response) {
      chunks.push(Buffer.from(chunk)); length += chunk.length;
      if (length >= 8192) break;
    }
    await detectMedia(Buffer.concat(chunks));
    return [{ sourceId: "shared-file", name: sanitizeName(name), size }];
  } finally { response.destroy(); }
}

export async function openSource(provider: Provider, url: string, sourceId: string, signal: AbortSignal, transport = safeRequest): Promise<Readable> {
  if (provider !== "mega") return directResponse(url, provider, signal);
  const { root, api } = await loadMega(url, signal, transport);
  try {
    const file = flattenMega(root).find((item) => megaSourceId(item) === sourceId);
    if (!file) throw new ImportError("The selected file is no longer available in this MEGA share.");
    file.api = api;
    const stream = file.download({
      maxConnections: 1, forceHttps: true,
      handleRetries: (_tries, error, callback) => callback(error),
    });
    const abort = () => stream.destroy(new ImportError("Import stopped."));
    signal.addEventListener("abort", abort, { once: true });
    stream.once("close", () => { signal.removeEventListener("abort", abort); api.close(); });
    stream.on("error", () => {});
    return stream;
  } catch (err) { api.close(); throw err; }
}

export function publicImportError(error: unknown) {
  // Never expose raw SDK/network errors: they can include signed URLs or share keys.
  return error instanceof ImportError ? error.message :
    "The provider could not supply this file. Check the complete link, sharing permissions, decryption key, password requirements, and download quota; then retry.";
}
