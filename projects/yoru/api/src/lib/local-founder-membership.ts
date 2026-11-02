import { and, eq, sql } from "drizzle-orm";
import { accessMembershipsTable as memberships, socialAccountsTable as socialAccounts, db } from "@workspace/db";
import { LOCAL_DEV_EMAIL, LOCAL_DEV_SUBJECT } from "./local-dev-auth";

const LOCAL_OWNER_LOCK_KEY = 704_251_822;

export async function ensureLocalFounderMembership(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCAL_OWNER_LOCK_KEY})`);
    const [existing] = await tx.select().from(memberships).where(eq(memberships.userId, LOCAL_DEV_SUBJECT)).limit(1);
    if (existing) {
      if (existing.email === LOCAL_DEV_EMAIL && existing.role === "owner" && existing.status === "active") return;
      throw new Error("The isolated local founder membership conflicts with an existing local record.");
    }
    const [owner] = await tx.select({ userId: memberships.userId }).from(memberships)
      .where(and(eq(memberships.role, "owner"), eq(memberships.status, "active"))).limit(1);
    const [email] = await tx.select({ userId: memberships.userId }).from(memberships)
      .where(and(eq(memberships.email, LOCAL_DEV_EMAIL), eq(memberships.status, "active"))).limit(1);
    if (email && email.userId !== owner?.userId) {
      throw new Error("The local founder email is already assigned to another local identity.");
    }
    if (owner) {
      // The owner explicitly authorized moving this local owner grant to the
      // dedicated developer subject. Media ownership and source records stay put.
      await tx.update(memberships).set({
        userId: LOCAL_DEV_SUBJECT,
        email: LOCAL_DEV_EMAIL,
      }).where(and(
        eq(memberships.userId, owner.userId),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active"),
      ));
    } else {
      await tx.insert(memberships).values({
        userId: LOCAL_DEV_SUBJECT, email: LOCAL_DEV_EMAIL, role: "owner", status: "active", revokedAt: null,
      });
    }
    // The account holder has already accepted the age/content policy. Keep
    // optional recommendation sharing off for this isolated local identity.
    await tx.insert(socialAccounts).values({
      userId: LOCAL_DEV_SUBJECT, acceptedAt: new Date(), collaborativeConsent: false,
    }).onConflictDoNothing();
  });
}
