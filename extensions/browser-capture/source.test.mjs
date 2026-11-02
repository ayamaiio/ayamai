import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const code = readFileSync(new URL("./source.js", import.meta.url), "utf8");
const { discover, readSelection } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sVEAAAAASUVORK5CYII=", "base64"));
const mp4 = Uint8Array.from(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(12)]));
const nativeFetch = globalThis.fetch;
test("explicit viewport discovery and anonymous selected-only capture", async (t) => {
  const first = { tagName: "IMG", src: "https://public.example/photo.png", isConnected: true, getBoundingClientRect: () => ({ width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100 }) };
  const second = { ...first, tagName: "VIDEO", src: "https://public.example/clip.mp4" };
  const hidden = { ...first, getBoundingClientRect: () => ({ width: 100, height: 100, top: 5000, left: 0, bottom: 5100, right: 100 }) };
  globalThis.document = { querySelectorAll: () => [first, second, hidden], querySelector: () => ({ href: "https://page.example/posts/123?token=credential#secret" }) };
  globalThis.location = { href: "https://page.example/unknown?session=secret" };
  globalThis.getComputedStyle = () => ({ visibility: "visible", display: "block" });
  globalThis.innerHeight = 800; globalThis.innerWidth = 1200;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(options.credentials, "omit"); assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.redirect, "error"); assert.equal(options.mode, "cors");
    assert.equal("headers" in options, false);
    return new Response(url.endsWith("mp4") ? mp4 : png, { headers: { "Content-Type": url.endsWith("mp4") ? "video/mp4" : "image/png" } });
  };
  try {
    await t.test("discovery fetches nothing and excludes offscreen media", () => {
      assert.equal(discover().length, 2); assert.equal(calls, 0);
    });
    await t.test("benign image and video return bytes but no locator, title or query", async () => {
      for (let i = 0; i < 2; i++) {
        const result = await readSelection(i);
        assert.equal(result.error, undefined);
        assert.equal(result.sourceUrl, "https://page.example/posts/123");
        assert.equal(result.contentType, i ? "video/mp4" : "image/png");
        assert.equal(JSON.stringify(result).includes("public.example"), false);
        assert.equal(JSON.stringify(result).includes("credential"), false);
      }
      assert.equal(calls, 2);
    });
    await t.test("unsupported credentials, manifests and changed nodes never fetch", async () => {
      for (const src of ["blob:https://page.example/id", "https://public.example/x?signature=secret", "https://user:secret@public.example/x", "https://public.example/x#key", "https://public.example/x.m3u8"]) {
        first.src = src; discover();
        assert.ok((await readSelection(0)).error);
      }
      assert.equal(calls, 2);
      first.src = "https://public.example/photo.png"; discover(); first.src = "https://public.example/new.png";
      assert.match((await readSelection(0)).error, /changed/); assert.equal(calls, 2);
    });
    await t.test("oversize, HTML, and CORS errors fail explicitly without locator leaks", async () => {
      discover();
      globalThis.fetch = async () => new Response(png, { headers: { "Content-Type": "image/png", "Content-Length": String(21 * 1024 * 1024) } });
      assert.match((await readSelection(0)).error, /20 MiB/);
      globalThis.fetch = async () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } });
      assert.match((await readSelection(0)).error, /Unsupported/);
      globalThis.fetch = async () => { throw new TypeError("https://secret.example/token"); };
      const result = await readSelection(0);
      assert.match(result.error, /CORS/); assert.equal(result.error.includes("secret.example"), false);
    });
  } finally { globalThis.fetch = nativeFetch; }
});
