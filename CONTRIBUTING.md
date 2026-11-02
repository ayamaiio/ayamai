# Contributing

This is a private, invite-only project. If you have access, this is how to work
in it without breaking the parts that are load-bearing.

## The one rule

**Work goes to the local mirror.** `git push box packaged`. The org repository
(`origin`, `github.com/ayamaiio/ayamai`) is release-only: `ayamai publish`
squashes the tree into a single commit and cuts a release. A pre-push hook
refuses anything else, by design — GitHub is cold storage, not a sync service.

## Getting it running

```bash
./scripts/install.sh          # or scripts\install.ps1
ayamai up                     # the door and its projects
ayamai doctor                 # diagnoses what is missing
```

Then `http://ayamai.local`. Each product also runs alone:
`BASE_PREFIX=/seiri node projects/seiri/index.mjs`.

## Before you push

```bash
pnpm typecheck
pnpm test          # every suite: platform, products, tools, ui, docs
pnpm check:docs    # no dead links
```

CI runs exactly this. If a test fails because the behaviour changed on purpose,
change the test in the same commit — never leave a red suite for the next person.

## Where things go

| you are adding | it goes in |
|---|---|
| a product | `projects/<id>/` with a `project.json` manifest, plus a `catalog.json` entry and `docs/projects/<id>.md` |
| a platform capability | `packages/<name>/`, with a test beside the code |
| something an agent should know | `AGENTS.md`, or the product's doc |
| a visual decision | `ui/tokens.css` first, then the component |

A product is registered, not imported: the gateway builds its routes from the
manifests, so nothing else needs editing.

## Documentation is part of the change

Every behaviour change updates the doc that describes it — `docs/projects/<id>.md`
for a product, `docs/ARCHITECTURE.md` for the platform, `docs/OPERATIONS.md` for
how to run it. `node scripts/check-docs.mjs` fails on dead links; the drift test
fails when a doc's port no longer matches its manifest.

Wording: say what the code does now. If something was retired, say it is retired
rather than describing it in the present tense.

## The brand

One logo: `ui/brand/mark.png`. One stylesheet: `ui/brand.css`. One renderer:
`ui/brand.mjs`. Every surface uses them; no page keeps its own copy. The public
page is the single exception — `scripts/deploy-site.mjs` copies the files into
`site/brand/` at deploy time.

## Designing a surface

Pacing, motion and brand moments are governed by
[docs/ART-MODE.md](docs/ART-MODE.md): the owner owns taste, the numbers live in
one schedule block, and the evidence is frames at named beats. Read it before
changing an animation.

## License

Contributions are under [FSL-1.1-MIT](LICENSE.md): source-available, becoming
MIT two years after each release.
