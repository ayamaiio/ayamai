/** Shared helpers for direct, private browser-to-storage uploads. */
export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;

export const supportedContentTypes = new Set([
  "image/avif", "image/bmp", "image/gif", "image/heic", "image/heif", "image/jpeg", "image/png", "image/webp",
  "video/3gpp", "video/mp4", "video/mpeg", "video/quicktime", "video/webm", "video/x-m4v", "video/x-matroska", "video/x-msvideo",
]);

export type MediaFileInfo = { mediaType: "image" | "video"; contentType: string };

const mimeByExtension: Record<string, string> = {
  avif: "image/avif", bmp: "image/bmp", gif: "image/gif", heic: "image/heic", heif: "image/heif",
  jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp",
  "3gp": "video/3gpp", avi: "video/x-msvideo", m4v: "video/x-m4v", mkv: "video/x-matroska", mov: "video/quicktime",
  mp4: "video/mp4", mpe: "video/mpeg", mpeg: "video/mpeg", mpg: "video/mpeg", webm: "video/webm",
};

export function getMediaFileInfo(file: { name: string; type: string }): MediaFileInfo | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const reportedType = file.type.toLowerCase();
  if ((reportedType.startsWith("image/") || reportedType.startsWith("video/")) && !supportedContentTypes.has(reportedType)) return null;
  const contentType = supportedContentTypes.has(reportedType) ? reportedType : mimeByExtension[extension];
  if (!contentType || !supportedContentTypes.has(contentType)) return null;
  if (contentType.startsWith("image/")) return { mediaType: "image", contentType };
  if (contentType.startsWith("video/")) return { mediaType: "video", contentType };
  return null;
}

export function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function putFile(url: string, file: File, contentType: string, onProgress: (progress: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    let lastProgressUpdateAt = 0;
    request.open("PUT", url);
    const abort = () => request.abort();
    if (signal?.aborted) { reject(new Error("Upload stopped.")); return; }
    signal?.addEventListener("abort", abort, { once: true });
    request.onloadend = () => signal?.removeEventListener("abort", abort);
    request.setRequestHeader("Content-Type", contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = Math.min(99, Math.round((event.loaded / event.total) * 100));
        const now = performance.now();
        if (now - lastProgressUpdateAt >= 200 || progress === 99) {
          lastProgressUpdateAt = now;
          onProgress(progress);
        }
      }
    };
    request.onerror = () => reject(new TypeError("The browser could not reach storage."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Storage rejected this upload (HTTP ${request.status}).`));
    };
    request.onabort = () => reject(new Error("Upload stopped."));
    request.send(file);
  });
}
