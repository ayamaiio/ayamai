// Local transport microbenchmark, not a live CDN or authenticated app test.
// Run: pnpm --filter @workspace/api-server run benchmark:shared-delivery
// No existing uploads, real accounts, R2 credentials or external storage are used.
import { chromium, webkit, devices } from "playwright";
import { createServer } from "node:http";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { handleMedia, byteRange } from "../../../infrastructure/shared-media-edge/worker.mjs";
import { createMediaTicket, openMediaTicket } from "../src/lib/media-tickets.ts";

const out = resolve(import.meta.dirname, "../../../generated-artifacts/shared-delivery");
await mkdir(out, { recursive: true });
const file = `${out}/benign-test-pattern.mp4`;
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
  "testsrc2=size=720x1280:rate=24", "-t", "6", "-c:v", "libx264", "-preset", "fast",
  "-b:v", "1200k", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", file]);
const size = (await stat(file)).size, id = randomUUID();
// Ticket keys come from the existing environment, never printed or serialized.
const ticket = createMediaTicket(id, "synthetic-benchmark-viewer");
const rate = 500_000, latency = 80, samples = 3, swipes = 4;
const counters = { relay: {}, edge: {} };
const reset = mode => counters[mode] = { mediaBytes: 0, authBytes: 0, requests: 0, r2Reads: 0 };
reset("relay"); reset("edge");
const grant = { objectKey: "synthetic-private-fixture", contentType: "video/mp4" };
const env = {
  AUTH_API_ORIGIN: "https://local-authority.example", EDGE_SERVICE_SECRET: randomUUID(),
  MEDIA: {
    head: async () => { counters.edge.r2Reads++; return { size }; },
    get: async (_key, options) => {
      counters.edge.r2Reads++;
      const range = options?.range;
      return { body: Readable.toWeb(createReadStream(file, range ? { start: range.offset, end: range.offset + range.length - 1 } : {})) };
    },
  },
};
// Shared boundary: both transports validate the same encrypted viewer ticket.
// Real SQL and Worker-to-API network latency are deliberately NOT modelled.
function allowed(value) { return openMediaTicket(id, value) === "synthetic-benchmark-viewer"; }
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#111;color:white}video{width:100vw;height:90vh;object-fit:contain}</style>
<p>Benign synthetic delivery benchmark</p><main></main><script>
window.loadClip = src => new Promise((resolve, reject) => {
  const old=document.querySelector("video");
  if(old){old.pause();old.removeAttribute("src");old.load();old.remove();}
  const video=document.createElement("video"); video.muted=true; video.playsInline=true;video.preload="auto";
  const start=performance.now();
  const timeout=setTimeout(()=>reject(new Error("media ready timeout")),20000);
  video.oncanplay=()=>{clearTimeout(timeout);resolve(performance.now()-start);};
  video.onerror=()=>{clearTimeout(timeout);reject(new Error("video decode/load failure"));};
  document.querySelector("main").append(video);video.src=src;video.play().catch(()=>{});
});
window.clearClip=()=>{const v=document.querySelector("video");if(v){v.pause();v.removeAttribute("src");v.load();v.remove();}};
</script>`;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Cache-Control", "private, no-store");
  if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end(html); return; }
  const mode = url.pathname.split("/")[1];
  if (!["relay", "edge"].includes(mode)) { res.writeHead(404).end(); return; }
  const c = counters[mode]; c.requests++;
  const abort = new AbortController();
  res.on("close", () => { if (!res.writableFinished) abort.abort(); });
  let source;
  try {
    let headers, status;
    if (mode === "edge") {
      const response = await handleMedia(new Request(`https://edge.example/streams/${id}?ticket=${encodeURIComponent(url.searchParams.get("ticket"))}`, {
        headers: req.headers.range ? { Range: req.headers.range } : {}, signal: abort.signal,
      }), env, async (_target, init) => {
        const body = JSON.parse(init.body);
        if (!allowed(body.ticket)) return new Response(null, { status: 404 });
        const encoded = JSON.stringify(grant);
        c.authBytes += Buffer.byteLength(encoded);
        return new Response(encoded, { headers: { "Content-Type": "application/json" } });
      });
      headers = Object.fromEntries(response.headers); status = response.status;
      source = response.body && Readable.fromWeb(response.body);
    } else {
      if (!allowed(url.searchParams.get("ticket"))) { res.writeHead(404).end(); return; }
      c.r2Reads++;
      const range = byteRange(req.headers.range ?? null, size);
      status = range ? 206 : 200;
      headers = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": String(range?.length ?? size) };
      if (range) headers["Content-Range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`;
      source = createReadStream(file, range ? { start: range.offset, end: range.offset + range.length - 1 } : {});
    }
    // Identical application-level 4Mbps pacing and 80ms media-response delay.
    // Not a simulation of radio, TCP packet loss or a regional edge.
    await delay(latency, null, { signal: abort.signal });
    res.writeHead(status, headers);
    if (!source) { res.end(); return; }
    const paced = new Transform({
      transform(chunk, _encoding, done) {
        delay(chunk.length / rate * 1000, null, { signal: abort.signal })
          .then(() => { c.mediaBytes += chunk.length; done(null, chunk); }, done);
      },
    });
    await pipeline(source, paced, res, { signal: abort.signal });
  } catch { source?.destroy(); if (!res.destroyed) res.destroy(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [], unavailable = [];
const p = (values, fraction) => [...values].sort((a,b) => a-b)[Math.ceil(values.length * fraction) - 1];
try {
  for (const profile of ["android-chromium", "iphone-webkit"]) {
    let browser;
    try {
      browser = profile === "android-chromium"
        ? await chromium.launch({ executablePath: execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(), args: ["--no-sandbox", "--disable-dev-shm-usage"] })
        : await webkit.launch();
    } catch {
      unavailable.push({ profile, reason: "Browser runtime or host libraries unavailable; no result claimed." });
      continue;
    }
    try {
      for (const mode of ["relay", "edge"]) {
        reset(mode);
        const startup = [], swipeReady = [];
        for (let run = 0; run < samples; run++) {
          const context = await browser.newContext(profile === "android-chromium" ? devices["Pixel 7"] : devices["iPhone 13"]);
          const page = await context.newPage();
          await page.goto(base);
          for (let clip = 0; clip <= swipes; clip++) {
            const ms = await page.evaluate(src => window.loadClip(src), `${base}/${mode}/${id}?ticket=${ticket}&sample=${run}-${clip}`);
            (clip === 0 ? startup : swipeReady).push(ms);
            await page.waitForTimeout(300);
          }
          await page.evaluate(() => window.clearClip());
          await context.close();
        }
        // Let aborted transfer pipelines settle before taking the accounting snapshot.
        await delay(100);
        const c = { ...counters[mode] };
        results.push({
          profile, mode, startupSamples: startup.length, swipeSamples: swipeReady.length,
          startupMedianMs: +p(startup, .5).toFixed(1), startupP95Ms: +p(startup, .95).toFixed(1),
          swipeMedianMs: +p(swipeReady, .5).toFixed(1), swipeP95Ms: +p(swipeReady, .95).toFixed(1),
          ...c, apiResponseBodyBytes: mode === "relay" ? c.mediaBytes : c.authBytes,
        });
      }
    } finally { await browser.close(); }
  }
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
const report = { fixture: { kind: "FFmpeg moving test pattern, no audio", bytes: size, seconds: 6, codec: "H.264/yuv420p", width: 720, height: 1280 },
  model: { clientBytesPerSecond: rate, mediaResponseDelayMs: latency, samples, swipes,
    caveats: "Local file-backed R2 adapter and relay-shaped pipeline; actual Worker handler, real encrypted tickets; no SQL, live R2, CDN, TLS or auth network RTT. Mobile viewport/UA emulation, not physical phones. Counts are application response bodies, not billed wire bytes. No production speed claim." },
  results, unavailable };
await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
