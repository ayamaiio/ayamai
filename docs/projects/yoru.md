# yoru — the media project

The first project that runs on ayamai. Catalog entry: `yoru`, kind `project`; manifest: `projects/yoru/project.json`.

## What it is

The media library: the loop, the reader, the intake. Private by design, local by default.

## What it owns

| piece | path | role |
|---|---|---|
| app | `projects/yoru/app` | the React front end, served at `/yoru` |
| api | `projects/yoru/api` | express, auth, media, imports, served at `/api` |
| db | `projects/yoru/db` | drizzle schema, Postgres in Docker on 5434 |
| curator | `projects/yoru/curator` | the labelling queue, `/curator` |
| design system | `projects/yoru/design-system` | tokens and components |
| brand mark | `/ui/brand/` | the shared logo, served by the door |
| contracts | `projects/yoru/api-{spec,zod,client-react}` | API types and clients |

The vault lives outside the repo, on its own disk: `/mnt/y/ayamai`.

## Running it

```bash
python3 scripts/local-dev.py start        # api + web
node packages/cli/index.mjs up yoru       # the same, from the catalog side
```

## State

Import and playback work; the loop plays vertical snap with collections, the manga shelf and reader are in; pixiv intake runs through the agent (`sweep` in gehirn).

## Next

- auto-start at login
- the library's own documentation page (moved from the media-era docs)
