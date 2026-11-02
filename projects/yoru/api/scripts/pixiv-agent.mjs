// An agent that browses as you.
//
// Playwright drives a real Brave with your profile, so pixiv sees your session.
// It reads the artwork JSON, pulls every page at original size with the right
// referer, and hands the post to the local API.
//
//   node scripts/pixiv-agent.mjs https://www.pixiv.net/artworks/151549323 [more…]
//   node scripts/pixiv-agent.mjs --file urls.txt
//
// Brave must be closed: Chromium will not share a profile with a running copy.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BRAVE = process.env.BRAVE_PATH ?? "/mnt/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe";
// A dedicated profile the agent owns. Log in once with --login and it stays
// signed in; your everyday Brave profile is never touched or locked.
const PROFILE = process.env.BRAVE_PROFILE ?? "/mnt/c/Users/admin/ayamai-agent-profile";
const API = process.env.AYAMAI_API ?? "http://127.0.0.1:8081";

const args = process.argv.slice(2);

if (args[0] === "--login") {
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: BRAVE,
    headless: false,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("https://www.pixiv.net/login.php");
  console.log("log in to pixiv in the window that just opened, then press Enter here.");
  await new Promise((resolve) => process.stdin.once("data", resolve));
  await context.close();
  console.log("saved. future runs are hands-off.");
  process.exit(0);
}
const urls = args[0] === "--file"
  ? readFileSync(args[1], "utf8").split("\n").map((line) => line.trim()).filter(Boolean)
  : args;
if (!urls.length) { console.error("give me at least one artwork url"); process.exit(1); }

const ids = urls.map((url) => (url.match(/artworks\/(\d+)/) ?? [])[1]).filter(Boolean);
if (!ids.length) { console.error("no artwork ids in those urls"); process.exit(1); }

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: BRAVE,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check", "--disable-features=Translate"],
}).catch((error) => {
  console.error(`could not open the Brave profile: ${error.message.split("\n")[0]}`);
  console.error("close Brave completely (check the tray) and run this again.");
  process.exit(2);
});

let saved = 0;
for (const id of ids) {
  const page = await context.newPage();
  try {
    await page.goto(`https://www.pixiv.net/artworks/${id}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const meta = await page.evaluate(async (illustId) => {
      const res = await fetch(`/ajax/illust/${illustId}`, { credentials: "include" });
      return res.json();
    }, id);
    const body = meta?.body;
    const original = body?.urls?.original;
    if (!original) { console.log(`${id}: pixiv gave no original url`); continue; }

    const pages = Math.max(1, body.pageCount ?? 1);
    const images = Array.from({ length: pages }, (_, i) => ({
      url: String(original).replace(/_p\d+\./, `_p${i}.`),
    }));

    // context.request shares the browser's cookies, and we add the referer.
    const blobs = [];
    for (const image of images) {
      const res = await context.request.get(image.url, {
        headers: { referer: `https://www.pixiv.net/artworks/${id}`, "user-agent": "Mozilla/5.0" },
        timeout: 60_000,
      }).catch(() => null);
      if (!res?.ok()) { blobs.push({ url: image.url }); continue; }
      const buffer = await res.body();
      blobs.push({ url: image.url, data: buffer.toString("base64"), type: res.headers()["content-type"] });
    }

    const savedRes = await fetch(`${API}/api/capture/from-json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pageUrl: `https://www.pixiv.net/artworks/${id}`,
        title: body.illustTitle,
        artist: body.userName,
        tags: (body.tags?.tags ?? []).map((t) => t.tag),
        images: blobs,
      }),
    });
    const out = await savedRes.json();
    console.log(`${id}: ${out.imported}/${pages} pages · ${body.illustTitle} · ${body.userName}`);
    saved += out.imported ?? 0;
  } catch (error) {
    console.log(`${id}: failed — ${String(error.message).split("\n")[0]}`);
  } finally {
    await page.close();
  }
}

await context.close();
console.log(`done: ${saved} pages across ${ids.length} posts`);
