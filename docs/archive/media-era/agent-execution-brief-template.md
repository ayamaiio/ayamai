# Execution brief template

GPT-6 prepares a self-contained brief after product decisions are agreed. Paste
the completed brief into OpenCode, Codex or another coding agent. Include actual
requirements and decisions; never rely on access to the originating chat.

## Foundational context for the receiving agent

Read [Why we build](philosophy/WHY-WE-BUILD.md) and root [AGENTS.md](../AGENTS.md)
before acting. Include the exact approved quote and relevant guidance in the
completed brief if the receiving agent cannot open repository links.

## Task
- Repository: `markfoster314/ayamai`
- Objective and user-visible behavior:
- Approved decisions, constraints and relevant issue/design links:
- Acceptance criteria (observable, testable outcomes):
- Agent/task identifier and absolute isolated worktree path:
- Owned edit paths; read-only context; overlapping agent/PR and agreed writer:
- Affected packages, shared contracts and dependent consumers:
- Shared-file writer (lockfile/catalog/tokens/schema/CI), if relevant:
- Out of scope:

## Authority and delivery
- Autonomy: Implement / Ship / Operate (choose one explicitly)
- Base revision/branch and proposed feature branch:
- Delivery endpoint: local diff / committed branch / PR / merge / deploy:
- Authorized target environment and operational limits:
- Required review/protection path and stop conditions:

Read root `AGENTS.md`, `docs/architecture/current.md`, applicable nested guidance,
and these task-specific files: [list paths]. Inspect actual code, current main,
dirty worktrees and active deployment work before acting. Latest explicit task
restrictions win over broader standing delivery approval. Do not infer Ship or
Operate authority from this unfilled template.

## Implementation guidance
- Relevant entry points and existing behavior:
- Intended smallest change; approved technical choices and open questions:
- Required scoped checks; consumer/broad-validation escalation and why:
- Disposable test resources, distinct local ports and UI screenshot plan:
- Decisions: approved choice, authority/source, superseded guidance (or none):
- Assumptions: evidence, impact if wrong, revisit trigger (or none):
- Blocker escalation: evidence, smallest next action and responsible party:
- If deployment is authorized: runbook, expected revision checks, authenticated
  verification, prior release and rollback boundaries:

Work autonomously on routine reversible steps within this scope. Preserve media
originals and ownership; preserve Itachi's authenticated global reads and ordinary
account restrictions. Do not introduce auth bypasses, expose secrets, or perform
destructive database/media operations. Follow the separate approval boundaries
in `AGENTS.md`; report concrete blockers and continue independent safe work.

Return `docs/agent-handoff-template.md` completed with actual changes, commits,
checks, deployment evidence, blockers and smallest next action. GPT-6 reviews
acceptance criteria, evidence and deviations before issuing the next brief.
