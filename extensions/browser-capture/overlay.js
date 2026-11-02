// Hover any large image or video on any page and a small ayamai button appears.
// One click sends the URL to the local library; the server fetches the bytes and
// the file lands in the Inbox collection, ready to label.
(() => {
  // The app is the destination, not a source. Never draw capture UI on it.
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return;
  const API = "http://127.0.0.1:25222/api/capture/url";
  const MIN = 180;
  let badge = null;
  let target = null;
  let toast = null;

  const css = document.createElement("style");
  css.textContent = `
    #ayamai-grab {
      position: fixed; z-index: 2147483647; display: none; align-items: center; gap: 6px;
      padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(169,183,232,.55);
      background: rgba(11,13,20,.92); color: #e6ecff; cursor: pointer;
      font: 500 11px/1 ui-monospace, "IBM Plex Mono", monospace; letter-spacing: .12em;
      text-transform: uppercase; backdrop-filter: blur(6px);
      box-shadow: 0 8px 30px rgba(0,0,0,.45); transition: transform .12s ease, background .12s ease;
    }
    #ayamai-grab:hover { background: rgba(32,42,90,.95); transform: translateY(-1px); }
    #ayamai-grab[data-state="busy"] { opacity: .7; pointer-events: none; }
    #ayamai-grab[data-state="ok"] { border-color: #91b7b3; color: #91b7b3; }
    #ayamai-grab[data-state="err"] { border-color: #e53935; color: #e53935; }
    #ayamai-grab::before { content: "＋"; font-size: 12px; }
  `;
  document.documentElement.appendChild(css);

  function ensureBadge() {
    if (badge) return badge;
    badge = document.createElement("button");
    badge.id = "ayamai-grab";
    badge.type = "button";
    badge.textContent = "ayamai";
    badge.addEventListener("click", onGrab, true);
    badge.addEventListener("mouseenter", () => { if (target) showAt(target); });
    document.documentElement.appendChild(badge);
    return badge;
  }

  function showAt(el) {
    const r = el.getBoundingClientRect();
    const b = ensureBadge();
    b.style.display = "inline-flex";
    b.style.left = `${Math.min(window.innerWidth - 110, r.right - 96)}px`;
    b.style.top = `${Math.max(8, r.top + 8)}px`;
  }

  function hide() {
    if (badge) badge.style.display = "none";
    target = null;
  }

  function mediaUnder(node) {
    const el = node instanceof Element ? node : null;
    if (!el || el.closest("#ayamai-grab")) return null;
    const media = el.closest("img, video");
    if (!media) return null;
    const r = media.getBoundingClientRect();
    if (r.width < MIN || r.height < MIN) return null;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null;
    return media;
  }

  function sourceOf(el) {
    if (el.tagName === "VIDEO") return el.currentSrc || el.src || el.querySelector("source")?.src || "";
    return el.currentSrc || el.src || "";
  }

  function flash(text, state) {
    if (!badge) return;
    badge.dataset.state = state;
    badge.textContent = text;
    clearTimeout(toast);
    toast = setTimeout(() => {
      if (!badge) return;
      delete badge.dataset.state;
      badge.textContent = "ayamai";
      hide();
    }, 5000);
  }


  // Everything the page can tell us about the post, plus every image it has
  // already loaded for it. Pixiv numbers pages as <id>_p0, _p1, ... so the id
  // groups them; other hosts just get the clicked image.
  function postOf(clicked) {
    const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content || "";
    const idOf = (u) => (u.match(/\/(\d+)_p\d+\./) || [])[1] || "";
    const key = idOf(clicked);
    const urls = [...document.querySelectorAll("img")].map((img) => img.currentSrc || img.src || "").filter((u) => u.startsWith("http"));
    const images = key ? [...new Set(urls.filter((u) => idOf(u) === key))] : [clicked];
    const tags = [...document.querySelectorAll('a[href*="/tags/"]')].map((a) => a.textContent.trim()).filter(Boolean).slice(0, 40);
    return {
      images: images.length ? images : [clicked],
      payload: {
        pageUrl: location.href,
        title: (document.querySelector("h1")?.textContent || meta("og:title") || document.title || "").trim().slice(0, 180),
        artist: (document.querySelector('a[href*="/users/"]')?.textContent || meta("twitter:creator") || "").trim().slice(0, 120),
        tags: [...new Set([...tags, ...(meta("keywords") || "").split(",").map((t) => t.trim())])].filter(Boolean).slice(0, 40),
        url: clicked,
      },
    };
  }

  async function onGrab(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!target) return;
    const url = sourceOf(target);
    if (!url) { flash("no source", "err"); return; }
    badge.dataset.state = "busy";
    badge.textContent = "saving";
    const { images, payload } = postOf(url);
    try {
      const r = target.getBoundingClientRect();
      const reply = await chrome.runtime.sendMessage({
        type: "ayamai-post",
        images,
        payload,
        rect: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) },
        dpr: window.devicePixelRatio || 1,
      });
      if (!reply?.ok) {
        console.warn("[ayamai] capture failed", reply);
        throw new Error(reply?.error || "nothing saved");
      }
      flash(reply.saved > 1 ? `${reply.saved} saved` : "saved", "ok");
    } catch (error) {
      console.warn("[ayamai] capture threw", error);
      flash(String(error?.message || "failed").slice(0, 24), "err");
    }
  }

  document.addEventListener("mousemove", (event) => {
    if (event.target instanceof Element && event.target.closest("#ayamai-grab")) return;
    const el = mediaUnder(event.target);
    if (!el) { if (badge) hide(); return; }
    target = el;
    showAt(el);
  }, { passive: true });

  document.addEventListener("scroll", () => { if (badge) hide(); }, { passive: true });
  window.addEventListener("blur", () => { if (badge) hide(); });
})();
