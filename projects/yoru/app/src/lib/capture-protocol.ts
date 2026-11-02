export const CAPTURE_MAX = 20 * 1024 * 1024;
export const CAPTURE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "video/mp4", "video/webm"]);

export function safeCaptureSource(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || raw.length > 2000) throw Error("Unsafe capture provenance.");
  // Defense in depth: a compromised source may send arbitrary messages.
  url.search = ""; url.hash = "";
  // Keep only a narrow public numeric-post path vocabulary. Unknown paths can
  // contain capability credentials, so provenance deliberately falls to origin.
  if (!/^\/(?:posts?|images?|videos?)\/[0-9]{1,16}\/?$/.test(url.pathname)) url.pathname = "/";
  return url.href;
}

export function decodeCapture(data: { base64: unknown; contentType: unknown; size: unknown; sourceUrl: unknown }) {
  if (typeof data.base64 !== "string" || data.base64.length > Math.ceil(CAPTURE_MAX / 3) * 4 ||
      typeof data.contentType !== "string" || !CAPTURE_MIMES.has(data.contentType) ||
      typeof data.size !== "number" || !Number.isSafeInteger(data.size) || data.size < 1 || data.size > CAPTURE_MAX ||
      typeof data.sourceUrl !== "string") throw Error("Invalid capture or file exceeds 20 MiB.");
  const binary = atob(data.base64);
  if (binary.length !== data.size) throw Error("Capture size does not match.");
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const extension = data.contentType.split("/")[1];
  return {
    file: new File([bytes], `Captured media.${extension}`, { type: data.contentType }),
    sourceUrl: safeCaptureSource(data.sourceUrl),
  };
}
