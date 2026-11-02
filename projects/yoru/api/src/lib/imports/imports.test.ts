import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { API, File as MegaFile, encrypt } from "megajs";
import test from "node:test";
import { allowedHost, ImportError, isPublicAddress, safeRequest } from "./network";
import { detectMedia, openSource, parseShareLink, previewSource, publicImportError, sanitizeName, validateSize } from "./providers";
import { openSealedSource, sealSource } from "./source-crypto";

test("only supported HTTPS share links are accepted and normalized", () => {
  assert.deepEqual(parseShareLink("https://drive.google.com/file/d/abcdefghijklmnop/view"), {
    provider: "drive", url: "https://drive.google.com/uc?export=download&id=abcdefghijklmnop",
  });
  assert.equal(new URL(parseShareLink("https://www.dropbox.com/scl/fi/example/a.jpg?rlkey=abc&dl=0").url).searchParams.get("dl"), "1");
  assert.equal(parseShareLink("https://mega.nz/folder/abcdefgh#abcdefghijklmnopqrstuv").provider, "mega");
  for (const url of ["http://drive.google.com/file/d/abcdefghijklmnop", "https://drive.google.com.evil.test/file/d/abcdefghijklmnop",
    "https://user:password@drive.google.com/uc?id=abcdefghijklmnop", "https://drive.google.com:444/uc?id=abcdefghijklmnop",
    "https://dropbox.com/scl/fo/example", "https://drive.google.com/drive/folders/abcd",
    "https://mega.nz/file/abcdefgh", "https://127.0.0.1/a.jpg"]) {
    assert.throws(() => parseShareLink(url), ImportError);
  }
});

test("SSRF policy rejects internal, mapped, multicast, reserved and link-local addresses", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.20.0.3", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "224.0.0.1", "0.0.0.0"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(allowedHost("drive.google.com.evil.test", "drive"), false);
  assert.equal(allowedHost("evilmega.nz", "mega"), false);
  assert.equal(allowedHost("gfs001n001.userstorage.mega.co.nz", "mega"), true);
  for (const url of ["https://localhost/a", "http://drive.google.com/a", "https://drive.google.com:123/a", "https://user:pass@drive.google.com/a"]) {
    await assert.rejects(safeRequest(url, "drive", AbortSignal.timeout(1000)), ImportError);
  }
});

