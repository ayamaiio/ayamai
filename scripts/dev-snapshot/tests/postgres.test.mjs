// No existing database is used. This suite starts and removes its own cluster.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sha256File, withSourceSnapshot, psql, sh } from "../util.mjs";
import { buildCaptureArgs, splitCaptureOutput } from "../lib.mjs";

const enabled = process.env.AYAMAI_SNAPSHOT_INTEGRATION === "1";
const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const fixture = `
CREATE TABLE members(user_id text PRIMARY KEY, referred_by text, source text NOT NULL);
CREATE TABLE access_memberships(user_id text PRIMARY KEY, email text NOT NULL, role text NOT NULL, status text NOT NULL);
CREATE TABLE media_items(id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES members(user_id), object_key text NOT NULL,
 size bigint NOT NULL, content_type text NOT NULL, media_type text NOT NULL, visibility text NOT NULL,
 collection text, created_at timestamptz DEFAULT now(), title text NOT NULL, description text NOT NULL,
 original_name text NOT NULL, gallery_images jsonb NOT NULL DEFAULT '[]');
CREATE TABLE social_profiles(id uuid PRIMARY KEY, user_id text NOT NULL UNIQUE REFERENCES members(user_id),
 handle text NOT NULL UNIQUE, display_name text NOT NULL, bio text NOT NULL);
CREATE TABLE creator_follows(user_id text REFERENCES members(user_id), profile_id uuid REFERENCES social_profiles(id), PRIMARY KEY(user_id,profile_id));
CREATE TABLE import_jobs(id uuid PRIMARY KEY, user_id text REFERENCES members(user_id), encrypted_source text NOT NULL, posting jsonb, error text);
CREATE TABLE import_files(id uuid PRIMARY KEY, job_id uuid REFERENCES import_jobs(id), source_id text NOT NULL, name text NOT NULL, upload_id text, error text);
CREATE TABLE label_exports(id uuid PRIMARY KEY, user_id text REFERENCES members(user_id), metadata jsonb NOT NULL);
CREATE TABLE label_export_rows(export_id uuid REFERENCES label_exports(id), media_id uuid REFERENCES media_items(id), ordinal integer, record jsonb NOT NULL, PRIMARY KEY(export_id,ordinal));
CREATE TABLE media_annotations(user_id text REFERENCES members(user_id), media_id uuid REFERENCES media_items(id), notes text NOT NULL, source_url text, attributes jsonb NOT NULL);
CREATE TABLE media_annotation_history(id uuid PRIMARY KEY, user_id text REFERENCES members(user_id), media_id uuid REFERENCES media_items(id), payload jsonb NOT NULL);
CREATE TABLE social_comments(id uuid PRIMARY KEY, user_id text REFERENCES members(user_id), media_id uuid REFERENCES media_items(id), text text NOT NULL);
CREATE TABLE social_reports(id uuid PRIMARY KEY, user_id text REFERENCES members(user_id), media_id uuid REFERENCES media_items(id), moderator_id text, reason text NOT NULL);
CREATE TABLE social_blocks(user_id text REFERENCES members(user_id), blocked_user_id text NOT NULL);
CREATE TABLE video_reviews(user_id text REFERENCES members(user_id), media_id uuid REFERENCES media_items(id), text text NOT NULL);
CREATE TABLE membership_invitations(inviter_id text REFERENCES members(user_id), redeemed_by text);
CREATE TABLE access_invitations(created_by text, accepted_user_id text);
INSERT INTO members VALUES ('prod_owner','prod_other','direct'),('prod_other',NULL,'direct');
INSERT INTO access_memberships VALUES ('prod_owner','PRIVATE_EMAIL','owner','active');
INSERT INTO media_items(id,user_id,object_key,size,content_type,media_type,visibility,title,description,original_name,gallery_images)
VALUES ('00000000-0000-0000-0000-000000000001','prod_owner','media/prod_owner/a',4,'image/png','image','private','Fixture','PRIVATE_DESCRIPTION','PRIVATE_FILENAME','[{"id":"g","objectKey":"media/prod_owner/g","originalName":"PRIVATE_GALLERY_NAME","contentType":"image/png","size":3,"secret":"PRIVATE_JSON"}]');
INSERT INTO social_profiles VALUES ('00000000-0000-0000-0000-000000000002','prod_owner','PRIVATE_HANDLE','PRIVATE_DISPLAY','PRIVATE_BIO');
INSERT INTO creator_follows VALUES ('prod_other','00000000-0000-0000-0000-000000000002');
INSERT INTO import_jobs VALUES ('00000000-0000-0000-0000-000000000003','prod_owner','PRIVATE_CREDENTIAL','{"secret":"PRIVATE_POSTING"}','PRIVATE_ERROR');
INSERT INTO import_files VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003','PRIVATE_SOURCE_ID','PRIVATE_FILE','PRIVATE_UPLOAD','PRIVATE_IMPORT_ERROR');
INSERT INTO label_exports VALUES ('00000000-0000-0000-0000-000000000005','prod_owner','{"secret":"PRIVATE_METADATA"}');
INSERT INTO label_export_rows VALUES ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001',1,'{"private":"PRIVATE_RECORD"}');
INSERT INTO media_annotations VALUES ('prod_owner','00000000-0000-0000-0000-000000000001','PRIVATE_NOTES','PRIVATE_URL','{"secret":"PRIVATE_ATTRIBUTES"}');
INSERT INTO media_annotation_history VALUES ('00000000-0000-0000-0000-000000000006','prod_owner','00000000-0000-0000-0000-000000000001','{"secret":"PRIVATE_HISTORY"}');
INSERT INTO social_comments VALUES ('00000000-0000-0000-0000-000000000007','prod_owner','00000000-0000-0000-0000-000000000001','PRIVATE_COMMENT');
INSERT INTO social_reports VALUES ('00000000-0000-0000-0000-000000000008','prod_owner','00000000-0000-0000-0000-000000000001','prod_moderator_only','PRIVATE_REASON');
INSERT INTO social_blocks VALUES ('prod_owner','prod_blocked_only');
INSERT INTO video_reviews VALUES ('prod_owner','00000000-0000-0000-0000-000000000001','PRIVATE_REVIEW');
INSERT INTO membership_invitations VALUES ('prod_owner','prod_redeemed_only');
INSERT INTO access_invitations VALUES ('prod_created_only','prod_accepted_only');
CREATE FUNCTION reject_fixture_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_TRIGGER_ROW'; END $$;
CREATE TRIGGER fixture_trigger BEFORE INSERT OR UPDATE ON media_items FOR EACH ROW EXECUTE FUNCTION reject_fixture_write();
`;

