# Design

The product is defined in [docs/PRODUCT.md](docs/PRODUCT.md); this document is the design language.

## What we are building

**One platform, eight products, and they are not the same thing.**

**ayamai is the platform.** It installs on a machine, opens one door at
`http://ayamai.local`, holds your model keys, and gives tools — a browser
extension, an editor extension, an agent — a single local API for getting a model
to do something on this computer. Its job is to make an environment
reproducible: install ayamai and the machine is set up.

**The products run on it.** gehirn is the control panel; yoru is the media
library, the first project that ran on the platform; seiri the board; kata the
design library; hisho the agent harness; gemu everything playable; tsukai and
fude the extensions. Each is a manifest, a directory and a route — no product is
special-cased, and the next one is added the same way.

## The logo and the type

One logo: `ui/brand/mark.png`. One stylesheet: `ui/brand.css`, which carries the
three typefaces *and* the brand rules. One renderer: `ui/brand.mjs` →
`brand({ tool, jp })`. The door serves all of it at `/ui/`, so every surface —
the panel, the products, the welcome page, the public page's copy — renders the
same mark, the same Cormorant wordmark and the same Japanese label.

Never define `.brand` styles in a page, and never load fonts from a page: a test
fails when a surface does.

## Pacing

How a surface *arrives* — delays, durations, easing, what lingers — is governed
by [docs/ART-MODE.md](docs/ART-MODE.md). The short version: taste is the owner's,
every number lives in one schedule block, and a change is proven with frames at
named beats rather than with a screenshot at the end.

**We design for extremely technically competent people.** Both are built by
technical people, for technical people. Assume the user already understands
computers, and design accordingly.

**Local first, cloud optional.** The machine owns the data and the process. A
hosted service may make install easier — GitHub for source, a registry for
packages, a bucket for artefacts — but nothing stops working when the network
does. The Game Boy, the arcade, the self-hosted git and the board are **toys**:
fun, occasionally useful, and allowed to be broken. When a choice costs the
platform or yoru a day to make a toy nicer, the product wins.

## Rules

- **The terminal is first-class — not exclusive.** Offer both surfaces: a command
  for precision and speed, a view for visibility and reach. Do not shy away from
  the terminal; do not hide behind it either.
- **Both surfaces, one truth.** A web view and a command read the same data. Never
  let one drift into a separate implementation of the other.
- **No flashy UI.** No decoration, no animation that exists to impress, no chrome
  that explains what the user already knows.
- **Assume competence.** Do not dumb down copy, hide the system, or soften errors
  into "something went wrong". Say what broke, where, and with what.
- **Expose the mechanism rather than wrapping it.** A log, a schema, a file on
  disk, a `--help` — these are interfaces. A view is another one.
- **A view exists to widen access, not to replace the command.** Many developers
  have never self-hosted git or run their own tracker. A web surface is how they
  discover that they can.
- **If a feature needs explaining, the feature is wrong.** Not the user.

## Dependencies

- **The toys carry none.** `plan`, `boardd`, `gitbox`, `status`, `where`, `board`
  run on the machine's existing node, bash, git and coreutils. No packages, no
  build step, no bundler.
- **If a toy would need a package, say so and wait.** Not "just add it" — the whole
  point is that these keep working when `node_modules` is deleted.
- The product application is different: it already has a tree. This rule is about
  the free toys.

## Applied

Every tool ships twice where it earns it: `plan` and a plan board, `gitbox` and a
repo view, `status` and a dashboard. The command is the source of truth; the view
is how you see it without remembering flags.

## Projects

Every toy we start becomes its own project with an owner — a person or an
organization — the way an open source repository has one. A tool should not live
forever as a folder inside another project's repo.

Each project gets: an owner, its own repository, its own plans, and its own
release. `plan` is the tracker; `gitbox` is the host.

Current candidates, in the order they appeared:

- `plan`     — issue tracking
- `gitbox`   — self-hosted git
- `board`    — terminal dashboard
- `boardd`   — the web dashboard
- `status`   — project status
- `where`    — the map of every path
- `arcade`   — emulators and ROMs
- `gb`       — the Game Boy emulator

This is a statement of intent, not a migration. Nothing moves until a project
has a name, an owner and a reason to stand alone.

## Gehirn

`node scripts/gehirn.mjs` serves http://localhost:4490: every service on this
machine, what state it is in, and a button that starts it. It is the web twin of
`status` — both read the same files and probe the same ports, and neither owns
state the other cannot see.

Gehirn is the control panel for a local application, not a SaaS console:
no accounts, no invitations, no marketing. It carries the brand by borrowing it
— the mark and icons come out of the app's own `public/`, the surface kit is
`ui/ui.css`, the portrait is the landing page's own asset. Nothing is redrawn.

Rules it obeys: a row states facts (`api · 5 ms · 200`), an action prints the
argv it ran, and a failure says what broke. Operations are local by default; the
page binds loopback unless `COCKPIT_HOST` says otherwise, and a request may only
act if it comes from the page itself.
### The console

Gehirn also holds the model. Paste a key once and it is written to
`.local/llm.json` with mode 0600 — the same place every other local secret
lives — and the page only ever learns a fingerprint (`sk-…7890`). Providers are
a table, not an integration: anything OpenAI-compatible works by editing the
base URL, and a local Ollama needs no key at all.

The console is deliberately not a chat. A prompt is a field, a run is a button,
an answer is a block of text with the model, the latency and the token counts
underneath. A failure is the provider's own sentence, quoted. One switch attaches
a compact brief of the machine — repos, vault, service states — so a question can
be about the project rather than the weather.
### The sweep button

The pixiv agent gets one extra control next to it: **sweep**. It is the whole
sequence, not a hint — check the browser is out of the way, start the agent,
confirm the session, resume the bookmark run. When Brave is open it says so
instead of stealing the profile, and a second press (with consent) closes it.
The library is the ledger: the sweep asks what is already home and skips it, so
pressing the button twice never downloads the same post twice.
## One door

The machine has one address: `http://ayamai.local`. Gehirn is the root,
the app is `/app`, the API is `/api`, the toys are `/board`, `/arcade`, `/gb`, the
curator is `/curator`. Ports still exist — they are how processes find each
other — but nobody types them.

The gateway is a router, not a rewriter: it matches a prefix and pipes the
request through, and every surface is started knowing the prefix it lives under.
Rewriting HTML on the way out is the thing we refuse to do; if a surface cannot
say where it lives, it gets a redirect and an honest note in gehirn rather
than a proxy that lies.

`/healthz` says which upstreams answer. `scripts/smoke-frontdoor.sh` walks every
path. The phone keeps its own door on 25223, forwarding to the same one.