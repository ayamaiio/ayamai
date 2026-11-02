import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, cloudAccountsTable as accounts, cloudAuthorizationsTable as states, importJobsTable as jobs, importFilesTable as files } from "@workspace/db";
import { z } from "zod/v4";
import { sealSource, openSealedSource } from "./source-crypto";
import { cloudScopes, providerJson, providerRequest, tokenEndpoints, tokensSchema, type CloudCredentials, type CloudProvider } from "./cloud-api";
import { ImportError } from "./network";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const aad = (userId: string, provider: CloudProvider) => `cloud-account-v1:${provider}:${userId}`;
export function cloudConfig(provider: CloudProvider) {
  const prefix = provider === "drive" ? "GOOGLE_DRIVE" : "DROPBOX";
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  const origin = process.env.CLOUD_IMPORT_ORIGIN;
  if (!clientId || !clientSecret || !origin || !process.env.SESSION_SECRET) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.username || parsed.password) return null;
  } catch { return null; }
  return { clientId, clientSecret, origin, redirectUri: `${origin}/api/imports/accounts/${provider}/callback` };
}
export async function cloudAccountStatus(userId: string) {
  const rows = await db.select({ provider: accounts.provider }).from(accounts).where(eq(accounts.userId, userId));
  return (["drive", "dropbox"] as const).map((provider) => ({
    provider, configured: !!cloudConfig(provider), connected: rows.some((row) => row.provider === provider),
  }));
}
export async function beginCloudAuthorization(userId: string, provider: CloudProvider) {
  const config = cloudConfig(provider);
  if (!config) throw new ImportError("This provider needs OAuth app configuration before accounts can be connected.");
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 5319))`);
    await tx.delete(states).where(lt(states.expiresAt, new Date()));
    // Only the latest authorization attempt for this user/provider stays valid.
    await tx.delete(states).where(and(eq(states.userId, userId), eq(states.provider, provider)));
    await tx.insert(states).values({
      stateHash: hash(state), userId, provider,
      encryptedVerifier: sealSource(verifier, aad(userId, provider)),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  });
  const params = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code",
    scope: cloudScopes[provider], state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    ...(provider === "drive" ? { access_type: "offline", prompt: "consent" } : { token_access_type: "offline" }),
  });
  return { state, url: `${provider === "drive" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://www.dropbox.com/oauth2/authorize"}?${params}` };
}
export async function finishCloudAuthorization(userId: string, provider: CloudProvider, state: string, code?: string) {
  const config = cloudConfig(provider);
  if (!config) throw new ImportError("Provider configuration is unavailable.");
  const error = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 5319))`);
    // Consume state under the same lock as disconnect. Return failures instead
    // of throwing so the deletion commits even on a denied or failed exchange.
    const [attempt] = await tx.delete(states).where(and(
      eq(states.stateHash, hash(state)), eq(states.userId, userId), eq(states.provider, provider),
    )).returning();
    if (!attempt || attempt.expiresAt < new Date() || !code) return new ImportError("Authorization was cancelled or expired. Please connect again.");
    try {
    const token = tokensSchema.parse(await providerJson(tokenEndpoints[provider], {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: config.redirectUri,
        client_id: config.clientId, client_secret: config.clientSecret,
        code_verifier: openSealedSource(attempt.encryptedVerifier, aad(userId, provider)),
      }).toString(),
    }, AbortSignal.timeout(20_000)));
    if (!token.refresh_token || (token.scope && cloudScopes[provider].split(" ").some((scope) => !token.scope!.split(" ").includes(scope)))) {
      throw new ImportError("Read-only file access was not granted. Reconnect and approve the requested permissions.");
    }
    const encryptedCredentials = sealSource(JSON.stringify({
      accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000,
    } satisfies CloudCredentials), aad(userId, provider));
    // Reconnect invalidates old job references instead of silently switching their account.
    await tx.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.provider, provider)));
    await tx.insert(accounts).values({ userId, provider, encryptedCredentials });
    return null;
    } catch (error) {
      return error instanceof ImportError ? error : new ImportError("Cloud authorization failed. Please connect again.");
    }
  });
  if (error) throw error;
}

const credentialsSchema = z.object({ accessToken: z.string(), refreshToken: z.string(), expiresAt: z.number() });
export async function cloudAccess(userId: string, provider: CloudProvider, accountId?: string, signal = AbortSignal.timeout(25_000)) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(accounts).where(and(
      eq(accounts.userId, userId), eq(accounts.provider, provider), ...(accountId ? [eq(accounts.id, accountId)] : []),
    )).for("update");
    if (!row) throw new ImportError("This cloud account was disconnected. Connect it and create a new preview.");
    let credentials = credentialsSchema.parse(JSON.parse(openSealedSource(row.encryptedCredentials, aad(userId, provider))));
    if (credentials.expiresAt < Date.now() + 60_000) {
      const config = cloudConfig(provider);
      if (!config) throw new ImportError("Provider configuration is unavailable.");
      const refreshed = tokensSchema.parse(await providerJson(tokenEndpoints[provider], {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token", refresh_token: credentials.refreshToken,
          client_id: config.clientId, client_secret: config.clientSecret,
        }).toString(),
      }, signal));
      credentials = {
        accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token ?? credentials.refreshToken,
        expiresAt: Date.now() + refreshed.expires_in * 1000,
      };
      await tx.update(accounts).set({ encryptedCredentials: sealSource(JSON.stringify(credentials), aad(userId, provider)) }).where(eq(accounts.id, row.id));
    }
    return { accountId: row.id, accessToken: credentials.accessToken };
  });
}

export async function disconnectCloudAccount(userId: string, provider: CloudProvider) {
  const removed = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 5319))`);
    await tx.delete(states).where(and(eq(states.userId, userId), eq(states.provider, provider)));
    const rows = await tx.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.provider, provider))).returning();
    const pending = await tx.select().from(jobs).where(and(eq(jobs.userId, userId), eq(jobs.provider, provider))).for("update");
    for (const job of pending) {
      let source: unknown;
      try { source = JSON.parse(openSealedSource(job.encryptedSource, userId)); } catch { continue; }
      if (!source || typeof source !== "object" || !("kind" in source) || source.kind !== "cloud-account") continue;
      if (job.status === "preview") {
        await tx.update(files).set({ status: "cancelled" }).where(eq(files.jobId, job.id));
        await tx.update(jobs).set({ status: "cancelled", encryptedSource: "" }).where(eq(jobs.id, job.id));
      } else if (["queued", "processing", "cancelling"].includes(job.status)) {
        await tx.update(jobs).set({ status: "cancelling", encryptedSource: "" }).where(eq(jobs.id, job.id));
      } else {
        await tx.update(jobs).set({ encryptedSource: "" }).where(eq(jobs.id, job.id));
      }
    }
    return rows;
  });
  // Local deletion always wins, even if revocation is temporarily unavailable.
  // No credential survives a disconnect or can be resurrected by a refresh.
  for (const row of removed) {
    try {
      const credentials = credentialsSchema.parse(JSON.parse(openSealedSource(row.encryptedCredentials, aad(userId, provider))));
      const response = await providerRequest(provider === "drive"
        ? "https://oauth2.googleapis.com/revoke" : "https://api.dropboxapi.com/2/auth/token/revoke",
      provider === "drive" ? {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: credentials.refreshToken }).toString(),
      } : { method: "POST", headers: { Authorization: `Bearer ${credentials.accessToken}` } }, AbortSignal.timeout(10_000));
      await response.body?.cancel();
    } catch { /* Credentials are already purged. Provider settings can revoke grants independently. */ }
  }
}

export function sealCloudCursor(userId: string, provider: CloudProvider, accountId: string, folder: string, cursor: string) {
  return sealSource(JSON.stringify({ accountId, folder, cursor, expires: Date.now() + 30 * 60_000 }), `cloud-cursor:${provider}:${userId}`);
}
export function openCloudCursor(value: string, userId: string, provider: CloudProvider, accountId: string, folder: string) {
  try {
    const parsed = z.object({ accountId: z.string(), folder: z.string(), cursor: z.string(), expires: z.number() })
      .parse(JSON.parse(openSealedSource(value, `cloud-cursor:${provider}:${userId}`)));
    if (parsed.accountId !== accountId || parsed.folder !== folder || parsed.expires < Date.now()) throw new Error();
    return parsed.cursor;
  } catch { throw new ImportError("This folder page expired. Open the folder again."); }
}
