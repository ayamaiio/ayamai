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

## After you edit a service, restart it

A running process keeps the code it started with. `ayamai doctor` has a **code
freshness** check that compares each service's start time with the files it serves,
and gehirn marks a stale service with a badge — restart the service (`ayamai down
<id>` then `ayamai up <id>`, or the command its row shows) and the badge clears on
the next poll.

## Which mode you are in

The owner names a mode — art, CTO, product, incident, research — and it changes what a
good answer looks like, never what you may do. [docs/MODES.md](docs/MODES.md) has the
table; engineering is the default.

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
