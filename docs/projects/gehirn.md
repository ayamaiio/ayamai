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

## Endpoints

```
GET  /gehirn/api/status      snapshot: catalog, services (+ their project), children, plans, machine, llm
GET  /gehirn/api/catalog     the catalog, resolved
GET  /gehirn/docs/<id>/<doc> rendered markdown, catalog-allowlisted
GET  /gehirn/files/<id>/...  read-only tree and files, traversal-safe
POST /gehirn/open/editor     VS Code at the entry (action-guarded)
POST /gehirn/open/reveal     Explorer at the entry
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
