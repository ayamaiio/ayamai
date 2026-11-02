# The pre-foundation board — 2026-11-02

18 items (15 open) and 12 captured ideas,
retired in one pass because they were written before the project settled on what it
is. Snapshot taken at commit `b7df404`, 77 events into
the log. Nothing was deleted: every item is still in `.plan/events.jsonl` and can be
revived with `plan set <id> --status todo`.

## Items

### hisho

- **#18** P1 · todo — Add a per-project activity signal endpoint that returns last-touched timestamp and open-work count

  from idea #1 · A way to see which projects are quiet and which are on fire, at a glance

  Expose a single read endpoint on the platform that, for each registered project, returns the most recent activity timestamp and the count of open items (uncommitted files, open plans, pending intake). Done when the endpoint returns data for all six projects and a contract test pins the response shape.

- **#19** P2 · todo — Define quiet and on-fire thresholds as configurable platform settings

  from idea #1 · A way to see which projects are quiet and which are on fire, at a glance

  Add named settings for the quiet cutoff (no activity for N days) and the on-fire cutoff (open items above M or activity within H hours), with sane defaults and a documented precedence order. Done when the thresholds can be changed without a code deploy and the signal endpoint reflects the new values.


### platform

- **#17** P2 · todo — Device install matrix: mac minis, laptops, Linux boxes, phones

  One checklist per class of machine, each with the evidence that it works: node source (tarball vs brew vs distro), hosts entry, port 80 mechanism (launchd / systemd / netsh portproxy), autostart, doctor output. The Mac laptop is done; a second Mac and a fresh Linux box are next.

- **#8** P2 · done — Get started on a Game Boy emulator

  Captured 2026-11-01 from /home/markfoster314/ayamai-deepseek.

  Get started on a Game Boy emulator

- **#15** P3 · todo — Install ayamai on the TV in the living room

  Same shape as the Mac install: one privileged step, door on 80, autostart at login/boot. TVs have no shell — the realistic path is the LAN door (:25223) opened in the browser, or a Raspberry Pi / Apple TV app if that proves too limited. Decide which before building.

- **#9** P3 · done — Make an intake system where my requests are marked down to revisit and turn into

  Captured 2026-11-01 from /home/markfoster314/ayamai-deepseek.

  Make an intake system where my requests are marked down to revisit and turn into actionable implementations

- **#16** P4 · todo — Install ayamai on the game consoles

  PS5 and Xbox have no user shell and no browser worth using; Switch has neither. Realistic: a console browser pointing at the LAN door for the media surfaces, not the platform. Record what each console's browser actually supports before promising anything.


### yoru

- **#3** P1 · doing — Verify the library works with the network unplugged

  Local-founder mode, filesystem media, local Postgres. Claimed offline; not yet proven end to end.

- **#2** P1 · blocked — Second copy of the vault

  385 GB of irreplaceable media on a single SSD. No cloud copy by design. Needs a durability story.

- **#12** P1 · todo — Capture panel: an in-page ayamai overlay with actions, not a floating badge
- **#1** P1 · done — Local import registers as a first-class job

  Importer writes to media_items but never creates a job, so the app cannot see it. Per-file rows vs aggregate counters is the open decision.

- **#5** P2 · doing — Video preview backfill

  Previews are generated on demand and nothing enqueues them for imported rows. ~2,300 videos need a backfill.

- **#4** P2 · todo — ayamai CLI: import, status, verify

  Terminal is the first-class interface. The web app shrinks to viewing images, playing video, seeking.

- **#10** P2 · todo — Decide: fork Chromium, wrap it in Electron, or stay on the extension
- **#11** P2 · todo — Inbox view: everything captured, grouped by post, ready to label
- **#13** P2 · todo — Gallery posts: page through the 30 attachments inside the loop
- **#6** P3 · todo — Activity covers previews and labels, not just imports

  The status line assumes every job is an import. It should report preview generation and label sync too.

- **#7** P3 · todo — Decide: one box, or boxes that talk

  Invites, follows and feeds only make sense if boxes are networked. Everything downstream depends on this.


## Ideas inbox

