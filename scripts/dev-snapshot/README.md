# Dev snapshot (production → local)

Read-only capture of Ayamai's PostgreSQL metadata for isolated local development,
plus an encrypted, Git-ignored snapshot store and a guarded, atomic restore path.

Nothing here writes to the source database. Every source connection is opened
with `default_transaction_read_only=on`, and restores are hard-limited to the
isolated local database.

## Scope and priority

The owner directs speed-first, focused blocker fixes. Capture/restore/media actions
still require explicit authorization for the intended data. This PR does not
merge, deploy, fetch production data or configure live infrastructure.

## Commands

```bash
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"
export AYAMAI_SNAPSHOT_PASSPHRASE_FILE="$HOME/ayamai-snapshots/.passphrase"
export AYAMAI_LOCAL_DATABASE_URL="postgresql://ayamai_local:PASS@127.0.0.1:5434/ayamai_local"

# 1. capture (READ-ONLY against the source)
node scripts/dev-snapshot/cli.mjs snapshot-prod \
  --source "$PROD_DATABASE_URL" --label prod

# 2. decrypt the private mapping template, then fill prod subject -> Clerk test subject
umask 077
gpg --batch --pinentry-mode loopback --passphrase-file "$AYAMAI_SNAPSHOT_PASSPHRASE_FILE" \
  --decrypt --output <snapshot-dir>/identity-map.json <snapshot-dir>/identity-map.template.json.gpg

# 3. restore into ayamai_local (backs up the current local DB first)
node scripts/dev-snapshot/cli.mjs restore-local <snapshot-dir>

# 4. wipe + reload local data from a snapshot
node scripts/dev-snapshot/cli.mjs reset-local <snapshot-dir>   # or omit for latest

# inspect / verify
node scripts/dev-snapshot/cli.mjs list
node scripts/dev-snapshot/cli.mjs verify <snapshot-dir>
node scripts/dev-snapshot/cli.mjs media-plan <snapshot-dir>
node scripts/dev-snapshot/cli.mjs media-copy <snapshot-dir> --owner <prod-user-id> --max-bytes 500000000
```

`restore-local` and `reset-local` are the same operation (snapshot → clean local
rebuild); the distinction is intent only.

Connection URLs may not include query parameters. Set transport requirements
with libpq environment settings such as `PGSSLMODE=require` instead. Inherited
`PGOPTIONS` is discarded; source sessions always receive read-only options.

## What is exported

21 allow-listed tables (`policy.mjs`): media items and collections metadata,
annotations, members/relationships, social posts and interactions, follows,
bookmarks, reviews, views, watch signals/settings, import job and label export
shells.

Never exported: `cloud_accounts`, `cloud_authorizations`, `access_invitations`,
`membership_invitations`, `social_rate_limits`, `watch_feed_sessions`,
`social_events`.

Never exported from any table: `email`, `token_hash`, `encrypted_verifier`,
`password*`, `secret`, `api_key`. `NOT NULL` denied columns are filled with a
stable `redacted-<hash>` placeholder so the restored schema still satisfies its
own constraints.

### Sanitized free-form fields

These carry unbounded text or opaque provider payloads. They are replaced with a
typed empty value (`''`, `'{}'::jsonb`, or `NULL` depending on nullability), so
the column survives but the content does not:

| Column | Why |
|---|---|
| `media_items.description` | free-text description |
| `media_annotations.notes` | personal free-text notes |
| `media_annotations.source_url` | external source link |
| `media_annotation_history.payload` | historical annotation blobs |
| `social_profiles.bio` | free-text profile bio |
| `import_jobs.posting` | provider post payload / source URLs |
| `import_jobs.encrypted_source` | opaque provider ciphertext |
| `import_jobs.error` | may embed provider URLs or tokens |
| `label_export_rows.record` | denormalised export snapshot |
| `label_exports.metadata` | free-form export metadata |

