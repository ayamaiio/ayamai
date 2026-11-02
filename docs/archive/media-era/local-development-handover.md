# Local development handover (2026-10-31)

> **Historical snapshot, superseded.** This report describes the earlier `ayamai-task3` checkout and its setup. Use [Local WSL development](local-wsl-development.md) for the current machine and ports. Preserve this report as historical evidence only.

Partial: the latest GitHub main runs locally; authenticated verification needs a development identity.
Checkout: /home/markfoster314/ayamai-task3, branch dev/local-handover.
Base/main: 9c4f13a5f49dd8f9a3eca29a539c463b41079898.

Frontend: http://localhost:25222 (Vite HMR). API: http://localhost:8081.
PostgreSQL: 127.0.0.1:5434, database ayamai_local, dedicated container
ayamai-work-local-postgres and volume ayamai-work-local-data.
Windows Node services occupy 25221/8080 and were left untouched. Windows browsers
reach that older app on those ports. Reclaiming them needs a separate safe handover.
Use VS Code WSL to open the checkout and edit artifacts/private-media-library/src.
Frontend saves reload live. API edits require restart, which rebuilds the API.

## Lifecycle

From Windows PowerShell:

```powershell
wsl.exe -d Ubuntu -u markfoster314 -- docker start ayamai-work-local-postgres
wsl.exe -d Ubuntu -u markfoster314 -- python3 /home/markfoster314/ayamai-task3/scripts/local-dev.py start
```

Replace start with status, stop, or restart. In WSL use
`python3 scripts/local-dev.py start` from the checkout.
Stop retains PostgreSQL and data. After stopping servers, optionally run
`docker stop ayamai-work-local-postgres` in WSL. Never remove the volume to stop.
After reboot/WSL shutdown start again; no automatic service was installed.
Node 24.11.0 and pnpm 10.34.9 are selected from the user's nvm installation.
Fresh installs need that toolchain and `pnpm install --frozen-lockfile`.
Startup performs no schema push or migration.

Ignored .local/runtime.env and dev.env contain existing development configuration,
copied privately with restrictive permissions; originals remain intact. Never commit
these or share raw logs. Launcher restricts database destination/test Clerk keys,
discards ambient application credentials, and gives the web process no secret key
or database URL. Logs and process identities are private under .local/.
Stop validates boot ID, PID start time, process group, and checkout; unfamiliar
processes are refused. Status shows process ownership rather than full app health.

## Verification

API build, full pnpm typecheck, Python syntax, and git diff --check passed.
Direct API health, proxied health and frontend root returned 200.
Signed-out /api/media returned 401. SQL verified ayamai_local and 28 public tables.
Browser rendered WSL landing and Clerk sign-in with Development mode.
Signed-out /library returned to public landing. Temporary landing text appeared
through HMR; restoring it updated the same tab without refresh. Source restored.
Start/stop/restart exercised; shutdown race and socket reuse corrected during tests.
No development account exists (owner confirmed), so real sign-in and authenticated
membership/media remain unverified. Storage/upload/import flows are unconfigured
and untested. No account, founder override, or access bypass was created.
Next: create a dedicated identity in the existing Clerk development instance,
then sign in at localhost:25222/sign-in and verify account/library behavior.
Follow existing membership rules; any bootstrap/access changes require separate scope.

## Preservation and rollback

Original WSL /home/markfoster314/ayamai remains at
3971bf2c82aec4a0353865855e9867eeb386c66c with 3 tracked changes, untracked
runbook, and ignored .local preserved. Content hashes of work/config/scripts match.
Only identified old server PIDs 5658/5726 received TERM after ownership, local
configuration and idle import queue checks. Existing import worker now uses only
the isolated local database. No database schema/data setup changes were made.
Rollback: stop new servers, run original .local/start-api.sh and start-web.sh in
separate WSL terminals. Old WSL ports remain shadowed by Windows listeners.
Windows/Sachiel tree at 6e807a09d7cd0d6f5ec3662357b64a56c9081413 untouched.
Replit not contacted; supplied cefaf17d0e7e788ffcb2dc24baa5c4044745ce4e not
reverified. Production revision unknown and not accessed.

This local-only scope supersedes broader release instructions. No production,
Replit, migrations, or auth/security policy changes. Scoped repository files:
scripts/local-dev.py, this document, product/operations/SESSION-HANDOFF.md.
