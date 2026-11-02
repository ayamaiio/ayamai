// These self-contained functions execute in Chrome's isolated world on the
// explicitly activated tab. No network occurs during selection discovery.
export function discover() {
  const nodes = [...document.querySelectorAll("img,video")].filter((node) => {
    const r = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return r.width > 16 && r.height > 16 && r.bottom > 0 && r.right > 0 &&
      r.top < innerHeight && r.left < innerWidth && style.visibility === "visible" && style.display !== "none";
  }).slice(0, 50);
  globalThis.__ayamaiSelected = nodes.map((node) => ({ node, src: node.currentSrc || node.src }));
  return nodes.map((node, index) => ({ index, kind: node.tagName === "VIDEO" ? "Video" : "Image", width: Math.round(node.getBoundingClientRect().width), height: Math.round(node.getBoundingClientRect().height) }));
}

export async function readSelection(index) {
  try {
    const max = 20 * 1024 * 1024;
    const saved = globalThis.__ayamaiSelected?.[index];
    if (!saved || !saved.node.isConnected || (saved.node.currentSrc || saved.node.src) !== saved.src) throw Error("Selection changed. Find visible media again.");
    if (saved.node.tagName === "VIDEO" && saved.node.mediaKeys) throw Error("Protected video is not supported.");
    const url = new URL(saved.src);
    // Never transfer or retain signed/authenticated locators; do not even fetch them.
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443")) throw Error("Unsupported source: choose a direct HTTPS file without credentials, query or fragment.");
    if (/\.(m3u8|mpd)(?:$|\/)/i.test(url.pathname)) throw Error("Streaming manifests and protected players are unsupported.");
    const response = await fetch(url.href, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store", mode: "cors", signal: AbortSignal.timeout(60000) });
    const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm" };
    if (!response.ok || !extensions[mime] || !response.body) throw Error("Unsupported source: not an anonymous supported image/video response.");
    if (Number(response.headers.get("content-length")) > max) { await response.body.cancel(); throw Error("The selected file exceeds 20 MiB."); }
    const reader = response.body.getReader();
    let size = 0;
    const parts = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > max) { await reader.cancel(); throw Error("The selected file exceeds 20 MiB."); }
      parts.push(next.value);
    }
    if (!size) throw Error("The selected file is empty.");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    // Chrome scripting results are JSON serialized; keep the bounded bytes base64.
    let binary = "";
    for (let i = 0; i < size; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    let page = new URL(location.href);
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    if (canonical) {
      try { const candidate = new URL(canonical); if (candidate.origin === page.origin) page = candidate; } catch { /* use actual page */ }
    }
    if (page.protocol !== "https:" || page.username || page.password) throw Error("Page provenance must be public HTTPS without credentials.");
    // Query/fragment are never sent, and sensitive path forms reduce to origin.
    if (!/^\/(?:posts?|images?|videos?)\/[0-9]{1,16}\/?$/.test(page.pathname)) page.pathname = "/";
    page.search = ""; page.hash = "";
    return { base64: btoa(binary), contentType: mime, name: `Captured ${saved.node.tagName === "VIDEO" ? "video" : "image"}.${extensions[mime]}`, sourceUrl: page.href, size };
  } catch (error) {
    // Native fetch errors can include locators; return only our own safe messages.
    return { error: error instanceof TypeError || error.name === "TimeoutError"
      ? "Unsupported source: anonymous CORS download failed, redirected, or timed out. No credentials were used."
      : error.message };
  }
}
