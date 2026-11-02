// Synthetic browser benchmark, not an authenticated end-to-end test.
// Run from this package: node scripts/benchmark-previews.mjs
import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "node:http";
import { randomFillSync } from "node:crypto";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { renderPreview } from "../src/lib/preview-render.ts";

const out = resolve("../../generated-artifacts/preview-benchmark");
await mkdir(out, { recursive: true });
// Non-sensitive high-detail fixture with a camera-sized decoded surface.
const pixels = randomFillSync(Buffer.alloc(2400 * 1600 * 3));
const original = await sharp(pixels, { raw: { width: 2400, height: 1600, channels: 3 } }).jpeg({ quality: 82 }).toBuffer();
await writeFile(`${out}/source.jpg`, original);
const small = await renderPreview(`${out}/source.jpg`, "image", `${out}/poster.png`);
const count = 600;
const html = mode => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  /* the platform's face, never the browser's */
  button{appearance:none;-webkit-appearance:none}
body{margin:0;background:#090809}main{display:grid;grid-template-columns:1fr 1fr;gap:6px}button{appearance:none;-webkit-appearance:none;padding:0;border:0;aspect-ratio:4/5;background:#292428;overflow:hidden}img{width:100%;height:100%;object-fit:cover}</style>
<main>${Array.from({length:count},(_,i)=>`<button data-i="${i}"></button>`).join("")}</main>
<script>
window.loaded=new Set(); window.firstReady=0;
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{
const card=e.target,id=card.dataset.i;
if(e.isIntersecting&&!card.firstChild){const image=new Image(); image.loading="lazy";image.decoding="async";
image.onload=()=>{window.loaded.add(id);if(["0","1","2","3","4","5","6","7"].every(x=>window.loaded.has(x))&&!window.firstReady)window.firstReady=performance.now();};
image.src="/${mode}/"+id; card.append(image);}
${mode === "preview" ? "if(!e.isIntersecting)card.replaceChildren();" : ""}
}),{rootMargin:"400px"});
document.querySelectorAll("button").forEach(x=>observer.observe(x));
</script>`;
const server = createServer((req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(req.url.startsWith("/grid")){res.setHeader("Content-Type","text/html");res.end(html(req.url.includes("preview")?"preview":"original"));return;}
  const body = req.url.startsWith("/preview/") ? small : original;
  res.setHeader("Content-Type","image/jpeg");res.setHeader("Content-Length",body.length);res.end(body);
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const executablePath = execFileSync("which",["chromium"],{encoding:"utf8"}).trim();
const results=[];
try {
  for (const mode of ["original","preview"]) {
    const browser=await chromium.launch({executablePath,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
    try{
      const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
      const page=await context.newPage();
      const cdp=await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled",{cacheDisabled:true});
      await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:80,downloadThroughput:4_000_000/8,uploadThroughput:1_000_000/8});
      await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
      await cdp.send("Performance.enable");
      let transferred=0;
      cdp.on("Network.loadingFinished",e=>transferred+=e.encodedDataLength);
      const browserCdp=await browser.newBrowserCDPSession();
      const rss=async()=>{
        const {processInfo}=await browserCdp.send("SystemInfo.getProcessInfo");
        let kb=0;
        for(const p of processInfo) {
          try{const stat=await readFile("/proc/"+p.id+"/status","utf8");kb+=Number(stat.match(/VmRSS:\\s+(\\d+)/)?.[1]??stat.match(/VmRSS:\s+(\d+)/)?.[1]??0);}catch{}
        }
        return Math.round(kb/1024);
      };
      const baselineRss=await rss();
      await page.goto(`http://127.0.0.1:${server.address().port}/grid?${mode}`,{waitUntil:"domcontentloaded"});
      await page.waitForFunction(()=>window.firstReady>0,{},{timeout:180000});
      const initial=await page.evaluate(()=>({ms:window.firstReady,images:document.querySelectorAll("img").length}));
      const initialBytes=transferred;
      // A repeatable large-collection scroll, waiting for eight successive viewports.
      for(let i=1;i<=8;i++){
        await page.evaluate(i=>window.scrollTo(0,i*1000),i);
        await page.waitForTimeout(150);
        await page.waitForFunction(()=>Array.from(document.images).filter(x=>x.getBoundingClientRect().bottom>0&&x.getBoundingClientRect().top<844).every(x=>x.complete&&x.naturalWidth>0),{},{timeout:180000});
      }
      const metrics=(await cdp.send("Performance.getMetrics")).metrics;
      const memory=await page.evaluate(()=>({
        mountedImages:document.images.length,
        mountedDecodedSurfaceMiB:Array.from(document.images).reduce((n,x)=>n+x.naturalWidth*x.naturalHeight*4,0)/1024**2,
        loaded:window.loaded.size,
      }));
      const afterRss=await rss();
      results.push({mode,initialViewportMs:Math.round(initial.ms),initialTransferBytes:initialBytes,totalTransferBytes:transferred,
        browserRssMiB:afterRss,browserRssIncreaseMiB:afterRss-baselineRss,
        jsHeapUsedMiB:Math.round(metrics.find(x=>x.name==="JSHeapUsedSize").value/1024**2*10)/10,...memory});
      await page.screenshot({path:`${out}/${mode}.jpg`});
    }finally{await browser.close();}
  }
  const report={collectionSize:count,viewport:"390x844 @2x",network:"4 Mbps down, 80ms latency",cpuSlowdown:4,
    fixtureOriginalBytes:original.length,fixturePreviewBytes:small.length,results,
    limitations:"Synthetic image-heavy grid using the actual preview renderer and tile intersection/unmount policy, not real account data or an authenticated UI run. Browser RSS sums browser/renderer/GPU process RSS (shared pages can be counted twice); decoded surface is an estimate, not measured GPU allocation. Excludes first-time server generation and real internet/R2 latency. GIF/video correctness is checked separately."};
  await writeFile(`${out}/results.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}finally{
  await new Promise(r=>server.close(r));
  await rm(`${out}/source.jpg`,{force:true});
}
