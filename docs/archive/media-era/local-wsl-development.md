# Local WSL development

**Current setup:** Windows with Ubuntu WSL. Repository: `/home/markfoster314/ayamai-github-main`. Last observed on 2026-10-31; confirm the current process state before use.

## Local services

| Service | Address / identity |
| --- | --- |
| Web app | http://localhost:25222 |
| API | http://localhost:8081 |
| PostgreSQL | 127.0.0.1:5434, database `ayamai_local` |
| PostgreSQL container | `ayamai-work-local-postgres` |
| Local media | `AYAMAI_LOCAL_MEDIA_ROOT` configured in ignored local environment |

Use Node 24.11.0 and pnpm 10.34.9 through the local-dev script's PATH setup. Credentials and machine-specific configuration live in ignored `.local/` files; never copy them into Git.

## Start and stop

From Windows PowerShell, start the isolated database, then the API and web services:

```powershell
wsl.exe -d Ubuntu -u markfoster314 -- docker start ayamai-work-local-postgres
wsl.exe -d Ubuntu -u markfoster314 -- bash -lc 'cd /home/markfoster314/ayamai-github-main && python3 scripts/local-dev.py start'
```

Check status:

```powershell
wsl.exe -d Ubuntu -u markfoster314 -- bash -lc 'cd /home/markfoster314/ayamai-github-main && python3 scripts/local-dev.py status'
```

Stop the API and web processes:

```powershell
wsl.exe -d Ubuntu -u markfoster314 -- bash -lc 'cd /home/markfoster314/ayamai-github-main && python3 scripts/local-dev.py stop'
```

Stop PostgreSQL separately with `docker stop ayamai-work-local-postgres`. This preserves the database volume. Do not remove the volume as a way to stop the service.

The lifecycle script starts the API on 8081 and Vite on 25222, checks health, and owns only processes it launched. It does not start PostgreSQL. The database container must already be available.

## Local founder access

`AYAMAI_DEV_AUTH_MODE=local-founder` is the default for this isolated local setup. It provides the owner account locally without requiring Clerk sign-in. It is guarded to development mode, loopback listeners, the dedicated local database, and no cloud media credentials. The API creates or moves the single active local owner membership to the local founder identity when needed; this changes local access membership only, not media ownership. The access table is backed up under ignored `.local/` before a transfer.

Choose `AYAMAI_DEV_AUTH_MODE=clerk` in the ignored local config only when you intentionally want to test Clerk development login. Restart local services after changing the mode.

Local founder mode is not a production feature and must not be treated as an identity-provider replacement outside this local environment.

## Media previews and storage

The local API uses the configured local media directory instead of Cloudflare R2. Preview generation requires `ffmpeg` on the API process PATH; FFmpeg 6.1.1 was installed in the observed WSL environment. Originals are preserved while preview derivatives are generated. See [library previews](library-previews.md).

## What was observed

On 2026-10-31, the API and web processes were running, the local PostgreSQL container was up, and the local web/API endpoints were configured on the ports above. These observations are a point-in-time check, not a promise that the services remain running. Authenticated user flows and every import/playback path are not implied by a health response.
