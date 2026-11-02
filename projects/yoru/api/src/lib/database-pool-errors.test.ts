import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { observeDatabasePoolErrors } from "./database-pool-errors";

test("idle connection resets are handled instead of becoming fatal EventEmitter errors", () => {
  const pool = new EventEmitter();
  const reports: unknown[][] = [];
  observeDatabasePoolErrors(pool, { error: (...args) => { reports.push(args); } });
  assert.doesNotThrow(() => pool.emit("error", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })));
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0]?.[0], { event: "database_pool_idle_error", code: "ECONNRESET" });
  // The same pool remains observable after another idle failure.
  assert.doesNotThrow(() => pool.emit("error", Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
  assert.equal(reports.length, 2);
});

test("pool reporting excludes messages, stacks, query text and unknown error codes", () => {
  const pool = new EventEmitter();
  const reports: unknown[][] = [];
  observeDatabasePoolErrors(pool, { error: (...args) => { reports.push(args); } });
  const error = Object.assign(new Error("sensitive database URL and SQL"), {
    code: "sensitive-custom-value", query: "private user data",
  });
  pool.emit("error", error);
  pool.emit("error", undefined);
  assert.deepEqual(reports[0]?.[0], { event: "database_pool_idle_error", code: "UNKNOWN" });
  assert.equal(reports.length, 2);
  assert.doesNotMatch(JSON.stringify(reports), /sensitive|private user/);
});

test("reporting does not query, replay writes, terminate clients or replace existing listeners", () => {
  const pool = new EventEmitter();
  let existing = 0;
  pool.on("error", () => { existing++; });
  Object.assign(pool, {
    query: () => assert.fail("must not replay a query"),
    end: () => assert.fail("must not close the pool"),
  });
  observeDatabasePoolErrors(pool, { error: () => undefined });
  pool.emit("error", { code: "57P01" });
  assert.equal(existing, 1);
  assert.equal(pool.listenerCount("error"), 2);
});
