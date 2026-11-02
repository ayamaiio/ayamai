import { Readable } from "node:stream";
import { z } from "zod/v4";
import { ImportError } from "./network";
import { sanitizeName, validateSize, type SourceFile } from "./providers";

export type CloudProvider = "drive" | "dropbox";
export const cloudScopes = {
  drive: "https://www.googleapis.com/auth/drive.readonly",
  dropbox: "files.metadata.read files.content.read",
};
export const tokenEndpoints = {
  drive: "https://oauth2.googleapis.com/token",
  dropbox: "https://api.dropboxapi.com/oauth2/token",
};
export const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().max(31536000),
  scope: z.string().optional(),
});
export type CloudCredentials = { accessToken: string; refreshToken: string; expiresAt: number };
export type CloudEntry = { id: string; name: string; folder: boolean; size: number };
export type CloudPage = { entries: CloudEntry[]; cursor: string | null };
export const mediaExtension = /\.(avif|bmp|gif|heic|heif|jpe?g|png|webp|3gp|mp4|mpe?g|mov|webm|m4v|mkv|avi)$/i;
const folderMime = "application/vnd.google-apps.folder";

// All credential-bearing requests target fixed provider endpoints. Never follow a
// redirect with an Authorization header or reflect a provider error body.
export async function providerRequest(url: string, init: RequestInit, signal: AbortSignal, transport = fetch) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !["www.googleapis.com", "oauth2.googleapis.com", "api.dropboxapi.com", "content.dropboxapi.com"].includes(parsed.hostname) || parsed.port || parsed.username || parsed.password) {
    throw new ImportError("Invalid cloud provider endpoint.");
  }
  let response: Response;
  try { response = await transport(url, { ...init, signal, redirect: "error" }); }
  catch { throw new ImportError("The cloud provider is unavailable. Please try again."); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ImportError(response.status === 401 || response.status === 403
      ? "Cloud authorization expired or access was denied. Reconnect your provider account."
      : response.status === 429 ? "The cloud provider is busy. Please wait and retry."
        : "The cloud provider could not supply this item. Check access and try again.");
  }
  return response;
}

export async function providerJson(url: string, init: RequestInit, signal: AbortSignal, transport = fetch): Promise<unknown> {
  const response = await providerRequest(url, init, signal, transport);
  const reader = response.body?.getReader();
  if (!reader) throw new ImportError("The cloud provider returned an empty response.");
  const parts: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 2 * 1024 * 1024) throw new ImportError("This cloud listing is too large. Choose a smaller folder.");
      parts.push(Buffer.from(chunk.value));
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("The cloud provider returned an unreadable response.");
  } finally { await reader.cancel().catch(() => {}); }
}

const driveFile = z.object({
  id: z.string(), name: z.string(), mimeType: z.string(), size: z.string().optional(),
  trashed: z.boolean().optional(),
});
const dropboxEntry = z.object({
  ".tag": z.enum(["file", "folder", "deleted"]),
  id: z.string().optional(), name: z.string(), size: z.number().optional(),
  is_downloadable: z.boolean().optional(),
});

function driveEntry(item: z.infer<typeof driveFile>): CloudEntry | null {
  if (item.trashed || (item.mimeType !== folderMime && (!mediaExtension.test(item.name) || item.mimeType.startsWith("application/vnd.google-apps.")))) return null;
  return { id: item.id, name: sanitizeName(item.name), folder: item.mimeType === folderMime, size: Number(item.size ?? 0) };
}
function dropEntry(item: z.infer<typeof dropboxEntry>): CloudEntry | null {
  if (!item.id || item[".tag"] === "deleted" || (item[".tag"] === "file" && (!mediaExtension.test(item.name) || item.is_downloadable === false))) return null;
  return { id: item.id, name: sanitizeName(item.name), folder: item[".tag"] === "folder", size: item.size ?? 0 };
}
export function validCloudId(provider: CloudProvider, id: string, root = false) {
  if (root && (!id || id === "root")) return true;
  return provider === "drive" ? /^[\w-]{1,200}$/.test(id) : /^id:[\w-]{1,200}$/.test(id);
}

