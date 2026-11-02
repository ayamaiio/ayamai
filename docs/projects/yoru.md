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

## The watch feed: gestures and signals

`/feed` is a vertical snap scroller of full-screen slides. One post can hold a
collection (`pages[]`), which is why there are two axes.

| gesture | does |
|---|---|
| scroll / `j` `k` / arrows | next or previous post |
| **click the media** | next page of the collection; on the last page, the next post |
| swipe | the same, for touch |
| `c` or the corner eye | hide or show the whole menu — remembered in `localStorage` |
| **`/feed?play=1`** | **consumption mode**: the media and nothing else — no header, rails, counter, depth bar, scrims or hints (the cursor stays, it is not chrome); `c` or `Escape` restores everything and drops the flag from the URL |
| `m` | mute |
| `x` | dismiss (writes a `dislike` signal) |
| heart button | save to favourites |

Double-click-to-save was removed: it cannot coexist with click-to-advance.

**Videos** carry the browser's own controls (`controls playsInline`), so play,
pause and seek are the ones the platform already provides. Clicking a video plays
or pauses it; advancing past it goes through the post navigation.

### What the feed reports

Every visit is timed. Under 1.2 s is reported as `quick-skip`, above it as
`dwell` with the seconds — the API caps quick-skips at three a day and caps dwell
at the elapsed time, so a fast scroller cannot inflate anything. Video slides
report `progress` on pause and `complete`/`replay` at the ends.

These land in `watch_signals` (`watched_seconds`, `quick_skips`, `completions`,
`replays`) through `POST /watch/media/:id/event`. The feed query already hides
anything marked `dislike`; it now also hides media skipped instantly three times,
which is the first place this data changes what you are shown. Ranking itself is
still the fixed bucket weighting.
