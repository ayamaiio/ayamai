# Curator standardization execution brief

Authority: owner “get it done”, 2026-10-31, following Foundation 1.1 proposal.
Principle: [Why we build](philosophy/WHY-WE-BUILD.md).
Task: current Codex chat; base 8e9982b03a4a5b109172e30947f3450c9124ba7e.
Branch codex/curator-standardization-20261031, worktree /home/markfoster314/ayamai-curator-standardized.
Own .github/workflows/ci.yml, lib/db schema/migration/bootstrap, API Curator/auth registration, apps/curator, scripts/local-dev.py, scripts/tests/test_local_dev.py, root package/lock,
README and relevant development/status docs. Preserve both standalone data and dirty founder trees.
Endpoint: tested local integration, GitHub PR; routine delivery follows the owner-supplied standing policy. Local PAT auth and new disposable schema testing were separately approved in this chat. Production activation and live migration remain excluded.
Acceptance: source-controlled dependency-free Curator, single launcher lifecycle,
isolated private config/data, synthetic folder labeling/resume/undo/collection tests,
reliable outbox concurrency/retry, no original-media deletion, clean shutdown.
Backend synchronization was subsequently approved locally and verified with synthetic data. Production activation remains out of scope.
Checks: Curator Node integration tests, Python lifecycle tests, frozen install,
workspace typecheck/build, isolated runtime readiness. No private media or provider keys.
