# uta — 歌

The music library: what you own, what you saved, and what to play next.

Route `/uta`, port 4670, zero dependencies, no accounts, no cloud.

## Two kinds of track

The design rests on one distinction, and it is not an implementation detail:

| | owned | referenced |
|---|---|---|
| what it is | an audio file on the vault | a Spotify or YouTube link |
| playback | ours — `<audio>`, seek, queue | theirs — we open the link |
| what we know | tags, size, plays | title, artist, artwork |
| why it exists | full control over the bytes | the song you heard elsewhere still counts |

We never download from a streaming service. A reference is a reference: it joins
the library, the history and the taste model, and playing it hands you to the
service that owns it.

## Finding your music

uta does not wait to be told where the music is. On first start, with no index,
it walks **every mounted drive** (`/mnt/c`, `/mnt/y`, `/mnt/z`, ...) for audio,
skipping what is never music: the recycle bin, `Windows`, `AppData`, `.git`,
`node_modules`. The result is `{data}/uta/index.json`.

What makes that usable on a machine with 200,000 files:

- **drives are ordered by likelihood** - one `readdir` per root - so the drive
  with a `Music` folder is walked first and the first track appears in seconds;
- **music-named folders are walked first** inside a drive too;
- **the index is flushed as it goes**, so the library fills while the scan runs;
- **a per-directory cache** makes the second scan seconds, not minutes: a
  directory whose mtime has not moved is not descended into again;
- **it cancels**, and keeps what it found.

`scan` in the library header re-runs it. The walk is `packages/core/scan.mjs`,
shared with yoru.

**Indexed in place, or moved into the vault - your choice.** By default a track
plays from where it already sits. Tick *move the audio into the vault (Y:)* before
scanning and uta copies each file to `{vault}/music/<artist>/<album>/`, verifies
the size, and only then removes the original: a failed copy leaves the source
untouched.

## Where the files live

`{vault}/music/`, beside yoru's `media/`. The vault is `/mnt/y/ayamai` by
default; `AYAMAI_VAULT` overrides it. Audio found on the drives is indexed where
it sits and never copied unless you ask.

Accepted: `.mp3 .m4a .flac .ogg .wav`.

## The library, one page at a time

27,000 tracks is 8.9 MB of JSON and 27,000 DOM rows; nobody wants either. The
library is served in pages and asked for as they are needed:

```
GET /api/library?limit=50&offset=0&q=dark&sort=title
-> { tracks, total, offset, limit, more, query, sort }
```

- `total` is the **filtered** count, so `Showing 50 of 2,284 matching "dark"` is true;
- `q` searches title, artist and album; `sort` is `title` (default), `artist` or `path`;
- `limit` is capped at 200 by `packages/core/page.mjs`, shared with anything else
  that grows.

The page asks for the next 50 when **load more** is pressed, and re-asks from
offset 0 when the search box or the sort changes. The audio player keeps its
current track across all of that.

The index itself is cached by mtime and size: `findTrack` used to parse 7.4 MB on
every range request, and an `<audio>` element makes dozens of them.

## What it reads

mp3 ID3v2.3/2.4 text frames — `TIT2`, `TPE1`, `TALB`, `TYER`/`TDRC` — parsed by hand
in `library.mjs`, because a tag library is a dependency and this is sixty lines.
Everything else falls back to `Artist - Title.ext`, and the row says `filename`
when that is what happened.

## Endpoints

| endpoint | does |
|---|---|
| `GET /uta/api/library` | owned tracks and saved references |
| `GET /uta/media/<path>` | streams a file, **Range included** — seeking needs it |
| `POST /uta/api/plays` | `{id, artist, ms, skipped}` appended to `plays.jsonl` |
| `GET /uta/api/next` | one track and the reason it was chosen |
| `POST /uta/api/links` | `{url}` → service detected, metadata from oEmbed, saved |
| `DELETE /uta/api/links/<id>` | forget a reference |

State is two files under `{data}/uta/`: `plays.jsonl` (append-only) and
`links.json` (rewritten atomically). `cat` them.

## The recommender

Deterministic and explainable, so the reason can be trusted:

```
score = 0.55 · artist affinity   plays by the artist in 30 days, scaled to the top artist
      + 0.25 · staleness         1 / (1 + days since this track last played)
      + 0.20 · novelty           1 if never played, else 0.3
```

Excluded: anything played in the last ten plays **within the current session**
(three hours), and anything played in the last thirty minutes. A play from days
ago is history, not a reason to skip the artist you actually listen to.

`GET /uta/api/next` returns the track and its reason — *"Mariya Takeuchi · you
played them 1 of your max this month · not heard in 9 days"*.

## Saving a link

Paste a URL; the host decides the service and the id. Title, artist and artwork
come from the public oEmbed endpoints — no API key, no OAuth, no scraping:

- `https://www.youtube.com/oembed?format=json&url=…`
- `https://open.spotify.com/oembed?url=…`

If the fetch fails the link is still saved, with the URL as its title and
`metadata: false`, because a link you meant to keep is worth more than a clean
failure.

## Not in this version

- **Spotify OAuth** — top tracks and recently played would seed taste on day one.
- **YouTube search** — adding a reference by name instead of URL.
- **A cross-kind queue** — owned and referenced interleaved, with Spotify's Web
  Playback SDK on Premium.
- **Radio** — `next` seeded from a chosen track.

## Tests

`library.test.mjs` and `recommend.test.mjs`: ID3 parsing from a hand-built tag,
filename fallback, stable ids across a rescan, a missing folder, link
identification, oEmbed mapping, and the scorer's determinism, its session guard,
and its reasons.
