import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createMediaTicket, openMediaTicket } from "./media-tickets";

test("tickets hide identities, bind to one post, reject tampering, expire at five minutes", () => {
  const id = randomUUID(), viewer = "synthetic-viewer";
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const ticket = createMediaTicket(id, viewer);
    assert.ok(!Buffer.from(ticket, "base64url").toString().includes(viewer));
    assert.equal(openMediaTicket(id, ticket), viewer);
    assert.equal(openMediaTicket(randomUUID(), ticket), null);
    const tampered = Buffer.from(ticket, "base64url"); tampered[30] ^= 1;
    assert.equal(openMediaTicket(id, tampered.toString("base64url")), null);
    assert.equal(openMediaTicket(id, "x".repeat(2049)), null);
    now += 299999; assert.equal(openMediaTicket(id, ticket), viewer);
    now += 1; assert.equal(openMediaTicket(id, ticket), null);
  } finally { Date.now = originalNow; }
});
