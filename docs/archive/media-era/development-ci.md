# Development CI

The GitHub Actions CI workflow runs on pull requests targeting main, pushes to
main, and manual dispatch. It does not deploy. The inspected workflow uses
Ubuntu 24.04, Node 24.11.0 and pnpm 10.34.9. Check `.github/workflows/ci.yml`
and `.nvmrc` for the current source of truth before changing versions.

## Checks

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm --filter @workspace/db push` against a fresh disposable CI PostgreSQL 16 database
4. `pnpm test:founder-access`
5. `pnpm --filter @workspace/private-media-library test`
6. `NODE_ENV=production pnpm -r --if-present run build`
7. `git diff --exit-code`

The database schema initialization is disposable CI fixture preparation, not a
production migration. Never point CI checks or schema push at an existing local
or production database. Tests use synthetic records and mocked provider calls;
CI does not verify real sign-in, storage, or production behavior.

Actions are pinned to upstream commit SHAs. The workflow uses read-only contents
permissions, disables persisted checkout credentials, avoids
`pull_request_target`, limits job time, and cancels superseded runs. These
workflow properties should be rechecked when CI changes.

Required branch checks must be configured separately where repository settings
allow them. CI passing does not establish branch protection or production health.
