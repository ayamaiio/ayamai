// The components kata shows. An explicit list, not a filesystem scan: a class is
// documented because someone wrote it down, and the test proves every class here
// exists in ui/ui.css.
export const COMPONENTS = [
  {
    name: "bar",
    classes: ["bar"],
    note: "a header or footer strip; the top bar of every surface",
    markup: `<header class="bar"><span class="brand">AYAMAI</span><span class="clock">12:00:00</span></header>`,
  },
  {
    name: "brand",
    classes: ["brand", "word", "jp", "slash", "tool"],
    note: "the wordmark line: latin, japanese, a red slash, the surface's name",
    markup: `<span class="brand"><span class="word">AYAMAI</span><span class="jp">アヤマイ</span><span class="slash">/</span><span class="tool">kata</span><span class="jp">型</span></span>`,
  },
  {
    name: "label",
    classes: ["label"],
    note: "a small mono kicker above a group",
    markup: `<p class="label">projects</p>`,
  },
  {
    name: "panel",
    classes: ["panel", "grid"],
    note: "a column of the three-column surfaces",
    markup: `<div class="grid"><section class="panel"><p class="label">panel</p></section></div>`,
  },
  {
    name: "card",
    classes: ["card"],
    note: "a raised block for one thing",
    markup: `<div class="card"><p class="label">card</p><p>content</p></div>`,
  },
  {
    name: "table",
    classes: ["table", "right"],
    note: "dense rows of facts; numbers right-aligned, always mono",
    markup: `<table class="table"><tbody><tr><td>api</td><td class="right">:8081</td></tr><tr><td>web</td><td class="right">:25322</td></tr></tbody></table>`,
  },
  {
    name: "row",
    classes: ["row"],
    note: "a list row: identity on the left, state on the right",
    markup: `<div class="row"><span class="id">#1</span><span class="title">a plan item</span><span class="meta">yoru</span></div>`,
  },
  {
    name: "stats",
    classes: ["stats", "stat"],
    note: "a definition list of one number per line",
    markup: `<dl class="stats"><div class="stat"><dt>uptime</dt><dd>14s</dd></div></dl>`,
  },
  {
    name: "button",
    classes: ["btn", "ghost", "primary"],
    note: "the one button shape; ghost for secondary, primary for the single action on a page",
    markup: `<a class="btn ghost" href="#">open</a> <a class="btn primary" href="#">enter</a>`,
  },
  {
    name: "input",
    classes: ["input"],
    note: "a text field on the void",
    markup: `<input class="input" placeholder="type something" />`,
  },
  {
    name: "rule",
    classes: ["rule"],
    note: "a hairline between ideas",
    markup: `<p>above</p><hr class="rule" /><p>below</p>`,
  },
  {
    name: "glyph",
    classes: ["glyph", "done", "blocked", "doing"],
    note: "state as a single character; colour carries the rest",
    markup: `<span class="glyph">-</span> <span class="glyph doing">></span> <span class="glyph blocked">!</span> <span class="glyph done">x</span>`,
  },
];
