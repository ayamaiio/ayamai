# Current architecture

**Inspected:** 2026-10-31
**Checkout:** `/home/markfoster314/ayamai-github-main`, branch `codex/local-founder-auth`. This worktree is dirty; it is not proof of GitHub main or a deployed release.

## Product and access contract

Ayamai is personal-first: prioritize the owner's media experience, reliability, privacy, and speed. Shared app identity uses Clerk; app membership is a separate server-managed record. Local WSL development can use the guarded `local-founder` mode, which is restricted to the isolated local environment. See [local runbook](../local-wsl-development.md).

The local owner account's broad read behavior is a local product configuration, not permission for anonymous access or public object storage. Inspect the specific route before changing media authorization.

## Code map and data flow

| Area | Location and role |
| --- | --- |
| Web | `artifacts/private-media-library/`: React/TypeScript, Vite, TanStack Query |
| UI | `artifacts/ayamai-design-system/` |
| API | `artifacts/api-server/src/`: Express routes, membership, imports, media delivery |
| Database | `lib/db/src/schema/`: PostgreSQL records and access state via Drizzle |
| API contract | `lib/api-spec/`, `lib/api-client-react/`, `lib/api-zod/` |
| Capture | `extensions/browser-capture/`: explicitly selected media |
| Delivery | `.github/workflows/`, `scripts/deploy/`, Lightsail runbook |
| Experiment | `infrastructure/shared-media-edge/`: presence does not establish live routing |

In shared app mode, the browser loads React and calls Express via `/api`; Clerk handles identity; Express reads PostgreSQL metadata/access state and private Cloudflare R2 media. Local-founder mode instead authenticates against a loopback-only local session and uses the local PostgreSQL database and configured local media root.

## Configured AWS deployment

Repository runbooks and deployment configuration describe an AWS Lightsail application with managed PostgreSQL. The deployment workflow and release layout are documented in [Lightsail deployment](../../product/operations/LIGHTSAIL-DEPLOYMENT.md). Cloudflare R2 is configured for private media storage. The shared-media-edge Worker is an experiment, not an assumed production route.

These are repository/configuration facts. The active production revision, database region, current service health, and end-to-end authenticated media behavior were not independently verified for this documentation update.

## Local development

The observed local setup uses:
- Web at `http://localhost:25222`
- API at `http://localhost:8081`
- PostgreSQL at `127.0.0.1:5434/ayamai_local`
- FFmpeg on PATH for video preview generation
- Local-founder authentication and local filesystem media

See [Local WSL development](../local-wsl-development.md) for startup, guards, and limits.

## Operational boundaries

GitHub is canonical. The checked local branch contains uncommitted changes and must not be confused with main. Replit is retired as an active surface; Replit-era documents are historical evidence only. Verify exact source revision, deployment state, and target database before operational work.
