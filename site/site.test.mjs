import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

const seconds = (name) => Number(new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)s`).exec(html)[1]);

test("the word, then the mark and the kana together", () => {
  const name = seconds("brand-name");
  const logo = seconds("brand-logo");
  const jp = seconds("brand-jp");
  assert.ok(name < logo, `the word first (${name}s), then the face (${logo}s)`);
  assert.equal(jp, logo, "the mark and the kana share a beat");
  assert.ok(logo - name >= 0.5, "with room after the word");
  assert.ok(/<div class="name">AYAMAI<\/div>/.test(html), "the word is the centre");
  assert.ok(/logo-wrap"><img class="logo"/.test(html), "the mark hangs above it");
  assert.ok(/<div class="jp">アヤマイ<\/div>/.test(html), "the kana hangs below it");
  assert.ok(/--lilac: #a9b7e8/.test(html) && /\.intro-brand \.jp[\s\S]*?color: var\(--lilac\)/.test(html), "in the soft blue");
});

test("the attribution arrives in two beats", () => {
  const first = seconds("who-name");
  const second = seconds("who-role");
  assert.ok(second - first >= 2, `a longer beat between the name and the role (${second - first}s)`);
  assert.ok(/<span class="name">Terry A\. Davis<\/span><span class="role">creator of TempleOS<\/span>/.test(html), "in that order, on their own lines");
});

test("the quote rises, holds, and clears", () => {
  assert.ok(html.includes("An idiot admires complexity, a genius admires simplicity"));
  assert.ok(/introRise/.test(html) && /quoteOut/.test(html), "it rises, then leaves");
  const quote = seconds("quote-in");
  const name = seconds("who-name");
  assert.ok(name - quote >= 2, `a longer pause after the quote (${name - quote}s)`);
});

test("the opening hands the black over without a gap", () => {
  const brandOut = Number(/--brand-out:\s*(\d+(?:\.\d+)?)s/.exec(html)[1]);
  const quoteIn = Number(/--quote-in:\s*(\d+(?:\.\d+)?)s/.exec(html)[1]);
  assert.ok(quoteIn > brandOut, "the word goes before the quote arrives");

  const introEnd = Number(/--intro-end:\s*(\d+(?:\.\d+)?)s/.exec(html)[1]);
  const quoteOut = Number(/--quote-out:\s*(\d+(?:\.\d+)?)s/.exec(html)[1]);
  assert.ok(introEnd - quoteOut >= 0.8, "and the backdrop outlives the quote");
  assert.ok(new RegExp(`calc\\(var\\(--intro-end\\) - 0\\.5s\\)`).test(html), "the clear is the last half second of the opening");
});

test("the page itself does not animate", () => {
  assert.ok(!/header\.top \.mark \{ opacity: 0/.test(html), "the bar is simply there");
  assert.ok(!/footer\.wrap \{ opacity: 0/.test(html), "so is the footer");
  assert.ok(!/\.content \{ opacity: 0/.test(html), "and the section");
});

test("there is one section: the statement with its door", () => {
  const sections = html.match(/<section[^>]*class="(?!intro)/g) ?? [];
  assert.equal(sections.length, 1, "one content section");
  assert.ok(!html.includes('class="hero"'), "the hero block is gone");
  assert.ok(!/\.content \{[^}]*border-bottom/.test(html), "no rule line under it");
  assert.ok(html.includes("sign up for the private beta"));
  assert.equal((html.match(/mailto:/g) ?? []).length, 1);
});

test("the section is centred, horizontally and vertically", () => {
  assert.ok(/main\.wrap \{[^}]*place-items: center/.test(html), "the main area centres its child");
});

test("the sentence assembles itself", () => {
  assert.ok(/<span class="piece a">A<\/span>/.test(html), "the A comes alone");
  assert.ok(/<span class="lf"><span style="--i:0">l<\/span>/.test(html), "then it is typed");
  assert.ok(/<i class="caret"/.test(html), "with a caret");
  const letters = html.match(/<span style="--i:\d+">./g) ?? [];
  assert.equal(letters.length, 11, "eleven letters, each its own beat");
  assert.ok(/letterIn 90ms linear forwards/.test(html), "each appears whole");
  assert.ok(/var\(--i\) \* 58ms/.test(html), "and they follow one another");
  assert.ok(/steps\(11/.test(html), "the caret walks the word in eleven steps");
  assert.ok(/<em class="piece em">AI agent platform<\/em><span class="piece em-dot">\.<\/span>/.test(html), "then the claim and its full stop");
});

test("the beats are offsets from one seam", () => {
  assert.ok(/--intro-end:\s*\d+(\.\d+)?s/.test(html), "one absolute time");
  for (const beat of ["a", "type", "ai", "slogan", "slash", "stance", "door"]) {
    assert.ok(new RegExp(`--t-${beat}:\\s*calc\\(var\\(--intro-end\\)`).test(html), `${beat} is an offset`);
    assert.ok(new RegExp(`var\\(--t-${beat}\\)`).test(html), `${beat} is used`);
  }
  assert.equal((html.match(/var\(--intro-end\)/g) ?? []).length, 8, "the seven beats and the final clear, nothing else");
});

test("every beat gets its pause", () => {
  const at = (name) => Number(new RegExp(`--t-${name}:\\s*calc\\(var\\(--intro-end\\) \\+ (\\d+(?:\\.\\d+)?)s`).exec(html)[1]);
  const order = ["a", "type", "ai", "slogan", "slash", "stance", "door"];
  const times = order.map(at);

  // each animation is short; a gap of 1.5s between starts leaves a real silence
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    assert.ok(gap >= 1.5, `${order[i - 1]} → ${order[i]} starts ${gap}s later, too soon`);
  }
  // and the door waits noticeably longer than the rest
  const lastGap = times.at(-1) - times.at(-2);
  assert.ok(lastGap >= 2.5, `the button should wait longer (${lastGap}s)`);
});

test("nothing is left hidden without motion", () => {
  const reduced = html.slice(html.indexOf("prefers-reduced-motion: reduce"));
  assert.ok(/\.intro, \.intro-brand \{\s*display: none/.test(reduced), "both openings are removed");
  // the hidden start states live only inside no-preference
  const noPref = html.slice(html.indexOf("prefers-reduced-motion: no-preference"), html.indexOf("@keyframes pieceIn"));
  assert.ok(noPref.includes(".piece { opacity: 0"), "the hidden state is scoped to motion");
});

test("the slogan comes first, beside the Japanese", () => {
  assert.ok(/<p class="sub piece"><span class="more">and so much more…<\/span><span class="sep">·<\/span><span class="jp">自分の機械で動く<\/span><\/p>/.test(html));
});

test("it is still static", () => {
  assert.ok(!/<script/i.test(html), "no JavaScript");
  assert.ok(html.includes("v{{VERSION}}"), "the footer carries the release version");
});
