// The logo, as markup. Every surface calls this so the brand cannot drift:
// same mark, same wordmark, same Japanese, same slash.
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);

/**
 * brand({ tool: "seiri", jp: "整理", href: "/seiri/" })
 *
 * The mark is served by the door, so every page references one file.
 */
export function brand({ tool = "", jp = "", href = null, base = "", word = "AYAMAI", wordJp = "アヤマイ", mark = "/ui/brand/mark.png" } = {}) {
  const to = href ?? (base || "/");
  const parts = [
    `<a class="brand" href="${escape(to)}">`,
    `<img class="mark" src="${escape(mark)}" alt="" width="17" height="17" decoding="async" />`,
    `<span class="word">${escape(word)}</span>`,
  ];
  if (wordJp) parts.push(`<span class="jp">${escape(wordJp)}</span>`);
  if (tool) {
    parts.push(`<span class="slash">/</span>`);
    parts.push(`<span class="tool">${escape(tool)}</span>`);
    if (jp) parts.push(`<span class="jp">${escape(jp)}</span>`);
  }
  parts.push("</a>");
  return parts.join("");
}

/** The stylesheet and the icon, so a page needs one call rather than three tags. */
export function brandLinks({ version = null, css = true } = {}) {
  const suffix = version ? `?v=${version}` : "";
  const links = [];
  if (css) links.push(`<link rel="stylesheet" href="/ui/brand.css${suffix}" />`);
  links.push(`<link rel="icon" href="/ui/brand/favicon.svg${suffix}" type="image/svg+xml" />`);
  return links.join("\n");
}