Structured media metadata is deliberately preserved because the local library UI
is meaningless without it: `title`, `collection`, `tags`, `visibility`,
`attribution`, `moderation_state`, `content_type`, `media_type`, `size`,
`object_key`, timestamps and ownership. Gallery JSON is projected to reviewed keys;
original names and unknown fields are removed. Every exported column must appear
in `REVIEWED_COLUMNS` (or the explicit denied policy); new columns abort capture.

Also sanitized: comment and review text, report reasons, profile display names,
original filenames, submission hashes, annotation attributes, and import file
source IDs, names, upload IDs and errors. Profile handles become unique inert
`dev-<hash>` values. Review these explicit policies before changing them.

## Safety model

| Rule | Implementation |
|---|---|
| Source is read-only | `PGOPTIONS=-c default_transaction_read_only=on` on every psql/pg_dump call |
| Consistent capture | a held read-only transaction exports one snapshot; schema sections, catalog/column discovery, COPY data, manifest and all identities import it |
| Fail-closed allowlist | only reviewed tables and columns are exported; an unreviewed new table or column **aborts** capture |
| Atomic restore | reset + pre-data schema + data + mapping + post-data constraints/triggers + row-count checks run in one transaction; any failure rolls back. FK checks validate mapped relationships; no superuser or trigger bypass is needed |
| Snapshot integrity | `index.json` holds SHA-256 of every ciphertext file; a damaged snapshot is rejected before any DB write |
| Never prompt for a password | `pg_dump -w`, `PGCONNECT_TIMEOUT=10`; the URL must carry credentials or `~/.pgpass` must be configured |
| Local-only targets | `assertLocalTarget` requires `127.0.0.1:5434/<allow-listed db>`, default `ayamai_local`; all URL query parameters/fragments are rejected, ambient host-address/service overrides are removed |
| Recoverable reset | every restore first writes `~/ayamai-snapshots/backups/local-<stamp>.dump` |
| No plaintext residue | capture and decrypted files live in private temp dirs removed on success **and** handled failure; failed capture directories are removed, including partial ciphertext. Passphrase is checked first. Tool errors never print arguments, SQL output or provider diagnostics |
| Snapshot at rest | AES-256 symmetric GPG, passphrase from a 0600 file outside Git |
| Git hygiene | snapshots live in `~/ayamai-snapshots` (never inside the repo) |
| Media is opt-in | `media-plan` is read-only; `media-copy` requires `--owner`, a same-owner check, a destination-containment check, `--max-bytes`, `--confirm-copy` and read-only R2 credentials. Streamed bytes enforce both declared object sizes and the cumulative cap; partial files are removed |

Media copying requires Linux with `/proc/self/fd` (a local container is suitable).
Directory descriptors are pinned during traversal and every component uses
`O_NOFOLLOW`; even a concurrent parent-to-symlink swap cannot redirect a write.
Existing files are never overwritten, including the checksum receipt. Other
platforms fail closed. These tests use synthetic streams and never access R2.
No ordinary app media-serving behavior is changed by this tooling fix.

Cleanup covers normal completion and handled errors; abrupt machine loss or
`SIGKILL` cannot run cleanup. Use an encrypted local disk for snapshot work.

## Passphrase: storage, backup, recovery

Snapshots are encrypted with a symmetric passphrase. **Losing it loses every
snapshot** — there is no recovery key and no escrow in this repository.

```bash
# create once (32 random bytes, owner-only)
mkdir -p ~/ayamai-snapshots && chmod 700 ~/ayamai-snapshots
head -c 32 /dev/urandom | base64 > ~/ayamai-snapshots/.passphrase
chmod 600 ~/ayamai-snapshots/.passphrase
sha256sum ~/ayamai-snapshots/.passphrase   # record this fingerprint, not the passphrase
```

Back it up **outside the repository and outside this machine's Git clone**:

1. Store the passphrase in the owner's password manager as a dedicated item
   (label it "ayamai dev snapshots").
