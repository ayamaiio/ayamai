import assert from "node:assert/strict";
import test from "node:test";
import { ACCESS_INVITE_LIMIT, countOccupiedInviteSlots, hasAvailableInviteSlot } from "./access-policy";

test("capacity counts pending invitations and accepted members, not the owner", () => {
  assert.equal(countOccupiedInviteSlots(2, 3), ACCESS_INVITE_LIMIT);
  assert.equal(hasAvailableInviteSlot(2, 3), false);
  assert.equal(countOccupiedInviteSlots(2, 2), 4);
  assert.equal(hasAvailableInviteSlot(2, 2), true);
});

test("capacity never becomes available from negative database counts", () => {
  assert.equal(countOccupiedInviteSlots(-1, 1), 1);
  assert.equal(hasAvailableInviteSlot(-1, 4), true);
});
