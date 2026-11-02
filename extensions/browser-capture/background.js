// Two ways in, in order of quality:
//
//  1. Ask Chrome to download the original files. It carries the session cookies,
//     and a declarativeNetRequest rule supplies the Referer pixiv demands. The
//     local API then imports them off disk at full resolution.
//  2. If the download is refused, screenshot the element through the debugger —
//     lower quality, but the pixels are already on screen.
const IMPORT = "http://127.0.0.1:25222/api/capture/import";
const BYTES = "http://127.0.0.1:25222/api/capture/bytes";
const LOG = "http://127.0.0.1:25222/api/capture/log";

const report = (stage, message, detail) => {
  fetch(LOG, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stage, message, detail }),
  }).catch(() => {});
};

// Self-contained: injected into the tab on demand, so it works whether or not
// the hover overlay ever loaded. Returns everything capture() needs.
function scrapePost() {
  const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content || "";
  const big = [...document.querySelectorAll("img, video")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 180 && r.height >= 180;
  });
  const first = big[0] || null;
  const src = (el) => (el ? (el.currentSrc || el.src || el.querySelector?.("source")?.src || "") : "");
  const clicked = src(first);
  const idOf = (u) => (u.match(/\/(\d+)_p\d+\./) || [])[1] || "";
  const key = idOf(clicked);
  const urls = [...document.querySelectorAll("img")].map((i) => i.currentSrc || i.src || "").filter((u) => u.startsWith("http"));
  const images = key ? [...new Set(urls.filter((u) => idOf(u) === key))] : (clicked ? [clicked] : []);
  const tags = [...document.querySelectorAll('a[href*="/tags/"]')].map((a) => a.textContent.trim()).filter(Boolean).slice(0, 40);
  const r = first?.getBoundingClientRect();
  return {
    images: images.length ? images : (clicked ? [clicked] : []),
    payload: {
      pageUrl: location.href,
      title: (document.querySelector("h1")?.textContent || meta("og:title") || document.title || "").trim().slice(0, 180),
      artist: (document.querySelector('a[href*="/users/"]')?.textContent || "").trim().slice(0, 120),
      tags: [...new Set([...tags, ...(meta("keywords") || "").split(",").map((t) => t.trim())])].filter(Boolean).slice(0, 40),
      url: clicked,
    },
    rect: r ? { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) } : null,
    dpr: devicePixelRatio || 1,
  };
}

const isLocal = (url = "") => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

chrome.action.onClicked.addListener(async (tab) => {
  if (isLocal(tab?.url)) return;   // the app itself is never a source
  report("action", "toolbar clicked", { url: tab?.url ?? "", id: tab?.id ?? null });
  if (!tab?.id) return;
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapePost });
    const message = result?.result;
    report("scrape", `${message?.images?.length ?? 0} images`, { title: message?.payload?.title ?? "" });
    if (!message?.images?.length) {
      await chrome.action.setBadgeText({ tabId: tab.id, text: "0" });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#E53935" });
      setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: "" }), 4000);
      return;
    }
    const out = await capture(message, tab.id);
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: out.ok ? "#91b7b3" : "#E53935" });
    await chrome.action.setBadgeText({ tabId: tab.id, text: out.ok ? String(out.saved ?? 1) : "!" });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: "" }), 6000);
  } catch (error) {
    report("action", `throw ${error?.message}`);
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#E53935" }).catch(() => {});
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" }).catch(() => {});
  }
});

const extOf = (url) => {
  const match = /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov)(?:[?#]|$)/i.exec(url);
  return match ? match[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
};

const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

// Host permissions + the declarativeNetRequest rule mean this request carries
// the Referer pixiv insists on and is not subject to the page's CORS. No
// downloads, no .htm block pages, no Brave prompt.
async function viaFetch(payload, images) {
  report("fetch", `start ${images.length}`, images.slice(0, 3));
  const saved = [];
  for (let i = 0; i < images.length; i += 1) {
    let body = null;
    try {
      const res = await fetch(images[i], {
        credentials: "include",
        referrer: "https://www.pixiv.net/",
        referrerPolicy: "unsafe-url",
        cache: "force-cache",
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) { report("fetch", `http ${res.status}`, images[i].slice(0, 120)); continue; }
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength < 64 || buffer.byteLength > 40 * 1024 * 1024) { report("fetch", `size ${buffer.byteLength}`); continue; }
      body = toBase64(buffer);
    } catch (error) { report("fetch", `throw ${error?.message}`, images[i].slice(0, 120)); continue; }
    const res = await fetch(BYTES, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, data: body, index: i, count: images.length }),
    });
    if (res.ok) saved.push(i); else report("post", `http ${res.status}`, await res.text().catch(() => ""));
  }
  report("fetch", `done ${saved.length}/${images.length}`);
  return saved.length ? { ok: true, saved: saved.length } : null;
}

async function viaScreenshot(payload, images, tabId, rect, dpr) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    await chrome.debugger.sendCommand(target, "Page.enable");
    const tree = await chrome.debugger.sendCommand(target, "Page.getFrameTree");
    const frameId = tree.frameTree.frame.id;
    const saved = [];
    for (let i = 0; i < images.length; i += 1) {
      let data = null;
      try {
        const r = await chrome.debugger.sendCommand(target, "Page.getResourceContent", { frameId, url: images[i] });
        data = r?.content ?? null;
      } catch { data = null; }
      if (!data && i === 0 && rect) {
        const shot = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
          format: "png", captureBeyondViewport: false,
          clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: Math.min(2, dpr || 1) },
        }).catch(() => null);
        data = shot?.data ?? null;
      }
      if (!data) continue;
      const res = await fetch(BYTES, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, data, index: i, count: images.length }),
      });
      if (res.ok) saved.push(i); else report("post", `http ${res.status}`, await res.text().catch(() => ""));
    }
    return { ok: saved.length > 0, saved: saved.length };
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function capture(message, tabId) {
  const { payload, images, rect, dpr } = message;
  const folder = `cap-${Date.now().toString(36)}`;
  try {
    const fetched = await viaFetch(payload, images);
    if (fetched) return fetched;
    return await viaScreenshot(payload, images, tabId, rect, dpr);
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "ayamai-post") return false;
  capture(message, sender.tab?.id)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
  return true;
});
