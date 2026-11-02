# gehirn — the control panel

NERV's predecessor; German for brain. Catalog entry: `gehirn`, kind `panel`.

## What it is

The page at `/gehirn`. It watches the machine and lets you operate it — and it has
two levels, both with real URLs: the platform, and one project.

| URL | what it shows |
|---|---|
| `/gehirn/` | **ayamai**: the machine, the platform's own services, the projects beneath, repos, vault |
| `/gehirn/<project>` | **that project**: its services, its links, its open work, and its children |

Clicking a project's name moves it to the top level; the breadcrumb (`ayamai /
gemu`) walks back. A project with no children shows no children section, and an
unknown id renders the platform view with a `no project "x"` note and a 404.

## The views

Every service names its project (`packages/gehirn/services.mjs`), and the snapshot
groups them once, so the page never invents the mapping:

- **services** — the platform's five on the platform view (there is an
  `all services` toggle for the old flat list); a project's own on its view
- **children** — from the registry: gemu's eight emulators, each row expanding in
  place to upstream repo, license, pinned tag, patch count, fork and a link to
  `/gemu/<id>/`
- **work** — the project's open plan items, read from the plan store directly, so
  the panel survives seiri being down
- **machine** — containers, agent sign-in, LAN address, uptime
- **model** — provider, model, base URL, key (stored 0600), prompt, answer with
  latency and tokens
- **repos / vault** — the machine-wide git scan and the media vault, shown on the
  platform view only

## Getting around it

- **`/`** (or `Ctrl/Cmd-K`) opens a **jump palette**: type a project or service,
  `↑`/`↓` to move, `↵` to go. Projects come first because that is what the panel is
  usually for.
- The header says `N / M up · <what is down> · <n> stale`; **clicking it** filters the
  services panel to what is down or stale and back.
- The services panel has a **filter box**, sorts **down → stale → name**, and a stale
  service grows a **restart** button (stop, then start).
- The **actions** log is one line until you click it; the choice is remembered.

### Is anything stale?

`GET /gehirn/api/freshness` answers the question the services panel cannot: not
"is it up" but "has anyone touched it". For each project: the last commit (one
`git log -1` per project, cached a minute), how many items are open, and when the
platform last released. Each project card carries the line, and anything quiet for
14 days or more is marked `neglected`.

### One button per project

Each project card carries its own state and a single button: `start` when anything
is down, `stop` when everything is up. It runs the same commands the per-service
buttons do, in dependency order (`db → api → web → curator → agent`), and stops in
reverse. It waits for the ports afterwards, so `yoru: 2 of 5 up after start` means
exactly that — a launcher exiting zero is not a service answering.

A project with nothing gehirn can start (a service with no launcher, or `self`)
gets no button, and a project whose dependencies are missing says so on the chip
instead of offering a press that cannot work.

## Endpoints

```
GET  /gehirn/api/status      snapshot: catalog, services (+ their project), children, plans, machine, llm
GET  /gehirn/api/catalog     the catalog, resolved
GET  /gehirn/docs/<id>/<doc> rendered markdown, catalog-allowlisted
GET  /gehirn/files/<id>/...  read-only tree and files, traversal-safe
POST /gehirn/open/editor     VS Code at the entry (action-guarded)
POST /gehirn/open/reveal     Explorer at the entry
POST /gehirn/api/project     {id, action} — start/stop/restart a whole project
POST /gehirn/api/*           actions, llm, sweep (guarded; the header is historical)
```

## Where it lives

`packages/gehirn`; runs on 4490 behind the door at `/gehirn`. The page is one
server-rendered document that polls the snapshot every five seconds; the view is
decided from `location.pathname`, so a bookmark or a refresh keeps it.

## Extending it

A panel section is markup plus a renderer in `page.mjs`; a new endpoint goes in
`entry.mjs` next to the others; a new service gets `project:` in `services.mjs`.
Anything that launches a process must sit behind the action guard.
