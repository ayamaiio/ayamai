# hisho — 秘書

The secretary. An agent connects, receives the brief, claims the next item, and
works with tools that stay inside the repo. Catalog entry: `hisho`, kind
`project`; manifest `projects/hisho/project.json`.

## What it is

An MCP server with two transports:

| transport | entry | auth |
|---|---|---|
| stdio | `projects/hisho/stdio.mjs` | none — anyone who can spawn it is the user |
| HTTP | `POST /hisho/mcp` | `x-ayamai-token` from `{data}/agent-token` |

## The brief

`context` renders a ~6k-token pack: identity (PRODUCT), how it fits
(ARCHITECTURE), running it (OPERATIONS), rules (AGENTS), current state, the open
queue, and the claimed task. Every section is capped; the order is stable.

## The tools

- **read** — `context`, `project.list`, `project.status`, `file.read`,
  `file.list`, `search`, `plan.list`
- **write** — `file.write` (returns a diff summary), `plan.next`, `plan.claim`,
  `plan.release`, `plan.done`, `plan.update`
- **model** — `model.ask`, the key you stored in gehirn's console, with the brief
  attached by default
- **ideas** — `idea.capture` (throws one into seiri's inbox) and `idea.list`
- **run** — `test`, `verify`, `docs-check`, `git-status`, `git-diff`, `git-log`

Resources expose PRODUCT, ARCHITECTURE, OPERATIONS, AGENTS and the catalog whole.
The `next-task` prompt claims an item and returns its brief in one call.

## The queue

The plan store gained `assignee` and `leaseUntil`. `plan.next` takes the highest
priority, lowest id open item and leases it; an expired lease reads as free, so a
crashed agent cannot wedge the queue. `plan.done` appends the agent's summary to
the item's body — the record of what was actually done.

## With seiri

The board and the harness share one log. A claim made on `/seiri/` is the same
lease the agent sees; an agent that claims an item appears on the board with a
countdown, and can be released from either side.

## Safety

Paths resolve inside the repo; `.git/`, `node_modules/`, the data root, `.env*`
and key files are refused. Commands come from an argv allowlist in code — no
shell, no widening. Every call is one line in `{data}/hisho-audit.jsonl`. The
harness never commits or pushes.

## Where it lives

`projects/hisho`; runs on 4650 behind the door at `/hisho`. The desk at `/hisho/`
shows what is claimed, what is free, and the last dozen calls.
