import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { assertLocalTarget, sh } from "../util.mjs";
import { validByteCap, copyMediaBody, assertNoSymlinks } from "../lib.mjs";
import {
  columnExpr, buildCaptureArgs, splitCaptureOutput, countRows, buildRestoreArgs,
  validateIdentityMap, safeDestPath, verifyIntegrity, unknownTables,
} from "../lib.mjs";

const cols = (table, defs) => defs.map(([name, dataType, nullable]) => ({ table, name, dataType, nullable }));

test("defect 1: capture is one read-only REPEATABLE READ transaction", () => {
  const marker = "__M__";
  const args = buildCaptureArgs("postgres://x", ["media_items", "members"], {
    media_items: cols("media_items", [["id", "uuid", false]]),
    members: cols("members", [["user_id", "text", false]]),
  }, marker);
  assert.ok(args.includes("-1"), "psql must run as a single transaction");
  assert.ok(args.some((a) => /SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/.test(a)));
  assert.equal(args.filter((a) => a.includes("COPY (SELECT")).length, 2);
  assert.equal(args.filter((a) => a.includes(marker)).length, 2, "one marker per table");
});

test("defect 1: capture output splits into per-table segments", () => {
  const marker = "__END__";
  const out = `a\tb\n__END__\nc\td\ne\tf\n__END__`;
  const segs = splitCaptureOutput(out, marker, 2);
  assert.equal(segs.length, 2);
  assert.equal(countRows(segs[0]), 1);
  assert.equal(countRows(segs[1]), 2);
});

test("defect 2: restore applies every file inside one transaction", () => {
  const args = buildRestoreArgs("postgres://local", ["/tmp/a.sql", "/tmp/b.sql"]);
  assert.ok(args.includes("-1"));
  assert.equal(args.filter((a) => a === "-f").length, 2);
});

test("defect 3: unreviewed table blocks capture (fail-closed)", () => {
  assert.deepEqual(unknownTables(["media_items", "members", "zz_new"]), ["zz_new"]);
  assert.deepEqual(unknownTables(["media_items", "cloud_accounts"]), [], "excluded tables are known");
});