2. Keep one offline copy (printed and sealed, or a hardware-encrypted USB stick).
3. Never commit it, never paste it into chat or PR descriptions, never put it in
   `~/.bashrc` or a shell history file. Pass it via
   `AYAMAI_SNAPSHOT_PASSPHRASE_FILE` pointing at the 0600 file.

Recovery after a lost machine or file:

```bash
# restore the file from the password manager / offline copy
printf '%s' '<passphrase from escrow>' > ~/ayamai-snapshots/.passphrase
chmod 600 ~/ayamai-snapshots/.passphrase
node scripts/dev-snapshot/cli.mjs verify <snapshot-dir>   # proves it decrypts
```

Rotation (re-encrypt an existing snapshot under a new passphrase):

```bash
NEW=~/ayamai-snapshots/.passphrase.new
head -c 32 /dev/urandom | base64 > "$NEW" && chmod 600 "$NEW"
for f in <snapshot-dir>/*.gpg; do
  gpg --batch --quiet --pinentry-mode loopback \
      --passphrase-file "$AYAMAI_SNAPSHOT_PASSPHRASE_FILE" --decrypt "$f" \
    | gpg --batch --quiet --yes --pinentry-mode loopback \
      --passphrase-file "$NEW" --symmetric --cipher-algo AES256 -o "${f%.gpg}.tmp.gpg"
done
# verify, then replace the old ciphertext and update index.json hashes
```

## Tests

```bash
node --test scripts/dev-snapshot/tests/
```

Run the real database suite as an unprivileged Linux user with `initdb`,
`pg_ctl`, `psql`, `pg_dump`, Node and GPG available:

```bash
AYAMAI_SNAPSHOT_INTEGRATION=1 node --test scripts/dev-snapshot/tests/*.test.mjs
```

It creates its own temporary cluster on loopback port 5434 and removes it in a
`finally` block. No existing database is used or reset; if the port is occupied,
startup fails. `PG_BINDIR` can select the PostgreSQL tool directory. CI runs this
suite separately from application database tests. Tests cover populated FKs,
non-superuser restore, installed triggers, late transactional rollback, complete
identity validation, privacy policy, capture/encryption failure cleanup,
concurrent-write snapshot consistency, strict markers, byte caps and symlink races.

## Snapshot layout

```
~/ayamai-snapshots/<stamp>-<label>/
  pre-data.sql.gpg     public schema before data (no owners/privileges/comments)
  post-data.sql.gpg    keys, indexes, FKs and triggers installed after mapping
  data.sql.gpg         COPY blocks for allow-listed, sanitized tables
  manifest.json.gpg    media inventory: id, object_key, size, type, visibility, owner
  meta.json.gpg        source host/db, row counts, excluded tables, identity ids
  identity-map.template.json.gpg
  index.json           sha256 of ciphertext + plaintext (no sensitive content)
```

## Identity mapping

Production Clerk subjects must be mapped to Clerk **test-instance** subjects
before restoring. Mapped ids are rewritten in every identity column. Unmapped ids
become `dev-unmapped:<full md5>` — relationships survive, but those rows cannot
authenticate, so no local account can reach another member's private content. A
duplicate target, malformed target, unknown source, reserved placeholder target,
or target that is any captured production subject aborts restore. Validation uses
all source identity columns, including excluded invitation tables and identities
appearing only in blocked/moderator fields, even with a partial map. Only allowed
tables are rewritten locally. Clerk TEST-instance provenance must still be checked
by the operator; the tool has no Clerk access. Format v3 snapshots are required;
older snapshots must be recaptured.

## Not covered

- Media objects are copied only when explicitly authorized; the manifest has no
  source checksum (`media_items` has no checksum column), so `media-copy` records
  SHA-256 and the R2 ETag in `checksums.json`.
- No schema migration runs. Restores drop and recreate `public` in the local DB.
- Production capture needs a read-only role and a network path; neither is
  configured in this checkout.
