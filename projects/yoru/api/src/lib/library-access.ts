import { and, eq, or, sql } from "drizzle-orm";
import { accessMembershipsTable, mediaItemsTable as media } from "@workspace/db";

// GOD is the existing server-managed owner role, bound to a Clerk subject.
// Never infer it from a display name, email supplied by a client, or moderator status.
// Keep this in SQL so revocations apply to every page and ticket redemption.
export function globalLibraryReader(userId: string) {
  return sql`exists (select 1 from ${accessMembershipsTable} god
    where god.user_id = ${userId} and god.role = 'owner' and god.status = 'active')`;
}

export function libraryReadScope(userId: string) {
  return and(eq(media.moderationState, "active"),
    or(eq(media.userId, userId), globalLibraryReader(userId)))!;
}
