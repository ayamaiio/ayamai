# Ayamai current state

**Last updated:** 2026-10-31
**Purpose:** A compact, repository-grounded snapshot. Check the active branch and services before acting.

## Foundation 1.0 — complete

Verified 2026-10-31: MAGI #24, coordination #25 and unified local development
#26 are integrated. The code release a1548e77ff75b079d4015615958b71fb82f24250
passed CI and Lightsail deployment, with matching public revision, healthy API
and served Library HTML. See [commands, tests, release evidence and limits](../../docs/foundation-1.0-verification.md).
Use `pnpm run setup` then `pnpm dev` in a fresh checkout. Setup initializes
only a new empty owned local database; it never migrates an existing one.
Dirty founder WSL and Windows checkouts remain preserved and unsynchronized.
Curator/PAT was excluded from Foundation 1.0. The subsequent local Curator integration is described below. Real Clerk and live connector behavior remains untested.

## Curator — local integration

The owner approved local Curator token authentication and disposable-schema verification. Source is now in `apps/curator`; the common launcher includes port 4319 and its agent offset. A fresh founder launch pairs automatically; labels synchronize to an account-scoped local API. Existing databases and standalone data are preserved. Production Curator routes and migrations remain excluded. See [verification and limitations](../../docs/curator-standardization-verification.md).

## Product

Ayamai is an invite-only adult media collection and discovery app. Mark Foster is the owner and primary user. Optimize for the owner's personal library, media experience, speed, reliability, privacy, and visual quality.

The current landing direction is quiet, image-led, premium, and deliberately understated: Japanese typography, restrained red accents, and minimal explanation. The app currently has no subscription, donation, payout, or pay-per-view flow. Premium positioning and anonymous support are exploratory context, not a committed monetization plan.

## Source and implementation

- GitHub repository: `markfoster314/ayamai`; GitHub is canonical.
- Founder checkouts are dirty; verification used isolated WSL `ayamai-foundation-final` and `ayamai-foundation-fresh` worktrees.
- This checkout contains uncommitted work. Preserve it; do not assume the branch equals GitHub main.
- Web: React/TypeScript/Vite. API: Express/TypeScript. Data: PostgreSQL/Drizzle. Identity: Clerk in shared app mode. Media: private Cloudflare R2 in the configured AWS deployment.
- Replit is no longer an active development or deployment surface. Replit references in historical reports are archival only.
- Local Windows/WSL development is the immediate priority; see [Local WSL development](../../docs/local-wsl-development.md).
- AWS Lightsail code release and public revision/health were verified as recorded above; recheck Actions and /REVISION for later releases.

## Local environment

Observed 2026-10-31:
- Web: http://localhost:25222
- API: http://localhost:8081
- PostgreSQL: 127.0.0.1:5434, database `ayamai_local`
- Local founder auth is enabled; local media uses the configured local filesystem root.
- FFmpeg is available for video preview generation.

See the local runbook for startup, status, and shutdown. These are observed settings, not a guarantee services are currently running.

## Current limitations

Age is self-attested, not independently verified. Full account export/erasure is not available. Personal viewing telemetry and collaborative recommendation participation are separate controls. Provider imports and AWS deployment details need environment-specific verification.

## Useful entry points

- [Architecture](../../docs/architecture/current.md)
- [Local runbook](../../docs/local-wsl-development.md)
- [Lightsail deployment](LIGHTSAIL-DEPLOYMENT.md)
- [Privacy and Terms](../../artifacts/private-media-library/src/lib/legal-content.ts)
- [Membership behavior](../../docs/invite-membership.md)