export class CloudApi {
  constructor(readonly provider: CloudProvider, private token: string, private signal: AbortSignal, private transport = fetch) {}
  private json(url: string, body?: unknown) {
    return providerJson(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, this.signal, this.transport);
  }
  async entry(id: string): Promise<CloudEntry | null> {
    if (!validCloudId(this.provider, id)) throw new ImportError("Choose a valid provider file or folder.");
    if (this.provider === "drive") {
      return driveEntry(driveFile.parse(await this.json(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,trashed&supportsAllDrives=true`)));
    }
    return dropEntry(dropboxEntry.parse(await this.json("https://api.dropboxapi.com/2/files/get_metadata", { path: id })));
  }
  async list(folder = "", cursor?: string): Promise<CloudPage> {
    if (!validCloudId(this.provider, folder, true)) throw new ImportError("Choose a valid provider folder.");
    if (this.provider === "drive") {
      const query = new URLSearchParams({
        q: `'${folder || "root"}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,size,trashed)", pageSize: "100",
        supportsAllDrives: "true", includeItemsFromAllDrives: "true",
        ...(cursor ? { pageToken: cursor } : {}),
      });
      const result = z.object({ nextPageToken: z.string().optional(), files: z.array(driveFile) })
        .parse(await this.json(`https://www.googleapis.com/drive/v3/files?${query}`));
      return { entries: result.files.map(driveEntry).filter((e): e is CloudEntry => !!e), cursor: result.nextPageToken ?? null };
    }
    const result = z.object({ entries: z.array(dropboxEntry), cursor: z.string(), has_more: z.boolean() })
      .parse(await this.json(`https://api.dropboxapi.com/2/files/list_folder${cursor ? "/continue" : ""}`,
        cursor ? { cursor } : { path: folder === "root" ? "" : folder, recursive: false, limit: 100, include_deleted: false }));
    return { entries: result.entries.map(dropEntry).filter((e): e is CloudEntry => !!e), cursor: result.has_more ? result.cursor : null };
  }
  async open(id: string): Promise<Readable> {
    if (!validCloudId(this.provider, id)) throw new ImportError("Invalid cloud file.");
    const response = await providerRequest(this.provider === "drive"
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`
      : "https://content.dropboxapi.com/2/files/download", {
      method: this.provider === "drive" ? "GET" : "POST",
      headers: { Authorization: `Bearer ${this.token}`, ...(this.provider === "dropbox" ? { "Dropbox-API-Arg": JSON.stringify({ path: id }) } : {}) },
    }, this.signal, this.transport);
    if (!response.body) throw new ImportError("This cloud file is empty.");
    return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  }
}

export async function expandCloudSelection(api: Pick<CloudApi, "entry" | "list">, ids: string[]): Promise<SourceFile[]> {
  const folders: string[] = [];
  const seen = new Set<string>();
  const files: SourceFile[] = [];
  let total = 0;
  let visited = 0;
  let pages = 0;
  function add(entry: CloudEntry | null) {
    if (!entry || seen.has(entry.id)) return;
    seen.add(entry.id);
    if (++visited > 2000) throw new ImportError("This selection contains too many folders. Choose a smaller selection.");
    if (entry.folder) { folders.push(entry.id); return; }
    validateSize(entry.size);
    total += entry.size;
    files.push({ sourceId: entry.id, name: entry.name, size: entry.size });
    if (files.length > 200 || total > 50 * 1024 ** 3) throw new ImportError("Import up to 200 files and 50 GB at once. Choose a smaller folder or selection.");
  }
  for (const id of new Set(ids)) add(await api.entry(id));
  for (let index = 0; index < folders.length; index++) {
    let cursor: string | null = null;
    do {
      if (++pages > 100) throw new ImportError("This folder needs too many listing requests. Choose a smaller folder.");
      const page = await api.list(folders[index], cursor ?? undefined);
      for (const entry of page.entries) add(entry);
      cursor = page.cursor;
    } while (cursor);
  }
  if (!files.length) throw new ImportError("No supported images or videos were found in this selection.");
  return files;
}
