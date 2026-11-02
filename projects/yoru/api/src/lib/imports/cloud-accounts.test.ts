import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db, pool, cloudAccountsTable as accounts, cloudAuthorizationsTable as states,
  importJobsTable as jobs, importFilesTable as files, mediaItemsTable as media,
} from "@workspace/db";
import { cloudAccess, cloudConfig } from "./cloud-accounts";
import { openImportSource } from "./cloud-source";
import { sealSource } from "./source-crypto";
import { cloudScopes, type CloudProvider } from "./cloud-api";
import { processImportJob, IMPORT_WORKER_LOCK } from "./worker";
import express from "express";
import router from "../../routes/cloud-accounts";
import importsRouter from "../../routes/imports";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sVEAAAAASUVORK5CYII=", "base64");

test("per-user OAuth, authorized durable imports, and disconnect integration", async (t) => {
  const userId = `cloud-test-${randomUUID()}`, otherUserId = `cloud-test-${randomUUID()}`;
  const origin = "https://cloud-fixture.example";
  // Synthetic provider app configuration only; never read or alter a real credential.
  const configKeys = ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "DROPBOX_CLIENT_ID", "DROPBOX_CLIENT_SECRET", "CLOUD_IMPORT_ORIGIN"] as const;
  if (configKeys.some((key) => process.env[key])) {
    await pool.end();
    t.skip("Run these synthetic OAuth tests without real provider app configuration.");
    return;
  }
  const lock = await pool.connect();
  const acquired = await lock.query("select pg_try_advisory_lock($1) as locked", [IMPORT_WORKER_LOCK]);
  if (!acquired.rows[0]?.locked) {
    lock.release(); await pool.end();
    t.skip("An import worker is active; rerun when it is idle."); return;
  }
  process.env.GOOGLE_DRIVE_CLIENT_ID = "fixture-drive-client";
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = "fixture-drive-secret";
  process.env.DROPBOX_CLIENT_ID = "fixture-dropbox-client";
  process.env.DROPBOX_CLIENT_SECRET = "fixture-dropbox-secret";
  process.env.CLOUD_IMPORT_ORIGIN = origin;
  const nativeFetch = globalThis.fetch;
  let refreshCalls = 0;
  let sourceCalls = 0;
  const mockFetch = t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(init?.redirect, "error");
    if (url.pathname.endsWith("/token")) {
      const body = new URLSearchParams(String(init?.body));
      assert.ok(body.get("client_secret")?.startsWith("fixture-"));
      if (body.get("grant_type") === "refresh_token") refreshCalls++;
      else {
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.ok(body.get("code_verifier")!.length >= 43);
        assert.ok(body.get("redirect_uri")!.startsWith(origin));
      }
      const provider = url.hostname === "oauth2.googleapis.com" ? "drive" : "dropbox";
      return Response.json({
        access_token: "fixture-access", refresh_token: refreshCalls ? "fixture-rotated-refresh" : "fixture-refresh",
        expires_in: 3600, scope: cloudScopes[provider],
      });
    }
    if (url.pathname.includes("revoke")) return new Response(null, { status: 200 });
    if (url.searchParams.get("alt") === "media" || url.pathname.endsWith("/download")) {
      sourceCalls++;
      return new Response(png);
    }
    if (url.pathname.endsWith("/files/folder")) return Response.json({ id: "folder", name: "My folder", mimeType: "application/vnd.google-apps.folder" });
    if (url.pathname.endsWith("/files/photo")) return Response.json({ id: "photo", name: "photo.png", mimeType: "image/png", size: String(png.length) });
    if (url.pathname === "/drive/v3/files") return Response.json({ files: [
      { id: "photo", name: "photo.png", mimeType: "image/png", size: String(png.length) },
    ] });
    if (url.pathname.endsWith("list_folder")) return Response.json({
      entries: [{ ".tag": "file", id: "id:photo", name: "photo.png", size: png.length }], cursor: "fixture-cursor", has_more: false,
    });
    if (url.pathname.endsWith("get_metadata")) return Response.json({ ".tag": "file", id: "id:photo", name: "photo.png", size: png.length });
    throw new Error("Unexpected fixture provider endpoint");
  });
  let identity: string | null = userId;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { auth: Object.assign(() => ({ userId: identity, tokenType: "session_token" }), { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  app.use(router); app.use(importsRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, method = "GET", data?: object, cookie?: string, requestOrigin = origin) => nativeFetch(base + path, {
    method, headers: { Origin: requestOrigin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  async function authorize(provider: CloudProvider) {
    const response = await request(`/imports/accounts/${provider}/authorize`, "POST");
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
    assert.match(response.headers.get("set-cookie")!, /Secure/i);
    const { url } = await response.json() as { url: string };
    const target = new URL(url);
    assert.equal(target.searchParams.get("scope"), cloudScopes[provider]);
    assert.equal(target.searchParams.get("code_challenge_method"), "S256");
    assert.ok(!url.includes("fixture-drive-secret"));
    assert.ok(!url.includes("fixture-dropbox-secret"));
    return { state: target.searchParams.get("state")!, cookie };
  }
  const callback = (provider: CloudProvider, state: string) => `/imports/accounts/${provider}/callback?${new URLSearchParams({ state, code: "fixture-code" })}`;
  try {
    await t.test("auth and cross-site mutations are rejected; provider configuration fails explicitly", async () => {
      identity = null;
      assert.equal((await request("/imports/accounts")).status, 401);
      identity = userId;
      assert.equal((await request("/imports/accounts/drive/authorize", "POST", undefined, undefined, "https://evil.example")).status, 400);
      assert.equal(cloudConfig("drive")?.redirectUri, `${origin}/api/imports/accounts/drive/callback`);
    });
    await t.test("OAuth state is cookie-, user-, and provider-bound and is single-use", async () => {
      const attempt = await authorize("drive");
      assert.equal((await request(callback("drive", attempt.state))).status, 400);
      identity = otherUserId;
      assert.equal((await request(callback("drive", attempt.state), "GET", undefined, attempt.cookie)).status, 400);
      identity = userId;
      const done = await request(callback("drive", attempt.state), "GET", undefined, attempt.cookie);
      assert.equal(done.status, 200);
      const html = await done.text();
      assert.ok(!html.includes("fixture-access") && !html.includes("fixture-code"));
      assert.equal((await request(callback("drive", attempt.state), "GET", undefined, attempt.cookie)).status, 400);
      const dropbox = await authorize("dropbox");
      assert.equal((await request(callback("dropbox", dropbox.state), "GET", undefined, dropbox.cookie)).status, 200);
      const status = await (await request("/imports/accounts")).json() as { connected: boolean }[];
      assert.equal(status.filter((s) => s.connected).length, 2);
      assert.ok(!JSON.stringify(status).includes("fixture-access"));
      const saved = await db.select().from(accounts).where(eq(accounts.userId, userId));
      assert.ok(saved.every((row) => !row.encryptedCredentials.includes("fixture-")));
      identity = otherUserId;
      assert.ok((await (await request("/imports/accounts")).json() as { connected: boolean }[]).every((s) => !s.connected));
      assert.equal((await request("/imports/accounts/drive/entries")).status, 400);
      const own = saved.find((row) => row.provider === "drive")!;
      await assert.rejects(cloudAccess(otherUserId, "drive", own.id), /disconnected/);
      identity = userId;
    });
    await t.test("expired access refreshes once under concurrency and persists rotated credentials", async () => {
      const [row] = await db.select().from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.provider, "drive")));
      await db.update(accounts).set({ encryptedCredentials: sealSource(JSON.stringify({
        accessToken: "fixture-expired", refreshToken: "fixture-refresh", expiresAt: 1,
      }), `cloud-account-v1:drive:${userId}`) }).where(eq(accounts.id, row!.id));
      const values = await Promise.all([cloudAccess(userId, "drive"), cloudAccess(userId, "drive")]);
      assert.equal(refreshCalls, 1);
      assert.ok(values.every((value) => value.accessToken === "fixture-access"));
    });
    await t.test("authorized folders produce durable previews and stream into the existing verified storage pipeline", async () => {
      assert.equal((await request("/imports/accounts/dropbox/entries")).status, 200);
      const response = await request("/imports/accounts/drive/preview", "POST", { ids: ["folder", "photo"] });
      assert.equal(response.status, 201);
      const preview = await response.json() as { id: string; files: { id: string }[] };
      assert.equal(preview.files.length, 1);
      assert.ok(!JSON.stringify(preview).includes("fixture-access"));
      const start = await request(`/imports/${preview.id}/start`, "POST", { fileIds: preview.files.map((f) => f.id), posting: {
        visibility: "private", attribution: "anonymous", description: "", tags: [], rightsConfirmed: true,
      } });
      assert.equal(start.status, 200);
      const [job] = await db.select().from(jobs).where(eq(jobs.id, preview.id));
      const parts: Buffer[] = [];
      await processImportJob(job!, new AbortController().signal, {
        openSource: openImportSource,
        beginImportUpload: async () => "fixture-upload",
        uploadImportPart: async (_key, _uploadId, part, body) => { parts.push(Buffer.from(body)); return { ETag: "fixture-etag", PartNumber: part }; },
        finishImportUpload: async () => {},
        verifyUploadedObject: async (_key, size) => Buffer.concat(parts).length === size,
        abortImportUpload: async () => {}, deleteMediaObject: async () => {},
      });
      assert.equal(sourceCalls, 1);
      assert.deepEqual(Buffer.concat(parts), png);
      const [after] = await db.select().from(jobs).where(eq(jobs.id, preview.id));
      assert.equal(after?.status, "complete");
      assert.equal(after?.encryptedSource, "");
      const [asset] = await db.select().from(media).where(eq(media.userId, userId));
      assert.equal(asset?.visibility, "private");
    });
    await t.test("disconnect consumes pending auth, cancels jobs, clears credentials, and preserves finished media", async () => {
      const preview = await (await request("/imports/accounts/drive/preview", "POST", { ids: ["folder"] })).json() as { id: string };
      const [account] = await db.select().from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.provider, "drive")));
      const pendingAuth = await authorize("drive");
      identity = otherUserId;
      assert.equal((await request("/imports/accounts/drive", "DELETE")).status, 204);
      assert.equal((await db.select().from(accounts).where(eq(accounts.id, account!.id))).length, 1);
      identity = userId;
      assert.equal((await request("/imports/accounts/drive", "DELETE")).status, 204);
      assert.equal((await db.select().from(accounts).where(eq(accounts.id, account!.id))).length, 0);
      const [after] = await db.select().from(jobs).where(eq(jobs.id, preview.id));
      assert.equal(after?.status, "cancelled");
      assert.equal(after?.encryptedSource, "");
      await assert.rejects(cloudAccess(userId, "drive", account!.id), /disconnected/);
      assert.equal((await request(callback("drive", pendingAuth.state), "GET", undefined, pendingAuth.cookie)).status, 400);
      assert.equal((await db.select().from(media).where(eq(media.userId, userId))).length, 1);
    });
  } finally {
    mockFetch.mock.restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const id of [userId, otherUserId]) {
      await db.delete(states).where(eq(states.userId, id));
      await db.delete(accounts).where(eq(accounts.userId, id));
      await db.delete(jobs).where(eq(jobs.userId, id));
      await db.delete(media).where(eq(media.userId, id));
    }
    await lock.query("select pg_advisory_unlock($1)", [IMPORT_WORKER_LOCK]);
    lock.release(); await pool.end();
    for (const key of configKeys) delete process.env[key];
  }
});
