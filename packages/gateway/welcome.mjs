// The first thing you see at ayamai.local.
//
// The landing page's own composition — void, serif wordmark, the portrait, one
// red slash — with a single job: an invitation in. The button says "enter",
// because the room introduces itself once you are inside.

/** Pure: what the status line says. Injected into the page, so there is one copy. */
export function formatStatus(services) {
  if (!Array.isArray(services) || services.length === 0) return { tone: "dim", text: "checking…" };
  // Toys and projects this machine cannot run are not failures — they are absent.
  const expected = services.filter((service) => service.kind !== "toy" && !service.absent);
  const absent = services.filter((service) => service.absent).length;
  if (expected.length === 0) return { tone: "dim", text: "nothing expected here" };
  const up = expected.filter((service) => service.up).length;
  const total = expected.length;
  const down = expected.filter((service) => !service.up).map((service) => service.name);
  const suffix = absent ? ` · ${absent} not installed` : "";
  if (up === 0) return { tone: "red", text: `none of ${total} up${suffix}` };
  if (up === total) return { tone: "ok", text: `${total} of ${total} up${suffix}` };
  return { tone: "warn", text: `${up} of ${total} up · ${down.join(", ")} down${suffix}` };
}

export function renderWelcome({ origin = "http://ayamai.local", hostname = "", version = null, mode = "dev", enterHref = null } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="theme-color" content="#0b0d14" />
<meta name="robots" content="noindex,nofollow" />
<title>ayamai</title>
<link rel="icon" href="/gehirn/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/gehirn/favicon-32x32.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="/ui/ui.css" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" />
<style>
    :root {
    /* the arrival: the whole room at once, quietly. Tokens come from the kit. */
    --arrive: 0.08s;
  }

  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--void); color: var(--pale);
    display: grid; grid-template-rows: 1fr auto;
    font: 300 15px/1.6 var(--sans);
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  ::selection { background: var(--red); color: #fff; }

  /* the room, not the subject */
  .portrait { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
  .portrait img {
    width: 100%; height: 100%; object-fit: cover; object-position: 68% 38%;
    display: block; opacity: .22; filter: saturate(.4) contrast(1.02) brightness(.92);
  }
  .portrait::after {
    content: ""; position: absolute; inset: 0;
    background: linear-gradient(90deg, var(--void) 0%, rgba(11,13,20,.96) 40%, rgba(11,13,20,.62) 62%, transparent 84%);
  }

  main {
    position: relative; z-index: 2;
    display: flex; align-items: center; justify-content: center;
    padding: 0;
    cursor: pointer;
  }
  .copy { width: 100%; max-width: 780px; padding: 0 28px; }

  h1 { margin: 0; font: 400 52px/1 var(--mono); letter-spacing: .34em; color: var(--pale); }
  .jp { margin: 20px 0 0; font: 400 13px/1 var(--mono); letter-spacing: .5em; color: var(--rei); }
  .sub { margin: 26px 0 0; font: italic 300 20px/1.5 var(--serif); letter-spacing: .01em; color: var(--muted); }
  .slash { display: block; width: 44px; height: 2px; margin: 30px 0 0; background: var(--red); }

  .enter {
    display: inline-block; margin: 34px 0 0; padding: 13px 18px;
    border: 1px solid var(--line); border-radius: 3px; background: none;
    font: 400 10px var(--mono); letter-spacing: .26em; text-transform: uppercase;
    color: var(--pale); text-decoration: none;
  }
  .enter span { color: var(--red); }
  .enter:hover { border-color: var(--red); color: #fff; }
  .enter:focus-visible { outline: 2px solid var(--red); outline-offset: 3px; }

  footer {
    position: relative; z-index: 2;
    display: flex; justify-content: space-between; align-items: baseline; gap: 18px; flex-wrap: wrap;
    padding: 24px clamp(24px, 7vw, 120px) 28px;
    font: 400 9px/1.6 var(--mono); letter-spacing: .2em; text-transform: uppercase; color: var(--dim);
  }
  footer a { color: var(--dim); text-decoration: none; border-bottom: 1px solid transparent; }
  footer a:hover { color: var(--pale); border-bottom-color: var(--red); }
  footer .local { color: var(--dim); }
  footer .sep { opacity: .45; margin: 0 6px; }
  footer .dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--dim); margin-right: 7px; vertical-align: 1px; }
  footer .dot.ok { background: #91b7b3; }
  footer .dot.warn { background: #cead9a; }
  footer .dot.red { background: var(--red); }
  footer .links a { margin-right: 10px; }
  footer .right { color: var(--dim); letter-spacing: .18em; }

  @media (prefers-reduced-motion: no-preference) {
    .copy { opacity: 0; animation: arrive 550ms cubic-bezier(.22,.61,.36,1) var(--arrive) forwards; }
  }
  @keyframes arrive { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

  @media (max-width: 620px) {
    .portrait { display: none; }
    main { padding: 0 26px; }
    h1 { font-size: 36px; letter-spacing: .28em; }
    .jp { font-size: 11px; letter-spacing: .42em; }
    .sub { font-size: 17px; }
    .enter { display: block; width: 100%; text-align: center; }
    footer { padding: 20px 26px 24px; gap: 10px; }
  }
</style>
</head>
<body>
  <div class="portrait"><img src="/gehirn/portrait.png" alt="" /></div>

  <main id="hero">
    <section class="copy">
      <h1>AYAMAI</h1>
      <p class="jp" lang="ja">アヤマイ</p>
      <p class="sub">A quiet place to run things.</p>
      <span class="slash" aria-hidden="true"></span>
      <a class="enter" href="${enterHref ?? (mode === "play" ? "/play/" : "/gehirn/")}" id="enter">enter <span aria-hidden="true">&#8594;</span></a>
    </section>
  </main>

  <footer>
    <p class="left">
      <span class="local">LOCAL &middot; ${hostname ? escapeHtml(hostname) : "this machine"}</span><span class="sep">&middot;</span>
      <span class="dot" id="dot"></span><span id="status" aria-live="polite">checking&hellip;</span><span class="sep">&middot;</span>
      <span class="links"><a href="/yoru/">yoru</a><a href="/agent/capabilities">agent</a><a href="/healthz">health</a></span>
    </p>
    <p class="right">ayamaiio &middot; ikari${version ? ` &middot; v${escapeHtml(version)}` : ""}</p>
  </footer>
  <script>
  (function () {
    var formatStatus = ${formatStatus.toString()};

    var dot = document.getElementById("dot");
    var label = document.getElementById("status");

    function show(tone, text) {
      dot.className = "dot " + tone;
      label.textContent = text;
    }

    function tick() {
      fetch("/health.json", { cache: "no-store" })
        .then(function (response) { if (!response.ok) throw new Error("health"); return response.json(); })
        .then(function (data) { var line = formatStatus(data.services); show(line.tone, line.text); })
        .catch(function () { show("dim", "no answer"); });
    }

    tick();
    setInterval(tick, 15000);

    function go() { window.location.href = "/gehirn/"; }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); go(); }
    });

    document.getElementById("hero").addEventListener("click", function (event) {
      if (event.target.closest("a")) return;
      go();
    });
  })();
  </script>
</body>
</html>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