test("defect 4: denied NOT NULL columns get a stable placeholder, not a real value", () => {
  const expr = columnExpr({ table: "access_memberships", name: "email", dataType: "text", nullable: false });
  assert.match(expr, /^\(\'redacted-\' \|\| substr\(md5\(ctid::text\),1,12\)\)$/);
  assert.equal(columnExpr({ table: "x", name: "email", dataType: "text", nullable: true }), "NULL");
});

test("sanitization empties free-form fields and keeps structured media metadata", () => {
  assert.equal(columnExpr({ table: "media_items", name: "description", dataType: "text", nullable: false }), "''");
  assert.equal(columnExpr({ table: "import_jobs", name: "posting", dataType: "jsonb", nullable: true }), "NULL");
  assert.equal(columnExpr({ table: "label_export_rows", name: "record", dataType: "jsonb", nullable: false }), "'{}'::jsonb");
  assert.equal(columnExpr({ table: "media_annotations", name: "notes", dataType: "text", nullable: false }), "''");
  assert.equal(columnExpr({ table: "media_items", name: "title", dataType: "text", nullable: false }), '"title"');
  assert.equal(columnExpr({ table: "media_items", name: "object_key", dataType: "text", nullable: false }), '"object_key"');
});

test("defect 5: integrity check rejects corrupted or missing snapshot files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-test-"));
  try {
    fs.writeFileSync(path.join(dir, "data.sql.gpg"), "ciphertext");
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({
      files: { "data.sql.gpg": { sha256: "0".repeat(64) } },
    }));
    assert.throws(() => verifyIntegrity(dir), /corrupt/);
    fs.rmSync(path.join(dir, "data.sql.gpg"));
    assert.throws(() => verifyIntegrity(dir), /missing/);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "snap-empty-"));
    assert.throws(() => verifyIntegrity(empty), /no index\.json/);
    fs.rmSync(empty, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("defect 6: media keys cannot escape the destination directory", () => {
  const dest = path.join(os.tmpdir(), "ayamai-dest");
  assert.equal(safeDestPath(dest, "media/u1/a.mp4"), path.join(dest, "media/u1/a.mp4"));
  assert.throws(() => safeDestPath(dest, "../../etc/passwd"), /escapes destination/);
  assert.throws(() => safeDestPath(dest, "media/../../x"), /escapes destination/);
  assert.equal(safeDestPath(dest, "/media/u1/a.mp4"), path.join(dest, "media/u1/a.mp4"), "absolute keys are re-rooted");
});

test("defect 7: identity map rejects ambiguous or privileged targets", () => {
  assert.throws(
    () => validateIdentityMap({ mappings: { a: "same", b: "same" } }),
    /one dev account must not inherit two identities/,
  );
  assert.throws(
    () => validateIdentityMap({ mappings: { a: "dev-unmapped:abc" } }),
    /reserved dev-unmapped prefix/,
  );
  assert.throws(
    () => validateIdentityMap({ mappings: { a: "prod1", prod1: "dev1" } }),
    /is itself a production subject/,
  );
  const pairs = validateIdentityMap({ mappings: { prod1: "dev1", prod2: "" } });
  assert.deepEqual(pairs, [["prod1", "dev1"]], "blank mappings are ignored");
});

test("unmapped identities become inert placeholders", () => {
  const pairs = validateIdentityMap({ mappings: { prod1: "" } });
  assert.equal(pairs.length, 0);
});

test("capture marker is exactly one psql backslash command", () => {
  const args = buildCaptureArgs("x", ["members"], { members: cols("members", [["user_id", "text", false]]) }, "MARK");
  assert.equal(args.at(-1), "\\echo MARK");
  assert.equal(args.at(-1).charCodeAt(1), "e".charCodeAt(0));
});

test("local guard rejects every libpq override without leaking credentials", () => {
  const options = { allowDb: "ayamai_local", allowHost: "127.0.0.1", allowPort: "5434" };
  const url = "postgres://user:DO_NOT_LOG@127.0.0.1:5434/ayamai_local";
  assert.doesNotThrow(() => assertLocalTarget(url, options));
  for (const query of ["host=remote.invalid", "hostaddr=1.2.3.4", "port=5432&dbname=production", "service=production", "options=-c%20session_replication_role=replica", "password=QUERY_SECRET", "host=localhost&host=remote"]) {
    assert.throws(() => assertLocalTarget(`${url}?${query}`, options), err => !err.message.includes("DO_NOT_LOG") && !err.message.includes("QUERY_SECRET"));
  }
  assert.throws(() => sh(process.execPath, ["-e", "console.error('PRIVATE_COPY_ROW');process.exit(1)", "PASSWORD_SECRET"]), err => !/PRIVATE_COPY_ROW|PASSWORD_SECRET/.test(err.message));
});

test("new columns require review and additional private content is sanitized", () => {
  assert.throws(() => columnExpr({ table: "media_items", name: "new_private_blob" }), /Unreviewed/);
  for (const [table, name] of [["social_comments", "text"], ["social_reports", "reason"], ["video_reviews", "text"], ["import_files", "error"], ["import_files", "upload_id"], ["social_profiles", "display_name"]]) {
    assert.equal(columnExpr({ table, name, nullable: false, dataType: "text" }), "''");
  }
});

test("partial mappings cannot target any captured production identity", () => {
  assert.throws(() => validateIdentityMap({ mappings: { p1: "p2" } }, ["p1", "p2"]), /production subject/);
  assert.throws(() => validateIdentityMap({ mappings: { unknown: "dev" } }, ["p1"]), /unknown/);
  for (const value of [null, 1, {}, [], " "]) assert.throws(() => validateIdentityMap({ mappings: { p1: value } }, ["p1"]));
});

test("media cap is mandatory, finite, positive and integral", () => {
  for (const cap of [undefined, "", "0", "-1", "NaN", "Infinity", "1.5", "1e3", "9007199254740992"]) assert.throws(() => validByteCap(cap));
  assert.equal(validByteCap("100"), 100);
});

test("media streaming enforces declared and cumulative caps and removes partials", { skip: process.platform !== "linux" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-test-"));
  try {
    const out = path.join(dir, "x");
    await assert.rejects(copyMediaBody(Readable.from([Buffer.from("123"), Buffer.from("456")]), out, 5, { remaining: 10 }), /byte cap/);
    assert.equal(fs.existsSync(out), false);
    await assert.rejects(copyMediaBody(Readable.from([Buffer.from("1234")]), out, 4, { remaining: 3 }), /byte cap/);
    assert.equal(fs.existsSync(out), false);
    await assert.rejects(copyMediaBody(Readable.from([Buffer.from("12")]), out, 4, { remaining: 4 }), /size mismatch/);
    const budget = { remaining: 4 };
    assert.equal((await copyMediaBody(Readable.from([Buffer.from("1234")]), out, 4, budget)).bytes, 4);
    assert.equal(budget.remaining, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("media refuses symlink parents and final symlinks", { skip: process.platform === "win32" ? "Windows symlink privilege; exercised in Linux integration container" : false }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-links-"));
  try {
    fs.mkdirSync(path.join(dir, "outside"));
    fs.symlinkSync(path.join(dir, "outside"), path.join(dir, "link"));
    assert.throws(() => assertNoSymlinks(path.join(dir, "link", "x")), /Symlink/);
    await assert.rejects(copyMediaBody(Readable.from([Buffer.from("x")]), path.join(dir, "link", "x"), 1, { remaining: 1 }), /Symlink/);
    fs.symlinkSync(path.join(dir, "outside", "target"), path.join(dir, "final"));
    await assert.rejects(copyMediaBody(Readable.from([]), path.join(dir, "final"), 0, { remaining: 1 }), /Symlink/);
    assert.deepEqual(fs.readdirSync(path.join(dir, "outside")), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test("capture splitting fails closed on absent, extra or truncated markers", () => {
  for (const out of ["a\n", "a\nM\nb\n", "a\nM\nM\n"]) assert.throws(() => splitCaptureOutput(out, "M", 1), /markers/);
  assert.deepEqual(splitCaptureOutput("aMARKb\nMARK\n", "MARK", 1), ["aMARKb\n"]);
});

test("parent replacement cannot redirect a media write through a symlink", { skip: process.platform !== "linux" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-race-"));
  const dest = path.join(root, "dest"); const moved = path.join(root, "moved"); const outside = path.join(root, "outside");
  fs.mkdirSync(dest); fs.mkdirSync(outside);
  const originalOpen = fs.openSync;
  let swapped = false;
  try {
    fs.openSync = (file, ...args) => {
      if (String(file).startsWith("/proc/self/fd/") && String(file).endsWith("/payload") && !swapped) {
        swapped = true; fs.renameSync(dest, moved); fs.symlinkSync(outside, dest);
      }
      return originalOpen(file, ...args);
    };
    await copyMediaBody(Readable.from([Buffer.from("safe")]), path.join(dest, "payload"), 4, { remaining: 4 });
    assert.equal(swapped, true);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(fs.readFileSync(path.join(moved, "payload"), "utf8"), "safe");
  } finally { fs.openSync = originalOpen; fs.rmSync(root, { recursive: true, force: true }); }
});
