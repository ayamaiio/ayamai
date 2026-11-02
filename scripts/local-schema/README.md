# Local bootstrap

Generated from `lib/db/src/schema/index.ts` using pinned Drizzle Kit 0.31.11.
This is a fresh-database bootstrap, never an upgrade migration. The launcher
checks the SQL SHA-256 and all schema source filenames/bytes against manifest.json.

When schema sources change, generate SQL into a new empty output directory:

```bash
pnpm --filter @workspace/db exec drizzle-kit generate --dialect postgresql --schema ./src/schema/index.ts --out ../../.local/bootstrap-review
```

Review the complete generated SQL, replace bootstrap.sql and update both manifest
hashes (source hash feeds sorted direct schema *.ts filenames followed by bytes).
Do not run this SQL manually against an existing database. Existing fingerprint
mismatch requires an explicitly chosen new worktree/database, never automatic push.
No runtime bootstrap command invokes Drizzle push or any production migration.

Integration check after setup:
`python3 scripts/tests/local_schema_postgres.py`.
It creates synthetic databases inside the verified owned container and retains
them for inspection. It checks empty initialization, preserved data on repeat,
and refusal of existing tables/custom schemas without partial initialization.
