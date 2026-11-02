# gehirn — the control panel

NERV's predecessor; German for brain. Catalog entry: `gehirn`, kind `panel`.

## What it is

The page at `/gehirn`. It watches the machine and lets you operate it: projects, services, actions, the model console, docs and code.

## Screens

- **projects** — the catalog: name, kind, version, install path (click to copy), docs, a code browser, VS Code and Explorer buttons, a liveness dot where the project has services
- **repos** — the machine-wide git scan, branch and dirty counts
- **services** — every known service with port, latency, `open`, `run`/`stop`, and `sweep` for the pixiv agent
- **actions** — the last things you did, with the argv that ran
- **machine** — containers, agent sign-in, LAN address, uptime, sweep progress
- **model** — provider, model, base URL, key (stored 0600), prompt, answer with latency and tokens

## Endpoints

```
GET  /gehirn/api/status      snapshot for the panel
GET  /gehirn/api/catalog     the three projects, resolved
GET  /gehirn/docs/<id>/<doc> rendered markdown, catalog-allowlisted
GET  /gehirn/files/<id>/...  read-only tree and files, traversal-safe
POST /gehirn/open/editor     VS Code at the entry (x-cockpit guarded)
POST /gehirn/open/reveal     Explorer at the entry
POST /cockpit/api/*          actions, llm, sweep (guarded)
```

## Where it lives

`packages/gehirn`; runs on 4490 behind the door at `/gehirn`.

## Extending it

A new panel section is markup plus a renderer in `page.mjs`; a new endpoint goes in `entry.mjs` next to the others. Anything that launches a process must sit behind the action guard.