- A way to see which projects are quiet and which are on fire, at a glance
- {"ts":"2026-11-02T01:33:15.174Z","t":"draft","id":1,"stories":[{"title":"Add a per-project activity signal endpoint that reports last-touched time and open work counts","project":"hisho","priority":1,"body":"Expose an endpoint that, for each project, returns the timestamp of the most recent activity plus counts of open plans, uncommitted files, and pending tasks pulled from the ledger. Done when the endpoint returns a stable JSON shape for all six projects and is covered by a test with fixture data."},{"title":"Compute a quiet/on-fire status per project from the activity signal","project":"hisho","priority":1,"body":"Turn the raw activity signal into a coarse status (quiet, warm, on-fire) using thresholds on recency and open-work volume, with the thresholds defined in one place. Done when each project resolves to exactly one status and unit tests cover the boundary cases."},{"title":"Render a status strip on the panel showing every project's quiet/on-fire state","project":"gehirn","priority":2,"body":"Add a compact strip at the top of the panel that shows each project as a colored chip reflecting its status, with the project name and a tooltip of the underlying counts. Done when the strip loads from the status endpoint and visibly distinguishes quiet from on-fire projects in a manual check."},{"title":"Poll the status endpoint and refresh the strip without a full page reload","project":"gehirn","priority":3,"body":"Have the panel re-fetch status on an interval and update the chips in place, showing a subtle stale indicator if a fetch fails. Done when a status change made on the backend appears in the strip within one polling cycle and a failed fetch leaves the last known state visible."}]}
- {"ts":"2026-11-02T01:33:23.363Z","t":"draft","id":1,"stories":[{"title":"Add a per-project activity signal endpoint that returns last-touched timestamp and open-work count","project":"ayamai","priority":1,"body":"Expose a single read endpoint on the platform that, for each registered project, returns the most recent activity timestamp and the count of open items (uncommitted files, open plans, pending intake). Done when the endpoint returns data for all six projects and a contract test pins the response shape."},{"title":"Define quiet and on-fire thresholds as configurable platform settings","project":"ayamai","priority":2,"body":"Add named settings for the quiet cutoff (no activity for N days) and the on-fire cutoff (open items above M or activity within H hours), with sane defaults and a documented precedence order. Done when the thresholds can be changed without a code deploy and the signal endpoint reflects the new values."},{"title":"Compute a per-project heat state from the activity signal","project":"hisho","priority":1,"body":"Have the secretary derive a single heat state per project (quiet, warm, on-fire) from the platform signal and thresholds, keeping the rule in one place. Done when a unit test covers each state boundary and the computed state is exposed for the panel to read."},{"title":"Render a heat strip of all projects on the panel home","project":"gehirn","priority":1,"body":"Add a compact horizontal strip at the top of the panel home showing one chip per project, colored by heat state and labeled with the project name. Done when all six projects appear, colors match the kata tokens, and clicking a chip navigates to that project."},{"title":"Add a heat state token set and chip component to the design library","project":"kata","priority":2,"body":"Define quiet, warm, and on-fire color tokens with accessible contrast and build a reusable heat chip component that consumes them. Done when the tokens and component are documented in the editor and the panel uses the component rather than ad-hoc styles."},{"title":"Show per-project heat and last-activity detail in the seiri project list","project":"seiri","priority":3,"body":"Add a heat column and a relative last-activity timestamp to the existing project list so the strip has a drill-down view. Done when each row shows the state and timestamp, and sorting by heat works."}]}
- {"ts":"2026-11-02T01:33:23.440Z","t":"accept","id":1,"planIds":[18,19]}
- probe
- {"ts":"2026-11-02T01:34:14.788Z","t":"accept","id":2,"planIds":[20]}
- probe three
- {"ts":"2026-11-02T01:34:21.049Z","t":"accept","id":3,"planIds":[21]}
- {"ts":"2026-11-02T01:35:28.055Z","t":"archive","id":2}
- {"ts":"2026-11-02T01:35:28.064Z","t":"archive","id":3}
- project names in gehirn should be clickable, clicking the "seiri" title should open up "seiri" etc
- {"ts":"2026-11-02T01:38:29.442Z","t":"draft","id":4,"stories":[{"title":"Make project titles in gehirn clickable links to their project pages","project":"gehirn","priority":1,"body":"Render each project name in the gehirn project list as a link that navigates to that project's detail page (e.g. clicking \"seiri\" opens the seiri page). Done when every listed project title is a working link and clicking it routes to the correct project route."},{"title":"Add project detail route and page shell for each project in gehirn","project":"gehirn","priority":1,"body":"Create a route in gehirn that resolves a project id (ayamai, gehirn, yoru, seiri, kata, hisho) and renders a basic detail page showing the project name and description. Done when visiting each project's URL renders its page without errors and unknown ids show a not-found state."},{"title":"Style clickable project titles with hover and focus affordances","project":"gehirn","priority":2,"body":"Apply kata tokens so project titles look interactive (hover underline/color, visible keyboard focus ring) while staying consistent with the panel's existing typography. Done when titles are keyboard-focusable, show a clear focus state, and pass a quick visual check against the design tokens."},{"title":"Handle unknown or missing project ids gracefully on project pages","project":"gehirn","priority":3,"body":"When a project route receives an id that does not match a known project, show a friendly not-found message with a link back to the project list instead of crashing or rendering blank. Done when navigating to a bogus project URL shows the fallback and the back link returns to the list."}]}
