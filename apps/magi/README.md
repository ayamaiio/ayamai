# MAGI â€” Project 001: Foundation

Ayamai's local Storybook React/Vite environment. Uses the existing pnpm workspace;
there is no Turborepo configuration to extend, and no new orchestrator is needed.

## Run locally

Use Node 24.11.0 and pnpm 10.34.9 (matching repository CI), then from the repo root:

```sh
pnpm install --frozen-lockfile
pnpm magi
# equivalent: pnpm --filter magi storybook
```

Open http://localhost:6006. The server binds to loopback, requires no API, Clerk,
database, secrets, or production connection, and stops with Ctrl+C.

```sh
pnpm --filter magi typecheck
pnpm --filter magi build
pnpm typecheck
pnpm --filter @workspace/private-media-library test
```

Static build output: `apps/magi/storybook-static` (ignored). No publishing or
production deployment is configured. Root recursive build includes MAGI; root
typecheck includes apps. Font assets are bundled, so no Google Fonts requests are needed.

## Source of truth and coverage

- Palette: imports generated tokens from `@workspace/ayamai-design-system`.
  Approved dark values: #0B0D14, #202A5A, #A9B7E8, #E6ECFF, #E53935.
- CSS: imports the actual media library global stylesheet, which imports the
  existing design system stylesheet. Tailwind scans the real shared components.
- Spacing/radii: existing token values plus existing CSS radius variables.
- Icons: existing lucide-react family; representative product icons documented.
- Branding: original app BrandMark component plus unmodified approved raster
  files served directly from the application's public/brand directory.
- 12 shared component pages: Button, Badge, Input, Textarea, Checkbox, Switch,
  Slider, Progress, Skeleton, Avatar, Tabs, Card. These import real components,
  never story-only approximations. Autodocs and controls are enabled.
- Three compositions: searchable/savable synthetic media cards with controls,
  empty collection, and import summary. These assemble shared primitives and
  are explicitly exploratory, not copies of API-backed live screens.
- Typography: locally packaged Bodoni Moda and Space Grotesk candidates,
  compared with the unchanged current stack. These are not final or approved.
  Fontsource packages include font license files; retain them when distributing.

Use the theme toolbar for existing dark/light themes. Story-specific typography
never changes the shared tokens or live app. No landing composition, branding,
API behavior, or authentication code is modified.

## Eventual shared UI package

Keep stories dependent on the current package exports. A later approved
`@ayamai/ui` extraction can move those implementation modules and update imports
without rebuilding a parallel component system. This project deliberately makes
no broad extraction or design-system token changes.

## WSL worktree

Implemented in `/home/markfoster314/ayamai-magi` on `feat/magi-foundation`, isolated
from the dirty `/home/markfoster314/ayamai` checkout. To run that exact worktree:

```sh
cd /home/markfoster314/ayamai-magi
export PATH=/home/markfoster314/.nvm/versions/node/v24.11.0/bin:$PATH
pnpm magi
```

Do not switch or reset the original dirty checkout to try MAGI. Preserve its
unrelated changes; use this worktree or a separate clean checkout of the branch.

## Visual decision workflow

Start at MAGI / Project 001 for links to the key studies. Typography playground /
Paired UI compares identical content using **current Inter** and **candidate
Bodoni Moda + Space Grotesk**, with the existing IBM Plex Mono metadata voice.
All three functional faces are locally bundled, including the current baseline;
Bodoni Moda and Space Grotesk weights 400/500/600/700 are loaded explicitly.

- **Compare / Current / Candidate pairing** tabs let you inspect the same library
  side by side or at full width. At mobile widths comparison panels stack.
- Storybook **Controls** adjust editorial heading size (28–64px), weight
  (400/500/600/700), and tracking (-0.04 / -0.02 / 0 / 0.02em).
- Collection Pairing compares editorial headings with functional body/buttons;
  Scale and Rhythm shows fixed 28/36/48/64px headings with adjustable weight/tracking.
- Use **Viewport size** in the toolbar to choose Mobile · 390, Tablet · 768 or
  Desktop · 1440. Main stories remain freely resizable; the two mobile preset
  stories pin their initial viewport, as indicated in Welcome.
- Use the theme toolbar for the actual existing dark/light themes. The unchanged
  pale approved wordmark sits on the existing overlay token in the lab navigation
  so it stays legible in either theme. No asset is recolored or regenerated.

Compositions now include a responsive library/sidebar, native 16:9 / 4:5 / 4:3
synthetic placeholders, grid/list toggles, search, saved filtering, a collection
header/empty state with a local demo note, compact navigation and import summary.
The navigation selection changes the specimen heading only; these are UI studies,
not an alternative router or production Library implementation.

Foundations adds the full semantic color inventory with both theme values and
intended roles, current type scale, icon sizes and interactive component states.
The approved logo/asset story remains unchanged. The separate missing original
North Star UI reference described in the repository design docs is not replaced
or claimed as visually verified.

`src/laboratory.tsx` is only shared story composition, not a new component library.
It imports actual Button/Input/Badge/Card/Tabs and the actual provider-free
BrandMark. A future approved extraction can move real primitives behind
`@ayamai/ui` exports and update these imports; tokens can retain their current
source until a separately scoped migration. Keep fixture state and compositions
in MAGI, and keep auth/API/database providers out of the shared UI layer.
