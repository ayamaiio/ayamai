# seiri — 整理

The work in order. Catalog entry: `seiri`, kind `project`; manifest: `projects/seiri/project.json`.

## What it is

A single page that answers “what is going on”: the plan store, the repositories on this machine, what is uncommitted, and the vault's activity. It is the board we had, promoted out of `toys/`.

## What it reads

| source | what |
|---|---|
| `toys/plan/plan.mjs list --all --json` | every plan item, sorted by priority then id |
| `git` under `$HOME`, depth 3 | branch, dirty count, last commit |
| `toys/plan/plan.mjs dirty` | which plan each uncommitted file belongs to |
| `/mnt/y/ayamai/state/activity.json` | recent activity from the box |

## What it writes

One thing, through `POST /seiri/api/plan` (guarded by `x-cockpit` and an allowed origin):

- `set-status` — `{ id, status }` where status is `todo · doing · blocked · done`
- `add` — `{ title, priority 1-4, project }`
- `claim` — `{ id, by?, ttl? }` — defaults to `operator`, 30 minutes
- `release` — `{ id }`

## Ideas

The capture card at the top of the board takes a half-formed idea. `remember`
keeps it in the inbox (`.plan/ideas.jsonl`) and creates nothing; `unpack` asks the
stored model to propose 1–6 stories, which appear as editable drafts — tick the
ones you want, press `create`, and only those become plan items. Each created item
carries `idea:<id>` and the idea records `unpacked → #12, #13`.

The model is injected (`ask`), so the parsing rules are tested without a network:
a bad project, an empty title, priority outside 1–4 or a reply that is not JSON
are all dropped with a reason. A failed unpack leaves the idea exactly as it was.

## Dispatch

A free row shows `→`: it claims the item as `operator` and gives you the two lines
to paste into Claude or Cursor (the MCP registration and the instruction for that
item). A claimed row shows `holder · 29:53` counting down against the lease, and
`×` releases it. When a lease expires the next poll returns the item to the queue
on its own — the countdown is a display, the server is the truth.

The clipboard API does not exist on `http://ayamai.local` (not a secure context),
so the fallback selects the lines and says `select and copy`.

Arguments are validated before any process starts, then handed to the plan tool with `execFile` — no shell.

## Projects

A rail of every catalog project with its open count, above the status chips.
Both filters compose: `yoru` + `doing` shows only that. The choice persists in
`localStorage`; `all` is the default. The rail is catalog-driven — a new project
appears because it is registered, not because seiri knows about it. Items with no
project, or a name that is not a project, collect under `other`.

The old media-era areas (`box`, `library`, `product`, `gb`, `tooling`) were
relabelled once by `scripts/plan-projects.mjs`, which appends `set` events to the
plan log rather than rewriting history.

## Interface

- **plans** — filter chips, `#id · Pn · project · title`, glyph per status, one-click `D`/`B`/`>` actions; `j`/`k` move, `d` done, `b` blocked
- **repositories** — the git scan, dirty counts
- **uncommitted** — the plan each changed file belongs to
- **activity** and **box** — what the vault says, plus the open/done/dirty counts

## Where it lives

`projects/seiri`; runs on 4460 behind the door at `/seiri`. `/board` 308s here.

## Next

See the improvement list in `docs/projects/seiri.md` history: since-last-visit diff, dirty drill-down into gehirn's file viewer, agent and sweep status, search, dependencies, GitHub mirroring, per-item history from the event log, a doctor banner, and a one-column phone layout.
