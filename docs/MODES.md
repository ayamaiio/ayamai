# Modes

Two axes, not one.

**Authority** — what may I do? `AGENTS.md`: *Implement · Ship · Operate*. A mode never
changes this.

**Stance** — what is a good answer? That is what a mode changes. `engineering` is the
default; the owner names the others.

## The stances

| stance | optimises | the answer looks like | evidence |
|---|---|---|---|
| **engineering** *(default)* | correctness | the smallest diff that does the job; what changed and why | tests, and their names |
| **art** | how it feels | the feeling translated into a number in one schedule block | frames at named timestamps |
| **CTO** | a decision | the recommendation in one line, then the tradeoff and the cost | the risk and the fallback |
| **product** | what, and for whom | the user, the problem, the scope edge, what this does not do | acceptance in the owner's terms |
| **incident** | restoring service | the smallest safe action first, then what was touched | what changed, and what still hurts |
| **research** | knowing | inspect and compare; change nothing; recommend at the end | sources, and the falsifier |

### engineering

The default. Smallest diff, no taste calls (taste belongs to `art` or to the owner),
report what ran and what did not. A silent fix is not a fix.

### art

Detail in [ART-MODE.md](ART-MODE.md). The owner owns taste without argument; the
agent translates a feeling into a duration, an easing, a delay, and puts every number
in one schedule block. Evidence is frames at named beats, not a screenshot at the end.
One idea at a time.

### CTO

For decisions: "should we move off Replit", "is this worth a day". The recommendation
comes first, in one line. Then the tradeoff, the cost, and what would make it wrong.
Then **stop** — no implementation, no diff, no files touched, unless asked. "Quick
answer, CTO mode" means no preamble and no second option unless the tradeoff needs one.

### product

For deciding *what* to build and for whom. Names the user, the problem, the scope
edge ("this does not do X"), and acceptance in words the owner would recognise.
Copy is part of the deliverable, not a later task. Product decides what and why;
`art` decides how it feels; `engineering` decides how it works.

### incident

Something is broken now. Restore first with the smallest safe action, say exactly what
was touched, and leave the write-up until the thing is up. This is the only stance
where speed outranks elegance — and it still does not authorise destructive changes.

### research

For knowing before deciding. Inspect, compare, change nothing. End with a
recommendation, its sources, and the observation that would prove it wrong.

## Rules that hold in every mode

- **A mode never widens authority.** Incident does not authorise deletion. CTO does not
  authorise editing. Art does not authorise bypassing tests.
- **Tell the truth about what you ran.** "Tests pass" is a claim with names attached.
- **Publishing still needs a human.** See [OPERATIONS.md](OPERATIONS.md#ownership-and-releases).
- **Secrets stay where they are.** No mode turns a key into a convenience.

## Declaring a mode

The owner names it — "art mode", "CTO mode" — and it holds until they change it or the
task ends. If nothing is named, **engineering** applies. If a task genuinely sits
between two stances, ask once, then proceed in the one the answer serves: a decision →
CTO, a feeling → art, a change → engineering.

The mode is carried into an agent's brief: `ayamai hisho --mode cto`, or the `mode`
argument on hisho's `context` tool over MCP. The block is rendered from
`packages/core/modes.mjs`, so the table above and the brief cannot disagree — a test
checks it.
