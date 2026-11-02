# Art mode

How we work when the surface is the point. Declared by the owner — *"this is art
mode"* — for landing pages, opening sequences, brand moments, motion, typography,
empty states, anything where the question is not "does it work" but "does it feel
like us".

It changes **who decides** and **what counts as finished**. It changes nothing
about secrets, publishing, or destructive operations: those stay exactly as
[AGENTS.md](../AGENTS.md) defines them.

## The contract

**The owner owns taste.** Absolutely and without argument. If the owner says
*less snappy*, *more reserved*, *give it room to breathe*, the answer is not that
it is fine — it is a number, found and applied.

**The agent owns translation and evidence.** Turn a feeling into a duration, an
easing, a delay. Then show the result as frames at named moments and say what the
new total length is. The agent may disagree once, in one sentence, with a
concrete alternative attached. Then it builds what the owner asked for.

## One idea at a time

Whatever becomes visible must say something the previous frame did not. Nothing
appears merely because it exists in the markup. If a beat cannot be justified in
one sentence — *the name, then the face, then the language* — it should not be a
beat.

The reference for this is the landing page: `AYAMAI` alone, then the mark and
`アヤマイ` together, then the black, then the quote, then the attribution in two
steps, then the page assembling itself. Each step is information.

## Numbers live in one place

Every timing, duration and easing sits in a **schedule block** at the top of the
file, named, and measured as an offset from one anchor:

```css
:root {
  --intro-end: 14.30s;                                  /* the seam */
  --t-type:    calc(var(--intro-end) + 1.70s);           /* offsets from it */
}
```

Consequences that matter:

- the owner can change the whole feel by editing one block;
- re-timing one stage moves everything downstream without touching rules;
- a number in a rule deep in the file is a defect, not a shortcut.

## Mechanism before ornament

The smallest thing that works. CSS before JavaScript. A fixed overlay before a
layout collapse. A per-letter reveal before a canvas effect.

Two promises stay true in every art-mode surface:

- **complete without motion** — under `prefers-reduced-motion: reduce` the
  finished state is simply there; nothing is left hidden, no half-built page;
- **the public page ships no JavaScript** — if a piece needs script, that is a
  design change, not an implementation detail.

## Evidence, not adjectives

Verify with frames at named timestamps and show them:

> 0.2 s the A alone · 1.0 s mid-word, caret visible · 1.7 s the sentence · 2.5 s
> the slogan · 3.0 s the slash drawing · 4.4 s complete

A single screenshot proves nothing about a sequence. State the total length out
loud — even when it is twenty-six seconds, especially then. If the piece is long,
say so and offer the numbers that would shorten it.

## Guard the promises with tests

Taste argued for becomes a constraint the next agent cannot quietly undo:

- if we decided every beat gets a pause, a test reads the schedule and fails when
  the gap closes;
- if we decided the header and footer never animate, a test asserts they carry no
  hidden state;
- if we decided nothing is left invisible without motion, a test asserts it.

The test is not bureaucracy; it is how the argument survives the next edit.

## Ways this has gone wrong

Real failures from building the landing page, kept because they will happen again:

- **An animation whose keyframes were never written.** `animation: brandPieceIn`
  with no `@keyframes brandPieceIn` runs to no effect; the element sits at
  `opacity: 0` and the screen is black. An animation name that does not exist is
  silent.
- **`var()` inside a shorthand.** One unresolvable variable invalidates the
  entire `animation` declaration rather than the single part — the element then
  has no animation at all.
- **Specificity fights.** `.who span.out` outranked the rise and the attribution
  never appeared; `.wrap` beat `footer` on padding and the spacing silently did
  nothing. When an animation "does not run", read the computed style before
  rereading the keyframes.
- **A clip that cuts a glyph.** A proportional serif cannot be revealed by equal
  `steps()` slices without slicing letters in half. Reveal per letter, not per
  clip step.
- **A duplicate block inside a media query.** Cutting and pasting a rule set and
  leaving the copy inside `@media (max-width: 620px)` means the desktop simply
  never gets it — the page "loads all at once" and the cause is not in the
  animation at all.
- **A gap between two overlays.** Whatever is underneath flashes through it. Hold
  the black until the next stage is ready; hide anything that is not part of the
  reveal.

## The ritual

1. **The owner describes a feeling.** "It should linger." "That is too snappy."
2. **The agent translates** into numbers in the schedule block, and says which
   ones moved.
3. **The agent looks** — captures the beats, checks the computed style when
   something does not move, and never trusts a single frame.
4. **The agent reports the timeline and the total**, with the frames.
5. **The owner reacts to the feel.** Repeat, at whatever granularity the owner
   wants. Two numbers per turn is normal and good.

Preview modes make this bearable: `?intro=0` plays the reveal from the first
frame, `?static=1` shows the settled page. Never make the owner sit through the
whole piece to judge one beat.

## The reference

`site/index.html` — the schedule block, the beat table in
[docs/OPERATIONS.md](OPERATIONS.md), and the preview switches in
`scripts/site-preview.mjs`. Read the schedule before changing anything.

## Before calling it done

- [ ] every timing is in the schedule block, offset from one anchor
- [ ] the piece is complete under `prefers-reduced-motion: reduce`
- [ ] no JavaScript was added
- [ ] frames captured at each named beat, not one at the end
- [ ] the total length is stated in the report
- [ ] the decisions we argued for are guarded by tests
