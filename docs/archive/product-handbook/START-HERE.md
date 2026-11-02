# Ayamai Product Handbook

**Purpose:** The durable source of truth for Ayamai's product direction, collaboration process, decisions, and handoffs.

## Foundational principle

Read [Why we build](../docs/philosophy/WHY-WE-BUILD.md) first. Build for art,
technology, ourselves and friends; protect creative independence, curiosity and
genuine community. Money should sustain the product. This applies across all
agent tools and hosts.

## If you are a new AI agent or contributor

1. Read the repository [agent operating policy](../AGENTS.md), then this file.
2. Read [How We Work](handbook/HOW-WE-WORK.md).
3. Read [Product Process](handbook/PRODUCT-PROCESS.md).
4. Read [Tool Responsibilities](handbook/TOOL-RESPONSIBILITIES.md).
5. Read [AI Agent Guidelines](handbook/AI-AGENT-GUIDELINES.md).
6. Read [Product Vision](vision/PRODUCT-VISION.md).
7. Read [Current State](operations/CURRENT-STATE.md) and [Session Handoff](operations/SESSION-HANDOFF.md).
8. For visual work, read the approved [North Star identity](../docs/design/visual-identity.md), [implementation guide](../docs/design/implementation-guide.md), and [design checklist](../docs/design/design-checklist.md).
9. Read relevant idea briefs and decision records before making recommendations.

## Critical rule

**Discussion is not approval. Brainstorming is not authorization.**

Do not turn casual comments, hypotheticals, suggestions, or exploratory ideas into requirements, roadmap commitments, architecture decisions, Linear issues, Figma specifications, or implementation instructions unless the owner explicitly approves that promotion.

When uncertain, preserve the idea as exploratory and ask.

## Source-of-truth hierarchy

- Applicable higher-priority instructions and safety/security constraints govern all work.
- Within project authority, the owner's latest explicit instructions supersede older decisions, documentation, comments, and agent-specific preferences.
- Product direction: Product HQ, the **Ayamai Product Strategy** conversation (`6ae544a3-d244-83ea-9830-de619895178a`). Approved vision and decision records preserve that direction durably; record new decisions and what they supersede.
- Current exploration: `product/ideas/`, clearly labeled by status.
- Execution and status of committed work: Linear.
- Visual design and prototypes: Figma.
- Application source and implementation facts: inspected repository code and technical documentation. Code and infrastructure are inherited starting points, not immutable authority over authorized changes.
- Current operational snapshot: `product/operations/CURRENT-STATE.md`.

Identify conflicts. Follow a newer explicit owner instruction when it resolves the conflict, and document the supersession; do not ask for the same approval again. Ask the owner when intent, authority, or consequential scope remains unclear. If conversation history is unavailable, use approved records and current explicit instructions without inventing missing approvals.

## Product owner

The project owner is the final decision-maker for product direction, scope, priorities, tradeoffs, and approval to implement.

## Status vocabulary

- **Raw idea:** Captured, not evaluated.
- **Exploring:** Being discussed; no commitment.
- **Candidate:** Worth considering, but not approved.
- **Approved direction:** Explicitly accepted as product direction.
- **Committed:** Authorized for planning and execution.
- **Implemented:** Built and reviewed.
- **Parked:** Deliberately deferred.
- **Rejected:** Decided against.

See [Product Process](handbook/PRODUCT-PROCESS.md) for promotion rules.

## Current explorations

- [Ayamai Brand Direction](ideas/brand-direction.md) — historical exploration; visual decisions superseded by the approved [North Star v1](../docs/design/visual-identity.md). Broader unapproved ideas remain exploratory.
