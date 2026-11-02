const $ = id => document.getElementById(id);
const BASELINE = { public: true, removed: false, deleted: false, rights: true,
  viewerAccepted: true, publisherAccepted: true, viewerBlocksPublisher: false, publisherBlocksViewer: false };
let secret = "", runId = "", busy = false, stopped = false, interrupted = false;
let video = $("player");
const results = { schema: "ayamai-safari-canary-v1", productionStack: false, samples: [], checks: [],
  workerCpuMs: null, workerCpuSource: "NOT_MEASURED", physicalEvidence: "operator-declared-not-independently-proven",
  notes: ["Times start at source assignment; ticket issuance measured separately.",
    "Byte counters are application response bodies, not TLS, radio or invoice bytes.",
    "No raw media URLs, tickets, account identifiers or operator credentials are exported."] };
function status(text) { $("status").textContent = text; }
async function control(action, body) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(`/control/${action}`, { method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${secret}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: controller.signal });
    if (!r.ok) throw new Error(`Control ${action}: HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timeout); }
}
function detach() { video.pause(); video.removeAttribute("src"); video.load(); }
function requireDevice() {
  if (!$("physical").checked || !/iPhone/.test(navigator.userAgent) || !/Safari/.test(navigator.userAgent)
    || /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent)) throw new Error("Use physical iPhone Safari and confirm the device checkbox.");
  if (document.hidden) throw new Error("Keep Safari foregrounded.");
}
function session() { return { network: $("network").value, transport: $("transport").value }; }
function percentiles(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? { median: v[Math.floor(v.length / 2)], p95: v[Math.ceil(v.length * .95) - 1] } : null;
}
function summary() {
  const groups = {};
  for (const s of results.samples.filter(s => s.phase !== "warmup")) {
    const key = `${s.network}/${s.transport}/${s.phase}`;
    (groups[key] ??= []).push(s);
  }
  return Object.fromEntries(Object.entries(groups).map(([k, rows]) => {
    const successes = rows.filter(r => r.ok);
    return [k, { attempts: rows.length, successes: successes.length, failures: rows.length - successes.length,
      sufficient: successes.length >= 30, readyMs: percentiles(successes.map(s => s.readyMs)),
      playingMs: percentiles(successes.map(s => s.playingMs)) }];
  }));
}
async function ticketUrl(transport) {
  const t = performance.now(), data = await control("ticket", { runId });
  return { url: `/${transport}/${data.id}?ticket=${encodeURIComponent(data.ticket)}`, ticketMs: performance.now() - t };
}
async function sample(phase, context) {
  const entry = { ...context, phase, at: new Date().toISOString(), ok: false };
  let remove = () => {};
  try {
    if (stopped || interrupted) throw new Error("interrupted");
    const { url, ticketMs } = await ticketUrl(context.transport);
    entry.ticketMs = ticketMs;
    if (phase === "startup") detach();
    if (phase === "startup") {
      const replacement = document.createElement("video");
      replacement.id = "player"; replacement.muted = true; replacement.playsInline = true;
      replacement.controls = true; replacement.preload = "none"; replacement.width = 280;
      video.replaceWith(replacement); video = replacement;
    }
    const t = performance.now();
    await new Promise((resolve, reject) => {
      let ready = false, playing = false;
      const done = () => { if (ready && playing) resolve(); };
      const canplay = () => { if (!ready) entry.readyMs = performance.now() - t; ready = true; done(); };
      const onplaying = () => { if (!playing) entry.playingMs = performance.now() - t; playing = true; done(); };
      const error = () => reject(new Error(`media-error-${video.error?.code ?? "unknown"}`));
      const timer = setTimeout(() => reject(new Error("ready-or-playback-timeout")), 15_000);
      const watchdog = setInterval(() => { if (stopped || interrupted) reject(new Error("interrupted")); }, 100);
      remove = () => {
        clearTimeout(timer); clearInterval(watchdog);
        video.removeEventListener("canplay", canplay); video.removeEventListener("playing", onplaying);
        video.removeEventListener("error", error);
      };
      video.addEventListener("canplay", canplay); video.addEventListener("playing", onplaying);
      video.addEventListener("error", error);
      video.src = url;
      video.play().catch(() => reject(new Error("play-rejected-tap-player-and-retry")));
    });
    remove();
    await new Promise(r => setTimeout(r, 250));
    entry.playbackAdvanced = video.currentTime > 0 && !video.paused;
    entry.ok = entry.playbackAdvanced && !interrupted && !stopped;
    if (!entry.ok) entry.failure = "no-foreground-playback";
    if (phase === "startup") detach();
    await new Promise(r => setTimeout(r, 25));
    const perf = performance.getEntriesByType("resource").filter(p => p.name === new URL(url, location.origin).href).at(-1);
    entry.browserEncodedBodyBytes = perf?.encodedBodySize ?? null;
    entry.browserTransferBytes = perf?.transferSize ?? null;
  } catch (error) {
    entry.failure = ["interrupted", "ready-or-playback-timeout", "play-rejected-tap-player-and-retry"].includes(error.message)
      || /^media-error-/.test(error.message) ? error.message : "control-or-media-failure";
  } finally { remove(); if (!entry.ok || phase === "startup") detach(); performance.clearResourceTimings(); }
  results.samples.push(entry);
  $("summary").textContent = JSON.stringify(summary(), null, 2);
  return entry;
}
async function batch(phase) {
  if (busy) return;
  try {
    requireDevice(); busy = true; stopped = false; interrupted = false;
    const context = session();
    $("network").disabled = $("transport").disabled = true;
    if (phase === "swipe") {
      const warm = await sample("warmup", context);
      if (!warm.ok) throw new Error("Warmup failed. Check controls and retry.");
    }
    for (let i = 0; i < 30 && !stopped && !interrupted; i++) {
      status(`${context.network} / ${context.transport} / ${phase}: attempt ${i + 1} of 30`);
      await sample(phase, context);
    }
    status("Batch retained. At least 30 successful samples per scenario/phase are required; failures remain in the report.");
  } catch (e) { status(e.message); }
  finally { detach(); busy = false; $("network").disabled = $("transport").disabled = false; }
}
document.addEventListener("visibilitychange", () => { if (busy && document.hidden) { interrupted = true; detach(); } });
$("connect").onclick = async () => {
  if (busy) return;
  try {
    secret = $("secret").value; $("secret").value = "";
    const health = await control("health");
    if (!health.privateIngress || !health.fixtureReady) throw new Error("Private ingress or fixture not ready.");
    runId = (await control("run", {})).runId;
    results.startedAt = new Date().toISOString();
    results.fixtureBytes = health.bytes;
    results.userAgent = navigator.userAgent;
    $("controls").disabled = false; $("export").disabled = false; $("connect").disabled = true;
    status("Connected to isolated synthetic run. Verify physical device and network before measuring.");
  } catch (e) { status(e.message); }
};
$("startup").onclick = () => batch("startup");
$("swipe").onclick = () => batch("swipe");
$("stop").onclick = () => { stopped = true; detach(); status("Stopped; partial observations retained."); };
async function transportCheck(url, method = "GET", range) {
  const response = await fetch(url, { method, ...(range ? { headers: { Range: range } } : {}), cache: "no-store", redirect: "error" });
  const output = { status: response.status, range: response.headers.get("Content-Range"),
    length: response.headers.get("Content-Length"), acceptRanges: response.headers.get("Accept-Ranges") };
  await response.body?.cancel();
  return output;
}
$("checks").onclick = async () => {
  if (busy) return;
  try {
    requireDevice(); busy = true; stopped = false; interrupted = false;
    const context = session();
    for (const transport of ["relay", "edge"]) {
      if (stopped || interrupted) throw new Error("interrupted");
      const { url } = await ticketUrl(transport);
      const head = await transportCheck(url, "HEAD");
      results.checks.push({ ...context, transport, kind: "HEAD", ...head, passed: head.status === 200 });
      for (const range of ["bytes=0-511", "bytes=512-", "bytes=-128", "bytes=999999999999-", "bytes=1-2,4-5"]) {
        if (stopped || interrupted) throw new Error("interrupted");
        const r = await transportCheck(url, "GET", range);
        const expected = range.includes(",") || range.includes("999999") ? 416 : 206;
        results.checks.push({ ...context, transport, kind: "range", requestedRange: range, ...r,
          passed: r.status === expected && !!r.range });
      }
      const response = await fetch(url, { cache: "no-store" });
      const reader = response.body.getReader(); const first = await reader.read(); await reader.cancel();
      results.checks.push({ ...context, transport, kind: "cancellation", firstChunkBytes: first.value?.byteLength ?? 0,
        clientCancelled: true, upstreamCancellationVerified: false });
      const flags = ["public", "removed", "deleted", "rights", "viewerAccepted", "publisherAccepted", "viewerBlocksPublisher", "publisherBlocksViewer"];
      for (const flag of flags) {
        if (stopped || interrupted) throw new Error("interrupted");
        await control("state", { runId, state: { ...BASELINE, [flag]: !BASELINE[flag] } });
        const denied = await transportCheck(url, "HEAD");
        results.checks.push({ ...context, transport, kind: "old-ticket-revocation", flag, status: denied.status, passed: denied.status === 404 });
        await control("state", { runId, state: BASELINE });
        const restored = await transportCheck(url, "HEAD");
        results.checks.push({ ...context, transport, kind: "restored-state", flag, status: restored.status, passed: restored.status === 200 });
      }
      await sample("warmup", { ...context, transport });
      detach();
      const seekUrl = (await ticketUrl(transport)).url;
      const seek = await new Promise(resolve => {
        const timer = setTimeout(() => finish(false), 15_000);
        const finish = ok => { clearTimeout(timer); video.removeEventListener("loadedmetadata", metadata);
          video.removeEventListener("seeked", sought); resolve(ok); };
        const metadata = () => { video.currentTime = Math.min(video.duration / 2, 2); };
        const sought = () => finish(video.currentTime > 0);
        video.addEventListener("loadedmetadata", metadata); video.addEventListener("seeked", sought);
        video.src = seekUrl;
        video.load();
      });
      results.checks.push({ ...context, transport, kind: "seek", passed: seek });
      detach();
    }
    status("Functional checks retained. Review individual failures and collect provider CPU evidence separately.");
  } catch { status("Functional check interrupted or unavailable; partial results retained."); }
  finally {
    detach();
    try { await control("state", { runId, state: BASELINE }); } catch { status("Could not restore synthetic state. Start a fresh isolated run."); }
    busy = false;
  }
};
$("export").onclick = async () => {
  if (busy) { status("Stop the batch before exporting."); return; }
  try {
    let page = await control("metrics", { runId }), observations = [...page.observations];
    for (let i = 0; page.nextCursor !== null && i < 49; i++) {
      page = await control("metrics", { runId, cursor: page.nextCursor });
      observations.push(...page.observations);
    }
    results.server = { ...page, observations, truncated: page.nextCursor !== null };
  }
  catch { results.server = { unavailable: true }; }
  const report = { ...results, summary: summary(), exportedAt: new Date().toISOString(),
    completed: false, reason: "Operator must review four scenarios, functional checks and provider CPU/byte evidence." };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "ayamai-iphone-canary.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
};
