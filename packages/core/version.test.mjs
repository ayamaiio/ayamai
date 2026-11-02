import test from "node:test";
import assert from "node:assert/strict";

import { calver, nextVersion, parseVersion, versionsOf, agree } from "./version.mjs";

const day = new Date(Date.UTC(2026, 10, 2));

test("a calendar version is the UTC date, padded", () => {
  assert.equal(calver(day), "2026.11.02");
  assert.equal(calver(new Date(Date.UTC(2026, 0, 9))), "2026.01.09");
});

test("a day can be released twice", () => {
  assert.equal(nextVersion("2026.11.01", day), "2026.11.02");
  assert.equal(nextVersion("2026.11.02", day), "2026.11.02.1");
  assert.equal(nextVersion("2026.11.02.1", day), "2026.11.02.2");
  assert.equal(nextVersion(null, day), "2026.11.02");
});

test("parsing round-trips", () => {
  assert.deepEqual(parseVersion("2026.11.02"), { year: 2026, month: 11, day: 2, patch: null });
  assert.deepEqual(parseVersion("2026.11.02.3"), { year: 2026, month: 11, day: 2, patch: 3 });
  assert.equal(parseVersion("0.1.0"), null);
});

test("agreement is the release gate", () => {
  const versions = versionsOf({
    catalog: { entries: [{ id: "platform", version: "2026.11.02" }] },
    manifests: [{ id: "gemu", version: "2026.11.02", file: "projects/gemu/project.json" }],
  });
  assert.equal(agree(versions).ok, true);
  assert.equal(agree(versions).version, "2026.11.02");

  const bad = versionsOf({ catalog: { entries: [{ id: "platform", version: "2026.11.02" }] }, manifests: [{ id: "gemu", version: "0.1.0", file: "x" }] });
  const verdict = agree(bad);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.mismatch[0].id, "gemu");
});