test("share links are encrypted with randomized nonces and account-bound authentication", () => {
  const source = "https://mega.nz/file/abcdefgh#synthetic-test-key-not-a-secret";
  const user = `test-${randomUUID()}`;
  const first = sealSource(source, user);
  assert.notEqual(first, sealSource(source, user));
  assert.ok(!first.includes("synthetic-test-key"));
  assert.equal(openSealedSource(first, user), source);
  assert.throws(() => openSealedSource(first, "other-account"));
  const altered = Buffer.from(first, "base64");
  altered[altered.length - 1] ^= 1;
  assert.throws(() => openSealedSource(altered.toString("base64"), user));
});

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sVEAAAAASUVORK5CYII=", "base64");
test("MEGA folder selection survives string persistence and child downloads use the guarded API", async (t) => {
  const encryption = encrypt(Buffer.alloc(24, 7));
  const encryptedChunks: Buffer[] = [];
  encryption.on("data", (chunk: Buffer) => encryptedChunks.push(chunk));
  await new Promise<void>((resolve, reject) => {
    encryption.on("end", resolve);
    encryption.on("error", reject);
    // MEGAJS encrypts input buffers in place; preserve the shared plaintext fixture.
    encryption.end(Buffer.from(png));
  });
  const mergedKey = (encryption as typeof encryption & { key: Buffer }).key;
  const ciphertext = Buffer.concat(encryptedChunks);
  let unguardedCalls = 0;
  t.mock.method(API.getGlobalApi(), "fetch", async () => {
    unguardedCalls++;
    throw new Error("A folder descendant used the unguarded SDK global API");
  });
  // Reproduce MEGAJS's actual folder-child shape: no nodeId, an array-valued
  // downloadId, and a default global API until our adapter explicitly rebinds it.
  t.mock.method(MegaFile.prototype, "loadAttributes", async function (this: MegaFile) {
    const nested = new MegaFile({ downloadId: "nested00", directory: true });
    const child = new MegaFile({ downloadId: "file0001", key: Buffer.from(mergedKey) });
    Object.assign(child, { name: "selected.png", size: png.length, downloadId: ["abcdefgh", "file0001"] });
    const other = new MegaFile({ downloadId: "file0002", key: Buffer.from(mergedKey) });
    Object.assign(other, { name: "other.png", size: png.length, downloadId: ["abcdefgh", "file0002"] });
    nested.children = [child];
    this.children = [nested, other];
    return this;
  });
  const requests: { url: URL; body?: string }[] = [];
  const transport: typeof safeRequest = async (input, provider, signal, options = {}) => {
    assert.equal(provider, "mega");
    assert.equal(signal.aborted, false);
    const url = new URL(input);
    assert.equal(url.protocol, "https:");
    assert.equal(allowedHost(url.hostname, "mega"), true);
    requests.push({ url, body: options.body });
    const body = url.hostname === "g.api.mega.co.nz"
      ? Buffer.from(JSON.stringify([{ g: "https://gfs001.userstorage.mega.co.nz/fixture", s: png.length }]))
      : ciphertext;
    return Object.assign(Readable.from([body]), { statusCode: 200, headers: {} }) as unknown as IncomingMessage;
  };
  const url = "https://mega.nz/folder/abcdefgh#AAAAAAAAAAAAAAAAAAAAAA";
  const signal = AbortSignal.timeout(5000);
  const preview = await previewSource("mega", url, signal, transport);
  assert.equal(preview.length, 2);
  const selected = preview.find((file) => file.name === "selected.png")!;
  assert.equal(typeof selected.sourceId, "string");
  assert.deepEqual(JSON.parse(selected.sourceId), ["abcdefgh", "file0001"]);
  const storedId: string = JSON.parse(JSON.stringify({ sourceId: selected.sourceId })).sourceId;
  const stream = await openSource("mega", url, storedId, signal, transport);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), png, "SDK decrypts and verifies the chosen child's complete bytes");
  assert.equal(unguardedCalls, 0);
  assert.equal(requests.length, 2, "metadata and file bytes both use the guarded transport");
  const metadataRequest = requests.find((request) => request.body)!;
  assert.equal(JSON.parse(metadataRequest.body!)[0].n, "file0001");
  assert.ok(requests.some((request) => request.url.hostname.includes("userstorage.mega.co.nz")));
});

test("signature validation accepts images but rejects HTML and archives regardless of filename", async () => {
  assert.equal((await detectMedia(png)).contentType, "image/png");
  await assert.rejects(detectMedia(Buffer.from("<html>download password required</html>")), ImportError);
  await assert.rejects(detectMedia(Buffer.from("PK\x03\x04" + "0".repeat(100))), ImportError);
  assert.equal(sanitizeName("../../bad\0name.jpg"), ".._.._bad_name.jpg");
  for (const size of [0, -1, Infinity, NaN, 5 * 1024 ** 3 + 1]) assert.throws(() => validateSize(size), ImportError);
  assert.ok(!publicImportError(new Error("sensitive-url#privatekey")).includes("privatekey"));
});

