# Product

**What ayamai is, in one page.** Everything else links here instead of restating it.

## Who it is for

One person, one organization, six projects. **ikari** owns the **ayamai**
organization; every project belongs to that organization. The relationship is data
— `people`, `organizations` and `entries[].org` in [catalog.json](../catalog.json)
— not a permission system: it says who this is *for*, so the panel, the CLI and an
agent's brief can all answer "whose is this" without a second source.

## The three projects

| | | |
|---|---|---|
| **ayamai** | the ecosystem | installs on a machine, opens one door, holds the model keys, gives tools a local API |
| **gehirn** ゲヒルン | the control panel | the page at `/gehirn`: projects, services, actions, the model console |
| **yoru** 夜 | the first project | the media library — the loop, the reader, the intake — mounted at `/yoru` |

Alongside them: **seiri** (整理) the board, **kata** (型) the design library, and **hisho** (秘書) the agent harness. ayamai is the platform; gehirn is how you operate it; yoru is proof that a project can live on it. yoru is not special-cased: it is a manifest, a route and a directory, and a second project would be added the same way.

## What we are building

**A local-first agent platform.** One machine, one address (`http://ayamai.local`), one door. Tools — a browser extension today, an editor extension, one day our own browser — ask the machine to do things through a named-capability API instead of each inventing its own way in.

**An environment that reproduces itself.** The point of `ayamai install` is that a new computer ends up configured like the last one: the same door, the same projects, the same keys, the same diagnostics.

**A place for projects.** yoru is the first. The platform's job is to make the second one cheap: a manifest, a catalog entry, a route, and it is mounted, listed, documented and startable.

## The shape of a project

Two files, two different jobs:

- `projects/<id>/project.json` — the **manifest**: what can be *run*. Services, ports, routes, requirements. The gateway builds its route table from these.
- `catalog.json` — the **catalog**: what is *ours*. Name, kind, paths, docs, links. Gehirn renders it; `ayamai projects` prints it.

They meet at `registryProject`. ayamai and gehirn have catalog entries and no manifest; yoru has both.

## Principles

- **Local first, cloud optional.** The machine owns the data and the process. GitHub, a package registry or a bucket may make install easier; nothing stops working when the network does.
- **One door.** Every surface answers on `http://ayamai.local` by path. Ports are how processes find each other, not something a person types.
- **Expose the mechanism.** A route table, a manifest, a log line, a command — these are interfaces. A view widens access to them; it does not replace them.
- **Both surfaces, one truth.** `ayamai status` and gehirn read the same registry. `catalog.json` drives the panel and the CLI. If two things can disagree, one of them is wrong.
- **Design for people who already understand computers.** Say what broke, where, and with what. No reassurance, no marketing voice.
- **The agent holds the keys.** A model key never leaves the machine, and a tool never holds one.

## Non-goals

- Not a SaaS. No accounts for strangers, no hosted tenancy, no billing.
- Not a public site. The door is loopback by default; the phone reaches it over your own network.
- Not a monolith: gehirn can be down while yoru works, and yoru can be down while the door still serves.

## The toys

board, arcade, the Game Boy, the plan store and the self-hosted git are **toys**. They hang off the door (`/board`, `/arcade`, `/gb`), they are allowed to break, and when a choice costs the product a day to make a toy nicer, the product wins.

## Where to go next

- How the pieces fit: [ARCHITECTURE.md](ARCHITECTURE.md)
- How to run it: [OPERATIONS.md](OPERATIONS.md)
- The projects, one page each: [projects/platform.md](projects/platform.md), [projects/gehirn.md](projects/gehirn.md), [projects/yoru.md](projects/yoru.md)
- Why we build at all: [philosophy/WHY-WE-BUILD.md](philosophy/WHY-WE-BUILD.md)
