// Markdown, small on purpose.
//
// Docs are read in the panel, not rendered faithfully: headings, paragraphs,
// lists, code, quotes, links. Everything is escaped before a single tag is
// produced — no raw HTML passthrough, ever.
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const safe = escapeHtml(href);
    const external = /^https?:\/\//.test(href);
    return `<a href="${safe}"${external ? ' target="_blank" rel="noreferrer"' : ""}>${label}</a>`;
  });
  return out;
}

/** Pure: markdown in, HTML out. No side effects, no dependencies. */
export function renderMarkdown(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let paragraph = [];
  let list = null;       // "ul" | "ol"
  let inCode = false;
  let code = [];
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };
  const flushCode = () => {
    if (!inCode) return;
    out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
    inCode = false;
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
      quote = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");

    if (/^```/.test(line)) {
      if (inCode) flushCode();
      else { flushParagraph(); flushList(); flushQuote(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(raw); continue; }

    if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); continue; }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph(); flushList(); flushQuote();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(line.trim())) {
      flushParagraph(); flushList(); flushQuote();
      out.push("<hr />");
      continue;
    }
    if (/^>\s?/.test(line)) { flushParagraph(); flushList(); quote.push(line.replace(/^>\s?/, "")); continue; }
    if (/^[-*]\s+/.test(line)) {
      flushParagraph(); flushQuote();
      if (list !== "ul") { flushList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flushParagraph(); flushQuote();
      if (list !== "ol") { flushList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(line.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }
    if (list) flushList();
    if (quote.length) flushQuote();
    paragraph.push(line.trim());
  }

  flushCode(); flushParagraph(); flushList(); flushQuote();
  return out.join("\n");
}
