# Tool Responsibilities

These tools support one product process. They are not competing sources of truth.

## ChatGPT — Product Headquarters

Use for:
- Brainstorming and concept exploration
- Product vision and strategy discussions
- Clarifying user experience and requirements
- Challenging assumptions and comparing options
- Prioritization recommendations
- Drafting feature briefs and decision records
- Preparing implementation handoffs
- Reviewing work against product intent

The **Ayamai Product Strategy** Product HQ conversation (`6ae544a3-d244-83ea-9830-de619895178a`) sets product direction. Write approved decisions into this repository for durable execution context. The owner's latest explicit instructions take precedence over older records, subject to applicable higher-priority instructions and safety/security constraints; see [AGENTS.md](../../AGENTS.md). Exploration in any tool is not approval.

## GitHub — Durable Knowledge and Source

Use for:
- Version-controlled product handbook and approved specifications
- Decision records and technical documentation
- Application source code
- Reviewable change history
- Links and context for implementation agents

The `product/` directory is the durable home for product process and product knowledge. Do not duplicate the entire Linear backlog here.

## Linear — Committed Execution

Use for:
- Approved work items
- Priorities and execution status
- Projects and milestones
- Dependencies and implementation tracking
- Links to briefs, designs, pull requests, and decisions

Do not use Linear as a dumping ground for raw brainstorming. Keep one team and a lightweight workflow unless the project genuinely outgrows it.

## Figma — Visual Design

Use for:
- UX exploration and screen concepts
- Interaction flows and prototypes
- Design system, components, and visual specifications
- Reviewing and iterating on visual direction

A Figma exploration is not automatically an approved design. Label explorations clearly and link approved designs to the relevant feature brief or Linear issue.

## Local development and AWS Lightsail

Use the Windows/WSL checkout for implementation, running, debugging, and verification. GitHub is the canonical source; AWS Lightsail is the configured deployment target. Follow the repository runbooks and report what changed, what was checked, and what remains uncertain. Replit is no longer an active project tool; older Replit records are retained as history.

## Other specialized agents and tools

Use when they provide a clear advantage for a bounded task such as research, code review, infrastructure analysis, or testing. They do not independently set product direction or approve scope.

## Cross-tool linking

When work moves between tools, link the relevant artifacts rather than copying large amounts of content:
- Linear issue → feature brief, Figma design, relevant decision, pull request.
- Figma design → feature brief and Linear issue.
- Pull request → Linear issue and relevant specification.
- Session handoff → current active discussions and canonical documents.

## Delivery and coordination

Follow root [AGENTS.md](../../AGENTS.md) as the single operating policy for
isolation, scope, verification and delivery. Its updated coordination rules
supersede the earlier automatic merge/deploy standing permission: require explicit
owner authorization for those actions on the task. A PR-only request ends at the
PR; updating main triggers Lightsail deployment. Preserve unrelated dirty work.
