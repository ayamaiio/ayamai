// The shelf: what to play, derived from the manifests at request time.
//
// No list of products lives here. A product is on the shelf because it declared
// a play face in its own manifest; adding a fourth surface means adding a face,
// not editing this page.

/** Pure: the three known glyphs, for everything else the product's own name. */
const GLYPH = { yoru: "\u591c", uta: "\u6b4c", gemu: "\u30b2\u30fc\u30e0" };

/** Pure: one shelf row, from a registry project and whether its service is up. */
export function shelfRow(project, { up = null } = {}) {
  return {
    id: project.id,
    jp: GLYPH[project.id] ?? "",
    href: project.href,
    line: project.description ?? "",
    up,
  };
}

const esc = (text) => String(text ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));

/** Pure: the page. `products` is already resolved - id, href, line, up. */
export function renderShelf({ products = [], mode = "dev" } = {}) {
  const rows = products.map((product) => `
      <a class="row" href="${esc(product.href)}" data-product="${esc(product.id)}">
        <span class="jp">${esc(product.jp)}</span>
        <span class="name">${esc(product.id)}</span>
        <span class="line">${esc(product.line)}</span>
        <span class="dot ${product.up === true ? "on" : product.up === false ? "off" : "unknown"}"></span>
      </a>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="theme-color" content="#0b0d14" />
<title>play \u00b7 ayamai</title>
<link rel="icon" href="/gehirn/favicon.ico" sizes="any" />
<link rel="stylesheet" href="/ui/ui.css" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;1,400&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" />
<style>

        --serif:"Cormorant Garamond",Georgia,serif;--mono:"IBM Plex Mono",ui-monospace,monospace;--sans:Inter,system-ui,sans-serif}
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;background:var(--void);color:var(--pale);font:300 15px/1.6 var(--sans)}
  .bar{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:14px 22px;
       border-bottom:1px solid var(--line);font:400 9px var(--mono);letter-spacing:.22em;text-transform:uppercase;color:var(--dim)}
  .bar b{font:400 18px var(--serif);letter-spacing:.08em;text-transform:none;color:var(--pale)}
  .bar a{color:var(--dim);text-decoration:none}
  .bar a:hover{color:var(--pale)}
  main{max-width:760px;margin:0 auto;padding:9vh 24px 60px}
  h1{font:400 40px var(--serif);margin:0 0 6px;letter-spacing:.02em}
  .sub{color:var(--pale);font-style:italic;margin:0 0 30px}
  .row{display:grid;grid-template-columns:44px 120px 1fr 10px;align-items:baseline;gap:14px;
        padding:16px 0;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}
  .row:hover .name{color:#fff}
  .row .jp{color:var(--rei);font-size:13px;letter-spacing:.2em;white-space:nowrap}
  .row .name{font:400 26px var(--serif);letter-spacing:.04em}
  .row .line{color:var(--dim);font-size:13px}
  .dot{width:6px;height:6px;border-radius:50%;background:var(--dim)}
  .dot.on{background:#91b7b3}.dot.off{background:var(--red)}
</style>
</head>
<body>
  <div class="bar"><span><b>play</b></span><span><a href="/gehirn/">dev \u2192</a></span></div>
  <main>
    <h1>play</h1>
    <p class="sub">${products.length} product${products.length === 1 ? "" : "s"}, and nothing to configure.</p>
    ${rows || '<p class="sub">nothing declares a play face yet</p>'}
  </main>
</body>
</html>`;
}
