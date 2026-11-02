const $ = id => document.getElementById(id);
const BASELINE = { public: true, removed: false, deleted: false, rights: true,
  viewerAccepted: true, publisherAccepted: true, viewerBlocksPublisher: false, publisherBlocksViewer: false };
let state, busy = false, stopped = false, video = $("player"), nextNetwork = "wifi";
const text = (id, value) => { $(id).textContent = value; };
async function api(path, body) {
  const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {}, ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Test service unavailable. Try again.");
  return result;
}
function foreground() {
  if (stopped || document.hidden) throw new Error("Paused. Keep Safari open, then press Resume. Saved results are retained.");
}
function detach() { video.pause(); video.removeAttribute("src"); video.load(); }
function iphone() {
  return /iPhone/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
}
async function save(result) {
  // Wait for durable acknowledgement before progressing. No fire-and-forget saves.
  await api("/session/evidence", result);
  text("saved", "Results saved automatically. No download or upload needed.");
  state.evidence = state.evidence.filter(x => !(x.network === result.network && x.transport === result.transport && x.detail === result.detail));
  state.evidence.push(result);
}
async function source(transport) {
  foreground();
  const ticket = await api("/session/ticket", {});
  return `/${transport}/${ticket.id}?ticket=${encodeURIComponent(ticket.ticket)}`;
}
async function probe(url, method, range, consume = false) {
  foreground();
  const response = await fetch(url, { method, headers: range ? { Range: range } : {},
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  const bytes = consume ? (await response.arrayBuffer()).byteLength : 0;
  if (!consume) await response.body?.cancel();
  return { status: response.status, bytes, range: response.headers.get("Content-Range"),
    length: response.headers.get("Content-Length"), accepts: response.headers.get("Accept-Ranges") };
}
async function seek(url) {
  detach();
  let clean;
  try {
    const target = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Seek timed out.")), 15_000);
      const watch = setInterval(() => { try { foreground(); } catch (e) { reject(e); } }, 200);
      const onError = () => reject(new Error("Video could not load. Retry this network."));
      const metadata = () => { video.currentTime = Math.min(video.duration / 2, 2); };
      const sought = () => resolve(video.currentTime);
      clean = () => { clearTimeout(timer); clearInterval(watch);
        video.removeEventListener("loadedmetadata", metadata); video.removeEventListener("seeked", sought); video.removeEventListener("error", onError); };
      video.addEventListener("loadedmetadata", metadata); video.addEventListener("seeked", sought); video.addEventListener("error", onError);
      video.src = url; video.load();
      // Start muted playback now: preload=none can otherwise withhold metadata.
      video.play().catch(() => reject(new Error("Video could not start. Press Resume in Safari.")));
    });
    await video.play();
    await new Promise(resolve => setTimeout(resolve, 350));
    foreground();
    return { position: video.currentTime, passed: target > 0 && video.currentTime > target && !video.paused };
  } finally { clean?.(); detach(); }
}
async function checks(network, transport) {
  await api("/session/state", { state: BASELINE });
  const size = state.fixtureBytes;
  const result = (kind, detail, rest) => save({ network, transport, kind, detail, ...rest });
  const url = await source(transport);
  text("status", `Checking ${network === "wifi" ? "Wi-Fi" : "cellular"} ${transport}: video requests.`);
  const head = await probe(url, "HEAD");
  await result("HEAD", "HEAD", { status: head.status, passed: head.status === 200 && +head.length === size && head.accepts === "bytes" });
  for (const [detail, range, status, expectedBytes, expectedRange] of [
    ["closed", "bytes=0-511", 206, 512, `bytes 0-511/${size}`],
    ["open", `bytes=${size - 512}-`, 206, 512, `bytes ${size - 512}-${size - 1}/${size}`],
    ["suffix", "bytes=-128", 206, 128, `bytes ${size - 128}-${size - 1}/${size}`],
    ["invalid", "bytes=999999999999-", 416, 0, `bytes */${size}`],
    ["multiple", "bytes=1-2,4-5", 416, 0, `bytes */${size}`],
  ]) {
    const r = await probe(url, "GET", range, true);
    await result("range", detail, { status: r.status, bytes: r.bytes, expectedBytes, range: r.range || "",
      passed: r.status === status && r.bytes === expectedBytes && r.range === expectedRange && r.accepts === "bytes" });
  }
  foreground();
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const reader = response.body.getReader();
  try {
    const first = await reader.read(); await reader.cancel();
    await result("cancellation", "cancel", { bytes: first.value?.byteLength || 0,
      clientCancelled: true, upstreamCancellationVerified: false, passed: false });
  } finally { reader.releaseLock(); }
  text("status", `Checking ${transport}: old links after privacy and blocking changes.`);
  for (const flag of Object.keys(BASELINE)) {
    foreground();
    // Each mutation gets a fresh, successfully authorized old ticket immediately before revocation.
    await api("/session/state", { state: BASELINE });
    const old = await source(transport);
    const before = await probe(old, "HEAD");
    if (before.status !== 200) throw new Error("Could not establish authorized playback. Retry this network.");
    await api("/session/state", { state: { ...BASELINE, [flag]: !BASELINE[flag] } });
    try {
      for (const method of ["GET", "HEAD", "RANGE"]) {
        const denied = await probe(old, method === "HEAD" ? "HEAD" : "GET", method === "RANGE" ? "bytes=0-127" : undefined, true);
        await result("revocation", `${flag}:${method}`, { status: denied.status, bytes: denied.bytes,
          passed: denied.status === 404 && denied.bytes === 0 });
      }
    } finally { await api("/session/state", { state: BASELINE }); }
    if ((await probe(old, "HEAD")).status !== 200) throw new Error("Canary eligibility could not be restored. Press Retry.");
  }
  text("status", `Checking ${transport}: seek and continued playback.`);
  try { await result("seek", "seek", await seek(await source(transport))); }
  catch (error) {
    await result("seek", "seek", { position: 0, passed: false });
    throw error;
  }
}
function prompt() {
  $("progress").max = 4;
  $("progress").value = (state.wifiDone ? 2 : 0) + (state.cellularDone ? 2 : 0);
  if (state.wifiDone && state.cellularDone) {
    text("instruction", "Your iPhone checks are collected and saved. You can close this page.");
    text("status", "Device checks collected. Server-side review is still required; production routing has not changed.");
    text("saved", "Results saved privately. No files to send.");
    $("start").hidden = true; $("stop").hidden = true; return;
  }
  nextNetwork = state.wifiDone ? "cellular" : "wifi";
  text("instruction", nextNetwork === "wifi"
    ? "Turn Wi-Fi ON and cellular data OFF in iPhone Settings. Return to Safari, then press Start. Your previous 240 timing runs do not need repeating."
    : "Wi-Fi checks are saved. Turn Wi-Fi OFF and cellular data ON in iPhone Settings. Return here and press Continue.");
  const retained = state.evidence.filter(e => e.network === nextNetwork).length;
  text("start", retained ? "Resume this network" : nextNetwork === "wifi" ? "Start iPhone check" : "Continue on cellular");
  if (state.evidence.length) text("saved", `${state.evidence.length} observations already saved privately. No files to send.`);
  $("start").disabled = false; $("stop").disabled = true;
  text("status", "Pressing the button confirms physical iPhone Safari and the network settings shown above. Keep Safari open during the check.");
}
$("start").onclick = async () => {
  if (busy || !state) return;
  if (!iphone()) { text("status", "Open this private link on your physical iPhone using Safari."); return; }
  busy = true; stopped = false; $("start").disabled = true; $("stop").disabled = false;
  const network = nextNetwork;
  try {
    foreground();
    for (const [i, transport] of ["relay", "edge"].entries()) {
      await checks(network, transport);
      $("progress").value = (network === "cellular" ? 2 : 0) + i + 1;
    }
    await api("/session/finish", { network });
    if (network === "wifi") state.wifiDone = true; else state.cellularDone = true;
    prompt();
  } catch (error) {
    text("status", error.message || "Check interrupted. Saved results are retained. Press Resume.");
    text("start", "Resume this network"); $("start").disabled = false;
  } finally {
    detach();
    try { await api("/session/state", { state: BASELINE }); }
    catch { text("saved", "Could not restore synthetic test state. Saved results remain; press Resume when connected."); }
    busy = false; $("stop").disabled = true;
  }
};
$("stop").onclick = () => { stopped = true; detach(); text("status", "Stopping. Completed checks remain saved."); };
document.addEventListener("visibilitychange", () => { if (busy && document.hidden) { stopped = true; detach(); } });
async function initialize() {
  const token = new URLSearchParams(location.hash.slice(1)).get("invite");
  // Fragment never reaches access logs or referrers; remove it before any API calls.
  if (token) history.replaceState(null, "", location.pathname);
  try {
    if (token) {
      try { await api("/session"); } catch { await api("/session/redeem", { invitation: token }); }
    }
    state = await api("/session");
    if (!state.fixtureReady || state.fixtureBytes < 512) throw new Error("The benign test fixture is not ready.");
    prompt();
  } catch (error) { text("status", error.message || "Could not open the private test session."); }
}
initialize();
