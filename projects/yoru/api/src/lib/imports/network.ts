import { lookup } from "node:dns/promises";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import ipaddr from "ipaddr.js";

export type Provider = "drive" | "dropbox" | "mega";
export class ImportError extends Error {}

export function isPublicAddress(address: string) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch { return false; }
}

export function allowedHost(host: string, provider: Provider) {
  const matches = (base: string) => host === base || host.endsWith(`.${base}`);
  if (provider === "drive") return host === "drive.google.com" || host === "drive.usercontent.google.com" || matches("googleusercontent.com");
  if (provider === "dropbox") return matches("dropbox.com") || matches("dropboxusercontent.com");
  return host === "g.api.mega.co.nz" || host === "g.api.mega.nz" || matches("userstorage.mega.co.nz") || matches("userstorage.mega.nz");
}

export async function safeRequest(
  input: string, provider: Provider, signal: AbortSignal,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
  redirects = 0,
): Promise<IncomingMessage> {
  const url = new URL(input);
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password ||
      !allowedHost(url.hostname, provider) || redirects > 5) throw new ImportError("The provider returned an unsafe download location.");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) throw new ImportError("Private network addresses are not allowed.");
  const pinned = addresses[0]!;
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = https.request(url, {
      method: options.method ?? "GET",
      headers: { "User-Agent": "PrivateMediaLibrary/1.0", ...options.headers },
      signal,
      // Resolve once, validate every answer, and pin this connection to prevent DNS rebinding.
      lookup: (_hostname, _opts, callback) => callback(null, pinned.address, pinned.family),
      agent: false,
      family: pinned.family,
    }, resolve);
    request.setTimeout(45_000, () => request.destroy(new ImportError("The provider stopped responding. Try again.")));
    request.on("error", reject);
    request.end(options.body);
  });
  // Ensure aborted preview streams never generate an unhandled error.
  response.on("error", () => {});
  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    const location = response.headers.location;
    response.destroy();
    if (!location) throw new ImportError("The provider sent an invalid redirect.");
    return safeRequest(new URL(location, url).href, provider, signal,
      response.statusCode === 303 ? {} : options, redirects + 1);
  }
  if ((response.statusCode ?? 500) >= 400) {
    const status = response.statusCode;
    response.destroy();
    throw new ImportError(status === 429 || status === 509
      ? "The provider's download quota was reached. Retry later."
      : "This shared file is unavailable. Check its sharing permissions, password, or whether the link was revoked.");
  }
  return response;
}

export async function readLimited(stream: IncomingMessage, limit = 4 * 1024 * 1024) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) { stream.destroy(); throw new ImportError("The shared folder or provider response is too large. Use a smaller folder or individual file link."); }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
