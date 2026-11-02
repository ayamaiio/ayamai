# Private public-art starter import

Status: prepared and locally verified; not run on AWS. This is a three-image,
non-explicit sample approved by the owner on 2026-10-31. It is separate from
the old-library migration and does not import adult dataset collections.

## Reviewed sources

Each source page lists CC0 1.0. Original authorship and the source URL are saved
in each imported record's description. The Artbreeder image is labeled as AI-generated.

| File | Credited source creator | License evidence |
| --- | --- | --- |
| Anime_girl_publicdomainq.png | oksmith | https://commons.wikimedia.org/wiki/File:Anime_girl_publicdomainq.png |
| Red_suit_anime_girl_with_board.png | jsks | https://commons.wikimedia.org/wiki/File:Red_suit_anime_girl_with_board.png |
| Anime_girl_portrait.jpg | Artbreeder (AI-generated) | https://commons.wikimedia.org/wiki/File:Anime_girl_portrait.jpg |

The importer pins each file to its reviewed source SHA-1, checks its image
signature and MIME type, bounds each download to 3 MiB, rejects redirects, and
computes SHA-256 for deterministic per-owner object keys. It has no arbitrary
source URL or manifest option.

## Run on Lightsail

Use a clean checkout of the reviewed revision. Preserve any unrelated changes.
Dependencies must already be installed with the repository's pnpm version.

First run without credentials or writes:

```sh
cd ~/ayamai
node scripts/import-public-art.mjs
```

Expected result for the reviewed bytes:

```json
{"reviewed":3,"bytes":1130827,"mode":"check-only"}
```

To apply, the existing server-only `/home/ubuntu/ayamai.env` must contain
`DATABASE_URL`, `APP_OWNER_EMAIL`, `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`, and
`CLOUDFLARE_R2_BUCKET_NAME`. Configure credentials directly on the server;
do not paste them into chat, put them in frontend variables, or commit them.

For the AWS database verified during setup:

```sh
node --env-file=/home/ubuntu/ayamai.env scripts/import-public-art.mjs --apply --expected-db-host=ls-b7459d2d1994b6b6a952a0cf06638ad0b949831a.c6nsm4486bpc.us-east-1.rds.amazonaws.com
```

The destination host must match the explicit argument. The importer finds the
existing active owner by the configured email; it never creates or promotes a
membership. The bucket needs read/write permission for the sample objects.
Bucket CORS must allow GET and HEAD from `https://aws.ayamai.io` for private
browser viewing (this rule was added and verified separately on 2026-10-31).

This inserts at most three private `media_items` rows in **Public art sample**
and uploads three new objects under that owner's `media/.../public-art/`
prefix. It does not alter existing media, other users, the database schema,
Replit, bucket privacy, or authentication. Uploads use conditional creation;
unexpected existing objects are rejected rather than overwritten.

On partial failure, already-completed records remain private and retries are
idempotent. An upload whose database insert failed may remain unindexed;
retrying the same reviewed sample reuses it. No automatic deletion is performed.
If cleanup is wanted, identify the exact sample rows and their objects before
using the normal owner deletion controls. Never delete an entire user prefix.

## Verification

```sh
node --check scripts/import-public-art.mjs
node --test scripts/import-public-art.test.mjs
```

Local verification on 2026-10-31: syntax passed, four focused tests passed,
and all three actual source downloads matched their pinned checksums
(1,130,827 bytes total). No live database or R2 writes were performed.
Database/R2 integration and authenticated UI viewing remain unverified.

After applying on AWS, sign in as the configured founder and open the Library
collection **Public art sample**. Confirm three images open and attribution is
present in their descriptions. These private samples are not public feed posts.
Run the command again and expect zero insertions and three skips.
