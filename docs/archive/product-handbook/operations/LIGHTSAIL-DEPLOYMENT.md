# GitHub → Lightsail delivery

Authorized October 31, 2026 for `markfoster314/ayamai` and `aws.ayamai.io`.
This replaces the manual checkout/build/copy deployment sequence for this host.
It does not change media authorization, Clerk identities, database schema, or R2.

## Routine delivery

Open a PR to `main`. CI runs typechecks, founder/membership and frontend tests,
builds, and isolated deployment/rollback tests against a disposable PostgreSQL.
Merging to `main` starts **Deploy Lightsail**, which requires the same CI checks
before entering the `production` environment. Manual dispatch is also main-only.
Deployments serialize without cancelling an in-flight activation.

The release job uses Node 24.22.2 and pnpm 10.34.9 on Ubuntu 24.04. It builds
the backend and frontend together, including production backend dependencies.
Only the public Clerk publishable key enters the build. The tarball/checksum are
retained as an Actions artifact for 14 days and releases remain on the server.
Watch disk usage; cleanup is deliberately manual and must preserve current,
previous, and baseline releases. Database push/migrations run only in disposable
CI, never as part of deployment. Schema changes require a separately reviewed plan.

## Access and configuration

The production environment permits branch `main` only, with no tag policy.
There is no manual approval gate, so routine merges deploy automatically.
The current private-repository GitHub plan rejects branch-protection API access;
required PR checks therefore cannot be enforced by branch protection on this plan.
The deployment job itself still depends on successful CI. Administrators who can
edit workflows or environment rules remain trusted deployment operators.

Environment variables (none is a server secret):

- `AWS_DEPLOY_ROLE_ARN`: `arn:aws:iam::780159609666:role/AyamaiGitHubDeploy`
- `DEPLOY_HOST`: the existing Lightsail static address
- `SSH_HOST_KEY`: independently verified server ED25519 public host key
- `VITE_CLERK_PUBLISHABLE_KEY`: the existing AWS Clerk public build key

The AWS OIDC role trusts only audience `sts.amazonaws.com` and subject
`repo:markfoster314@48030721/ayamai@1438802954:environment:production`.
This repository uses immutable OIDC subjects; do not substitute the older name-only
format. The sole permission is `lightsail:GetInstanceAccessDetails` on the
`ayamai-dev-api` instance ARN in us-east-1. GitHub obtains an ephemeral SSH key and
certificate at deployment time, verifies the pinned host key, and deletes local
key files at step exit. No static AWS or SSH secret is stored in GitHub.
The instance's existing `ubuntu` account has service administration privileges;
access to this deployment role is consequently privileged access to this host.

Runtime secrets stay at `/home/ubuntu/ayamai.env`; the database CA stays at
`/home/ubuntu/aws-db-ca.pem`. Neither enters artifacts or workflow output.
Environment changes require separate configuration management; rollback restores
code/dependencies/frontend, not database writes or an independently changed env file.

## Server layout and recovery

`scripts/deploy/bootstrap.sh` is a one-time, guarded setup run as `ubuntu`.
It requires a clean original checkout, snapshots the existing source/dependencies
and served frontend as a baseline release, and installs a systemd drop-in.
The original checkout and `/var/www/ayamai-pre-cicd` remain preserved.
Do not rerun bootstrap over an installed layout.

- `/opt/ayamai/releases/<sha>-<run>-<attempt>` contains backend, frontend, revision.
- `/opt/ayamai/current` selects the matched release for both services.
- `/opt/ayamai/previous` identifies the last successful predecessor.
- `/var/www/ayamai` links to `/opt/ayamai/current/frontend`.
- `/etc/systemd/system/ayamai.service.d/release.conf` sets the backend path
  and executes `/snap/node/current/bin/node` directly. Calling `/snap/bin/node`
  launches through the Snap session wrapper; under SSH deployment that tied the
  API process to the operator session and stopped it when the session closed.
  Bootstrap and every activation rewrite this override, reload systemd, then
  restart the API.

Activation verifies artifact structure and SHA, obtains a host-side lock, switches
one symlink atomically, and restarts `ayamai`. It checks localhost API readiness,
public API, `/library` HTML, and public `/REVISION` against the expected SHA.
Any failure restores the previous symlink and restarts its backend, then exits
unsuccessfully. Previous frontend files and backend dependencies stay paired.
Inspect the failed Actions log before retrying; do not add migrations to recover.
The service restart briefly interrupts requests on this single-instance setup.

For an operator-initiated rollback, select a verified retained release, obtain
`/opt/ayamai/deploy.lock` with `flock`, create `/opt/ayamai/current.next` pointing
to it, atomically rename that link to `current`, restart `ayamai`, and repeat
the health/revision checks. Never modify release contents in place.

Health and HTML checks do not verify authenticated sign-in, private Library
contents, uploads, or playback. Those require an authenticated user session.
