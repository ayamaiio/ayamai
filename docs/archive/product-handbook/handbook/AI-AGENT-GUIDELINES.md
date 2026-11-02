# AI Agent Guidelines

These guidelines apply to AI assistants and implementation agents working on Ayamai.

## Foundational principle

Read [Why we build](../../docs/philosophy/WHY-WE-BUILD.md) before acting, whatever
your model or host. Carry the canonical reference into briefs and handoffs;
raise material incentive drift in product tradeoffs without expanding scope.

## Authority

Follow the repository [agent operating policy](../../AGENTS.md). Subject to applicable higher-priority instructions and safety/security constraints, the owner's latest explicit instructions supersede older project decisions, documentation, comments, and agent-specific preferences. Product HQ sets direction; approved documents preserve decisions. Existing code and infrastructure are inherited starting points, not immutable authority. Agents execute authorized tasks; they do not independently approve scope or change direction.

When a newer explicit instruction resolves a conflict, follow it and document what it supersedes without asking for the same approval again. Escalate unresolved ambiguity rather than silently choosing. Keep approved decisions, exploratory ideas, recommendations, and verified facts distinct.

## Before acting

1. Read `product/START-HERE.md` and the relevant handbook documents.
2. Read the current state and the specific brief or issue for the task.
3. Identify the status of the relevant idea or feature.
4. Check the current code and documentation before asserting implementation facts.
5. Surface conflicts, missing context, and material assumptions.

## Do not

- Turn brainstorming into requirements.
- Create Linear issues or projects for unapproved ideas.
- Make product, privacy, policy, or architecture decisions outside the authorized scope.
- Change unrelated files or expand scope opportunistically.
- Treat an assistant-generated suggestion as owner approval.
- Assume a feature exists because it appears in a vision or idea document.
- expose credentials, tokens, private user data, or sensitive operational details in documentation, logs, or handoffs.
- Claim tests passed, deployments succeeded, or changes were made without evidence.

## Implementation expectations

For authorized implementation work:
- Follow **owner directs → agent inspects → implement → verify → document**, as detailed in `AGENTS.md`.
- Do not deploy, publish, or perform destructive changes without explicit authorization for those actions. Setup instructions and credentials are not authorization.
- Before executing a change with concrete security or data-loss consequences, explain the affected system/data, consequences, and mitigation or rollback. Pause and ask if the consequence is outside the authorization or intent is unclear.
- Stay within the agreed scope.
- Preserve existing conventions unless the brief authorizes a change.
- Prefer focused, reversible changes.
- Add or update tests appropriate to the change.
- Consider privacy, authorization, media handling, accessibility, and mobile/desktop behavior where relevant.
- Report changed files, behavior, tests run and results, known limitations, and follow-up recommendations.
- Call out any deviation from the brief rather than silently deciding.

## Documentation expectations

Keep durable documents concise and current. Mark status and distinguish facts, decisions, hypotheses, and recommendations. Update the relevant handoff or current-state document when an authorized task materially changes project status.

## Unclear authorization

If it is unclear whether the owner authorized implementation or a scope change, stop before making the consequential change and ask.

## Delivery and coordination

Follow root [AGENTS.md](../../AGENTS.md) as the single operating policy for
isolation, scope, verification and delivery. Its updated coordination rules
supersede the earlier automatic merge/deploy standing permission: require explicit
owner authorization for those actions on the task. A PR-only request ends at the
PR; updating main triggers Lightsail deployment. Preserve unrelated dirty work.
