# kata — 型

The design library. Catalog entry: `kata`, kind `project`; manifest: `projects/kata/project.json`.

## What it is

One place that owns the design tokens, shows every component in the shared kit, and lets you change a token in the browser so that every surface follows. It replaces the role Storybook (`apps/magi`) played, without a second toolchain.

## The token source

`projects/kata/tokens.json` (`$schema: ayamai/tokens@1`) holds `color`, `typography`, `radius`, `spacing`. It is the only place a value is written by hand.

`node projects/kata/build.mjs` renders it, deterministically, into:

| output | consumed by |
|---|---|
| `ui/tokens.css` | `ui/ui.css` and `ui/brand.css`, and through them every product |
| `projects/kata/public/tokens.css` | the showroom itself |
| `projects/yoru/design-system/src/generated/tokens.css` | yoru's Tailwind `@theme` |

Every file carries a `generated … do not edit` banner. A test re-renders in memory and fails if a committed file drifts.

## The showroom

`GET /kata/` — foundations (colour swatches, the three type families, radii, spacing), every component in `catalog.mjs` with a live preview and a copyable snippet, and an editor: one row per token, `apply` writes `tokens.json` and regenerates the stylesheets on the spot.

## Endpoints

```
GET  /kata/api/state      tokens, the component registry, artefact list
GET  /kata/css/tokens.css the generated stylesheet
POST /kata/api/token      { path: "color.rei", value: "#a9b7e8" } — guarded
```

Writes require `x-cockpit: 1` and an allowed origin, are schema-validated before touching the file, and are written atomically. `git diff` is the undo.

## The brand

The logo and the wordmark are part of this kit: `ui/brand/mark.png` for the art,
`ui/brand.css` for the rules and the three typefaces, `ui/brand.mjs` for the
markup. A product uses `brand({ tool, jp })` and links `/ui/brand.css`; a test
fails if a page defines its own `.brand` styles or loads fonts itself.

## Adding a component

Add an entry to `catalog.mjs` — `name`, `classes`, `note`, `markup` — and prove it exists in `ui/ui.css`. The registry is explicit; nothing is discovered by scanning.

## Where it lives

`projects/kata`; runs on 4600 behind the door at `/kata`.

## Next

- React previews from yoru's design system, rendered beside the plain-CSS kit
- retire `apps/magi` once every story has a kata entry
- token history (`git log -p projects/kata/tokens.json` is already the record)
