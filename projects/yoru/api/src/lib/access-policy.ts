export const ACCESS_INVITE_LIMIT = 5;

export function countOccupiedInviteSlots(activeMembers: number, pendingInvitations: number): number {
  return Math.max(0, activeMembers) + Math.max(0, pendingInvitations);
}

export function hasAvailableInviteSlot(activeMembers: number, pendingInvitations: number): boolean {
  return countOccupiedInviteSlots(activeMembers, pendingInvitations) < ACCESS_INVITE_LIMIT;
}