// These integration tests use a unique synthetic account and in-memory source/storage.
// They never modify a real account's files, provider account, or R2 objects.
test("durable worker and API ownership integration", async (t) => {
  const { db, pool, importJobsTable: jobs, importFilesTable: files, mediaItemsTable: media } = await import("@workspace/db");
  const { eq, and } = await import("drizzle-orm");
  const { processImportJob, IMPORT_WORKER_LOCK } = await import("./worker");
  const { default: router } = await import("../../routes/imports");
  const { default: express } = await import("express");
  const userId = `import-test-${randomUUID()}`;
  const otherUserId = `import-test-${randomUUID()}`;
  const workerLock = await pool.connect();
  const locked = await workerLock.query("select pg_try_advisory_lock($1) as locked", [IMPORT_WORKER_LOCK]);
  if (!locked.rows[0]?.locked) {
    workerLock.release();
    await pool.end();
    t.skip("A cloud import is running. Run integration tests while the worker is idle.");
    return;
  }
  let identity: string | null = userId;
  const app = express();
  app.use(express.json());
  // Test fixture only: production still uses Clerk middleware and verified tokens.
  app.use((req, _res, next) => {
    const auth = Object.assign(() => ({ userId: identity, tokenType: "session_token" }), { [Symbol.for("@clerk/express.auth")]: true });
    Object.assign(req, { auth });
    next();
  });
  app.use(router);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (path: string, data?: object) => fetch(base + path, data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : undefined);
  async function seed(bytes = png, status = "queued") {
    const [job] = await db.insert(jobs).values({
      userId, provider: "drive", encryptedSource: sealSource("https://drive.google.com/uc?id=fixture", userId),
      status, expiresAt: new Date(Date.now() + 3600_000),
    }).returning();
    const id = randomUUID();
    const [file] = await db.insert(files).values({
      id, jobId: job!.id, sourceId: "fixture", name: "fixture.png", size: bytes.length,
      status: status === "preview" ? "preview" : "queued", objectKey: `media/${userId}/${id}`,
    }).returning();
    return { job: job!, file: file! };
  }
  let completedUploads = 0;
  let abortedUploads = 0;
  const objects = new Map<string, Buffer>();
  const uploadedParts = new Map<string, Buffer[]>();
  const scheduledPreviews: string[] = [];
  function dependencies(bytes = png) {
    return {
      openSource: async () => Readable.from((function* () { for (let offset = 0; offset < bytes.length; offset += 65536) yield bytes.subarray(offset, offset + 65536); })()),
      abortImportUpload: async () => { abortedUploads++; },
      deleteMediaObject: async (key: string) => { objects.delete(key); },
      beginImportUpload: async (key: string) => { uploadedParts.set(key, []); return "fixture-upload"; },
      uploadImportPart: async (key: string, _upload: string, number: number, body: Buffer) => {
        assert.ok(body.length <= 8 * 1024 ** 2);
        uploadedParts.get(key)!.push(Buffer.from(body));
        return { ETag: `part-${number}`, PartNumber: number };
      },
      finishImportUpload: async (key: string) => { objects.set(key, Buffer.concat(uploadedParts.get(key)!)); completedUploads++; },
      verifyUploadedObject: async (key: string, size: number) => objects.get(key)?.length === size,
      enqueuePreview: (id: string) => { scheduledPreviews.push(id); return true; },
    };
  }
  try {
    await t.test("unauthenticated requests fail and other accounts cannot list/start/cancel/retry a job", async () => {
      const { job, file } = await seed(png, "preview");
      identity = null;
      assert.equal((await request("/imports")).status, 401);
      identity = otherUserId;
      const listed = await (await request("/imports")).json() as { jobs: { id: string }[] };
      assert.ok(!listed.jobs.some((row) => row.id === job.id));
      assert.equal((await request(`/imports/${job.id}/start`, { fileIds: [file.id] })).status, 404);
      assert.equal((await request(`/imports/${job.id}/action`, { action: "cancel" })).status, 404);
      assert.equal((await request(`/imports/${job.id}/action`, { action: "retry" })).status, 404);
      identity = userId;
    });
    await t.test("selection rejects foreign files, confirmation is idempotent, cancel survives a reload", async () => {
      const { job, file } = await seed(png, "preview");
      assert.equal((await request(`/imports/${job.id}/start`, { fileIds: [randomUUID()] })).status, 400);
      assert.equal((await request(`/imports/${job.id}/start`, { fileIds: [file.id] })).status, 200);
      assert.equal((await request(`/imports/${job.id}/start`, { fileIds: [file.id] })).status, 200);
      assert.equal((await request(`/imports/${job.id}/action`, { action: "cancel" })).status, 200);
      const [current] = await db.select().from(jobs).where(eq(jobs.id, job.id));
      await processImportJob(current!, new AbortController().signal, dependencies());
      const [after] = await db.select().from(jobs).where(eq(jobs.id, job.id));
      assert.equal(after?.status, "cancelled");
      assert.equal((await db.select().from(files).where(eq(files.id, file.id)))[0]?.status, "cancelled");
    });
    await t.test("streaming crosses multipart boundaries, registers once, and recovers after a post-commit restart", async () => {
      const bytes = Buffer.concat([png, Buffer.alloc(9 * 1024 ** 2)]);
      const { job, file } = await seed(bytes);
      const before = completedUploads;
      await processImportJob(job, new AbortController().signal, dependencies(bytes));
      assert.equal(completedUploads, before + 1);
      assert.deepEqual(objects.get(file.objectKey), bytes);
      assert.equal(uploadedParts.get(file.objectKey)?.length, 2);
      const [saved] = await db.select().from(media).where(eq(media.objectKey, file.objectKey));
      assert.equal(saved?.userId, userId);
      assert.ok(scheduledPreviews.includes(saved!.id));
      await db.update(files).set({ status: "transferring" }).where(eq(files.id, file.id));
      await db.update(jobs).set({ status: "processing" }).where(eq(jobs.id, job.id));
      await processImportJob(job, new AbortController().signal, dependencies(bytes));
      assert.equal(completedUploads, before + 1);
      assert.equal((await db.select().from(media).where(eq(media.objectKey, file.objectKey))).length, 1);
      assert.deepEqual(objects.get(file.objectKey), bytes);
    });
    await t.test("failed multipart cleanup and retry keep successful items idempotent", async () => {
      const { job, file } = await seed();
      const deps = dependencies();
      deps.finishImportUpload = async () => { throw new Error("fixture network interruption"); };
      const before = abortedUploads;
      await processImportJob(job, new AbortController().signal, deps);
      assert.equal(abortedUploads, before + 1);
      assert.equal((await db.select().from(files).where(eq(files.id, file.id)))[0]?.status, "failed");
      assert.equal((await request(`/imports/${job.id}/action`, { action: "retry" })).status, 200);
      const [retried] = await db.select().from(jobs).where(eq(jobs.id, job.id));
      await processImportJob(retried!, new AbortController().signal, dependencies());
      assert.equal((await db.select().from(files).where(eq(files.id, file.id)))[0]?.status, "complete");
    });
    await t.test("truncated sources and HTML masquerading as images never register", async () => {
      const { job, file } = await seed();
      await processImportJob(job, new AbortController().signal, dependencies(png.subarray(0, 30)));
      assert.equal((await db.select().from(files).where(eq(files.id, file.id)))[0]?.status, "failed");
      assert.equal((await db.select().from(media).where(eq(media.objectKey, file.objectKey))).length, 0);
    });
    await t.test("optional real R2 multipart, signed range read, and cleanup", { skip: process.env.IMPORT_R2_SMOKE !== "1" }, async () => {
      const real = await import("../r2Storage");
      const { job, file } = await seed();
      try {
        await processImportJob(job, new AbortController().signal, { ...real, openSource: async () => Readable.from([png]) });
        const [saved] = await db.select().from(files).where(eq(files.id, file.id));
        assert.equal(saved?.status, "complete", saved?.error ?? undefined);
        const url = await real.createViewUrl(file.objectKey, "image/png");
        const response = await fetch(url, { headers: { Range: "bytes=0-9" } });
        assert.equal(response.status, 206);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), png.subarray(0, 10));
      } finally { await real.deleteMediaObject(file.objectKey); }
    });
  } finally {
    identity = userId;
    await db.delete(media).where(and(eq(media.userId, userId)));
    await db.delete(jobs).where(eq(jobs.userId, userId));
    await db.delete(jobs).where(eq(jobs.userId, otherUserId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await workerLock.query("select pg_advisory_unlock($1)", [IMPORT_WORKER_LOCK]);
    workerLock.release();
    await pool.end();
  }
});
