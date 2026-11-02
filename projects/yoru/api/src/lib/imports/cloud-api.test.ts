import test from "node:test";
import assert from "node:assert/strict";
import { CloudApi, expandCloudSelection, providerRequest, type CloudEntry } from "./cloud-api";
import { openCloudCursor, sealCloudCursor } from "./cloud-accounts";
import { ImportError } from "./network";

const signal = () => AbortSignal.timeout(5000);
const folder = (id: string): CloudEntry => ({ id, name: id, folder: true, size: 0 });
const file = (id: string, size = 80): CloudEntry => ({ id, name: `${id}.png`, folder: false, size });

test("Drive uses fixed API endpoints, escaped identifiers, read-only pagination, and streamed downloads", async () => {
  const requests: URL[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fixture");
    if (url.searchParams.get("alt") === "media") return new Response(Buffer.from("media-bytes"));
    if (url.pathname.endsWith("/photo")) return Response.json({ id: "photo", name: "photo.png", mimeType: "image/png", size: "11" });
    return Response.json({ files: [
      { id: "nested", name: "Nested", mimeType: "application/vnd.google-apps.folder" },
      { id: "photo", name: "photo.png", mimeType: "image/png", size: "11" },
      { id: "doc", name: "doc.png", mimeType: "application/vnd.google-apps.document" },
      { id: "zip", name: "archive.zip", mimeType: "application/zip", size: "100" },
    ], nextPageToken: "next-page" });
  };
  const api = new CloudApi("drive", "fixture", signal(), transport);
  const page = await api.list("nested", "previous-page");
  assert.equal(page.cursor, "next-page");
  assert.deepEqual(page.entries.map((e) => e.id), ["nested", "photo"]);
  assert.equal(requests[0].searchParams.get("q"), "'nested' in parents and trashed = false");
  assert.equal(requests[0].searchParams.get("pageToken"), "previous-page");
  assert.equal((await api.entry("photo"))?.size, 11);
  const chunks: Buffer[] = [];
  for await (const chunk of await api.open("photo")) chunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(chunks).toString(), "media-bytes");
  await assert.rejects(api.list("a' or trashed=true"), ImportError);
});

test("Dropbox paginates with provider cursors and downloads by stable ID without temporary links", async () => {
  const calls: { url: string; body?: unknown; headers: Record<string, string> }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body, headers: init?.headers as Record<string, string> });
    assert.equal(init?.redirect, "error");
    if (url.includes("/download")) return new Response(Buffer.from("image"));
    if (url.includes("get_metadata")) return Response.json({ ".tag": "folder", id: "id:folder", name: "Folder" });
    return Response.json({ entries: [
      { ".tag": "folder", id: "id:folder", name: "Folder" },
      { ".tag": "file", id: "id:file", name: "image.png", size: 5 },
      { ".tag": "file", id: "id:online", name: "online.png", size: 5, is_downloadable: false },
    ], cursor: "provider-cursor", has_more: !url.endsWith("/continue") });
  };
  const api = new CloudApi("dropbox", "fixture", signal(), transport);
  const first = await api.list();
  assert.deepEqual(first.entries.map((e) => e.id), ["id:folder", "id:file"]);
  assert.equal(first.cursor, "provider-cursor");
  assert.equal((await api.list("", first.cursor!)).cursor, null);
  assert.deepEqual(calls[1].body, { cursor: "provider-cursor" });
  assert.equal((await api.entry("id:folder"))?.folder, true);
  const stream = await api.open("id:file");
  for await (const _chunk of stream) { /* Drain streaming response. */ }
  assert.equal(calls.at(-1)?.headers["Dropbox-API-Arg"], JSON.stringify({ path: "id:file" }));
  assert.ok(!calls.some((call) => call.url.includes("temporary")));
});

test("folder expansion recurses through pages and deduplicates overlapping selections and cycles", async () => {
  const entries = new Map([["root", folder("root")], ["sub", folder("sub")], ["a", file("a")], ["b", file("b")]]);
  const result = await expandCloudSelection({
    entry: async (id) => entries.get(id)!,
    list: async (id, cursor) => id === "root"
      ? cursor ? { entries: [file("b")], cursor: null } : { entries: [folder("sub"), file("a")], cursor: "page2" }
      : { entries: [folder("root"), file("a")], cursor: null },
  }, ["root", "a", "root"]);
  assert.deepEqual(result.map((e) => e.sourceId).sort(), ["a", "b"]);
  assert.equal(result.reduce((sum, e) => sum + e.size, 0), 160);
});

test("recursive previews enforce file, byte, individual-size, page, and empty-selection limits", async () => {
  const expand = (entries: CloudEntry[], cursor: string | null = null) => expandCloudSelection({
    entry: async () => folder("root"), list: async () => ({ entries, cursor }),
  }, ["root"]);
  await assert.rejects(expand(Array.from({ length: 201 }, (_, i) => file(String(i)))), /200 files/);
  await assert.rejects(expand(Array.from({ length: 11 }, (_, i) => file(String(i), 5 * 1024 ** 3))), /50 GB/);
  await assert.rejects(expand([file("too-big", 5 * 1024 ** 3 + 1)]), /5 GB/);
  await assert.rejects(expand([file("unknown", 0)]), /known size/);
  await assert.rejects(expand([], "repeated-cursor"), /listing requests/);
  await assert.rejects(expand([]), /No supported/);
});

test("credential transport blocks untrusted hosts and hides provider errors", async () => {
  let called = false;
  const transport: typeof fetch = async () => { called = true; return new Response("secret-token-in-provider-error", { status: 401 }); };
  await assert.rejects(providerRequest("https://evil.test/steal", {}, signal(), transport), /Invalid cloud/);
  assert.equal(called, false);
  await assert.rejects(providerRequest("https://www.googleapis.com/a", {}, signal(), transport), (error: Error) => {
    assert.ok(!error.message.includes("secret-token"));
    return /Reconnect/.test(error.message);
  });
});

test("folder cursors are account-, provider-, folder-, and connection-bound", () => {
  const value = sealCloudCursor("user-a", "drive", "connection-a", "folder-a", "fixture-provider-cursor");
  assert.ok(!value.includes("fixture-provider-cursor"));
  assert.equal(openCloudCursor(value, "user-a", "drive", "connection-a", "folder-a"), "fixture-provider-cursor");
  for (const args of [
    ["user-b", "drive", "connection-a", "folder-a"],
    ["user-a", "dropbox", "connection-a", "folder-a"],
    ["user-a", "drive", "connection-b", "folder-a"],
    ["user-a", "drive", "connection-a", "folder-b"],
  ] as const) assert.throws(() => openCloudCursor(value, args[0], args[1], args[2], args[3]), ImportError);
});