test("disposable Postgres capture/restore integration", { skip: !enabled, timeout: 180000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayamai-pg-test-"));
  const data = path.join(root, "pg");
  const run = (cmd, args, opts = {}) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
    assert.equal(r.status, 0, `${cmd} failed: ${r.stderr || r.stdout}`);
    return r.stdout;
  };
  const bindir = process.env.PG_BINDIR || run("pg_config", ["--bindir"]).trim();
  const pg = cmd => path.join(bindir, cmd);
  const base = "postgresql://snapshot_test@127.0.0.1:5434/";
  const source = base + "snapshot_fixture";
  const target = "postgresql://local_dev@127.0.0.1:5434/ayamai_local";
  let started = false;
  try {
    run(pg("initdb"), ["-D", data, "-A", "trust", "-U", "snapshot_test", "--no-locale"]);
    run(pg("pg_ctl"), ["-D", data, "-l", path.join(root, "pg.log"), "-o", `-h 127.0.0.1 -p 5434 -k ${root}`, "-w", "start"]);
    started = true;
    run(pg("psql"), [base + "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-c", "CREATE DATABASE snapshot_fixture"]);
    run(pg("psql"), [base + "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-c", "CREATE ROLE local_dev LOGIN NOSUPERUSER"]);
    run(pg("psql"), [base + "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-c", "CREATE DATABASE ayamai_local OWNER local_dev"]);
    run(pg("psql"), [source, "-X", "-v", "ON_ERROR_STOP=1", "-c", fixture]);
    const pass = path.join(root, "pass"); fs.writeFileSync(pass, "synthetic-test-passphrase", { mode: 0o600 });
    const snaps = path.join(root, "snapshots");
    const scratch = path.join(root, "scratch"); fs.mkdirSync(scratch);
    const gnupg = path.join(root, "gnupg"); fs.mkdirSync(gnupg, { mode: 0o700 });
    const env = { ...process.env, PATH: bindir + path.delimiter + process.env.PATH, TMPDIR: scratch,
      AYAMAI_SNAPSHOT_ROOT: snaps, AYAMAI_SNAPSHOT_PASSPHRASE_FILE: pass, GNUPGHOME: gnupg };
    const command = (args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...env, ...extra } });
    const ok = r => assert.equal(r.status, 0, r.stderr + r.stdout);
    const bad = r => { assert.notEqual(r.status, 0); assert.doesNotMatch(r.stderr + r.stdout, /PRIVATE_|synthetic-test-passphrase|URL_SECRET/); };
    const decrypt = (dir, f) => run("gpg", ["--batch", "--pinentry-mode", "loopback", "--passphrase-file", pass, "--decrypt", path.join(dir, f + ".gpg")], { env });
    let snap;
    await t.test("encrypted capture, real marker splitting, sanitization and complete identities", () => {
      ok(command(["snapshot", "--source", source]));
      snap = path.join(snaps, fs.readdirSync(snaps)[0]);
      assert.deepEqual(fs.readdirSync(scratch), []);
      assert.ok(fs.readdirSync(snap).every(f => f === "index.json" || f.endsWith(".gpg")));
      const sql = decrypt(snap, "data.sql");
      assert.doesNotMatch(sql, /PRIVATE_/);
      assert.match(sql, /Fixture/);
      const meta = JSON.parse(decrypt(snap, "meta.json"));
      for (const id of ["prod_owner", "prod_other", "prod_blocked_only", "prod_moderator_only", "prod_redeemed_only", "prod_created_only", "prod_accepted_only"]) assert.ok(meta.identity_ids.includes(id), id);
      for (const col of ["social_blocks.blocked_user_id", "social_reports.moderator_id"]) assert.ok(meta.identity_columns.includes(col));
      assert.equal(meta.tables.media_items, 1);
      ok(command(["verify", snap]));
    });
    await t.test("media CLI refuses missing/invalid caps before credentials or network", () => {
      for (const cap of [undefined, "0", "-1", "NaN", "Infinity", "1.5"]) {
        const args = ["media-copy", snap, "--owner", "prod_owner"];
        if (cap !== undefined) args.push("--max-bytes", cap);
        bad(command(args));
      }
      ok(command(["media-copy", snap, "--owner", "prod_owner", "--max-bytes", "4"]));
      bad(command(["media-copy", snap, "--owner", "prod_owner", "--max-bytes", "3"]));
    });
    const mapping = path.join(root, "mapping.json");
    fs.writeFileSync(mapping, JSON.stringify({ mappings: { prod_owner: "dev_owner" } }));
    await t.test("FK-filled restore works as non-superuser and installs constraints/triggers after mapping", () => {
      ok(command(["restore", snap, "--target", target, "--identity-map", mapping], { PGHOSTADDR: "192.0.2.1", PGSERVICE: "must_not_resolve" }));
      assert.equal(psql(target, "SELECT user_id FROM media_items").trim(), "dev_owner");
      assert.match(psql(target, "SELECT blocked_user_id FROM social_blocks"), /^dev-unmapped:/);
      assert.match(psql(target, "SELECT moderator_id FROM social_reports"), /^dev-unmapped:/);
      assert.equal(psql(target, "SELECT count(*) FROM creator_follows").trim(), "1");
      assert.equal(psql(target, "SELECT count(*) FROM import_files").trim(), "1");
      assert.equal(psql(target, "SELECT count(*) FROM label_export_rows").trim(), "1");
      assert.equal(psql(target, "SELECT count(*) FROM membership_invitations").trim(), "0");
      assert.throws(() => sh("psql", [target, "-v", "ON_ERROR_STOP=1", "-c", "UPDATE media_items SET title='x'"]));
      assert.throws(() => sh("psql", [target, "-v", "ON_ERROR_STOP=1", "-c", "INSERT INTO creator_follows VALUES ('missing','00000000-0000-0000-0000-000000000002')"]));
      assert.deepEqual(fs.readdirSync(scratch), []);
    });
    await t.test("partial map cannot target IDs only present elsewhere in production", () => {
      fs.writeFileSync(mapping, JSON.stringify({ mappings: { prod_owner: "prod_redeemed_only" } }));
      bad(command(["restore", snap, "--target", target, "--identity-map", mapping]));
      assert.equal(psql(target, "SELECT user_id FROM media_items").trim(), "dev_owner");
      assert.deepEqual(fs.readdirSync(scratch), []);
      fs.writeFileSync(mapping, JSON.stringify({ mappings: { prod_owner: "dev_owner" } }));
    });
    await t.test("late restore failure rolls back reset/schema/data/map and cleans plaintext", () => {
      const broken = path.join(snaps, "broken"); fs.cpSync(snap, broken, { recursive: true });
      const post = path.join(root, "post.sql");
      fs.writeFileSync(post, decrypt(snap, "post-data.sql") + "\nSELECT 'PRIVATE_FAILURE_ROW'::integer;\n");
      run("gpg", ["--batch", "--yes", "--pinentry-mode", "loopback", "--passphrase-file", pass, "--symmetric", "-o", path.join(broken, "post-data.sql.gpg"), post], { env });
      const indexFile = path.join(broken, "index.json"); const index = JSON.parse(fs.readFileSync(indexFile));
      index.files["post-data.sql.gpg"].sha256 = sha256File(path.join(broken, "post-data.sql.gpg"));
      fs.writeFileSync(indexFile, JSON.stringify(index));
      bad(command(["restore", broken, "--target", target, "--identity-map", mapping]));
      assert.equal(psql(target, "SELECT user_id FROM media_items").trim(), "dev_owner");
      assert.equal(psql(target, "SELECT count(*) FROM creator_follows").trim(), "1");
      assert.deepEqual(fs.readdirSync(scratch), []);
      fs.rmSync(broken, { recursive: true });
    });
    await t.test("unknown column and encryption failure remove all capture plaintext/partial snapshots", () => {
      run(pg("psql"), [source, "-c", "ALTER TABLE media_items ADD COLUMN private_unreviewed text DEFAULT 'PRIVATE_NEW'"]);
      bad(command(["snapshot", "--source", source]));
      run(pg("psql"), [source, "-c", "ALTER TABLE media_items DROP COLUMN private_unreviewed"]);
      const fake = path.join(root, "fake"); fs.mkdirSync(fake);
      fs.writeFileSync(path.join(fake, "gpg"), "#!/bin/sh\necho PRIVATE_GPG_ERROR >&2\nexit 1\n", { mode: 0o700 });
      bad(command(["snapshot", "--source", source], { PATH: fake + path.delimiter + env.PATH }));
      assert.deepEqual(fs.readdirSync(scratch), []);
      assert.deepEqual(fs.readdirSync(snaps).filter(f => f !== "backups"), [path.basename(snap)]);
      bad(command(["snapshot", "--source", source], { AYAMAI_SNAPSHOT_PASSPHRASE_FILE: path.join(root, "absent") }));
      bad(command(["snapshot", "--source", "postgresql://u:URL_SECRET@127.0.0.1:1/missing"]));
      assert.deepEqual(fs.readdirSync(scratch), []);
    });
    await t.test("schema/data/catalog/manifest/identities share exported snapshot despite concurrent writes", async () => {
      await withSourceSnapshot(source, async snapshot => {
        run(pg("psql"), [source, "-c", "INSERT INTO members VALUES ('concurrent_id',NULL,'direct'); ALTER TABLE members ADD COLUMN concurrent_column text; ALTER TABLE media_items DISABLE TRIGGER fixture_trigger; UPDATE media_items SET user_id='concurrent_id'; ALTER TABLE media_items ENABLE TRIGGER fixture_trigger"]);
        assert.equal(psql(source, "SELECT count(*) FROM members", { snapshot }).trim(), "2");
        assert.doesNotMatch(psql(source, "SELECT user_id FROM members", { snapshot }), /concurrent_id/);
        const inventory = psql(source, "SELECT json_build_object('user_id',user_id,'size',size) FROM media_items", { snapshot });
        assert.equal(JSON.parse(inventory.trim()).user_id, "prod_owner");
        const columns = psql(source, "SELECT column_name FROM information_schema.columns WHERE table_name='members'", { snapshot });
        assert.doesNotMatch(columns, /concurrent_column/);
        const dump = sh("pg_dump", ["--schema-only", "--snapshot", snapshot, "-d", source]);
        assert.doesNotMatch(dump, /concurrent_column/);
        const out = sh("psql", buildCaptureArgs(source, ["members"], { members: [{ table: "members", name: "user_id", nullable: false, dataType: "text" }] }, "MARK", snapshot));
        assert.equal(splitCaptureOutput(out, "MARK", 1)[0], "prod_owner\nprod_other\n");
      });
    });
    assert.deepEqual(fs.readdirSync(scratch), []);
  } finally {
    if (started) run(pg("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
