import { discover, readSelection } from "./source.js";

const $ = (id) => document.getElementById(id);
const CAPTURE_CHANNEL = "ayamai-capture";
const CAPTURE_RESPONSE_CHANNEL = "ayamai-capture-response";
const sourceTab = Number(location.hash.slice(1));
let busy = false;
const saved = await chrome.storage.local.get("appOrigin");
$("origin").value = saved.appOrigin || "";
const status = (message) => { $("status").textContent = message; };

$("scan").onclick = async () => {
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: sourceTab }, func: discover });
    $("selection").replaceChildren(...result.result.map((item) => {
      const option = document.createElement("option");
      option.value = item.index;
      option.textContent = `${item.kind} ${item.index + 1} — ${item.width} × ${item.height} visible pixels`;
      return option;
    }));
    $("send").disabled = !result.result.length;
    status(result.result.length ? "Choose one item. Only visible top-frame media is listed; no bytes downloaded yet." : "No visible top-frame image/video found. Protected and embedded players are unsupported.");
  } catch { status("Cannot inspect this tab. Return to the source page and click the extension action again. Browser internal pages are unsupported."); }
};

// Run a one-request bridge in the destination MAIN world. It can see only the
// payload we provide and the app's acknowledgement, never authentication tokens.
async function exchange(tabId, payload, timeout = 180000) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN",
    func: async (payload, timeout) => new Promise((resolve) => {
      const timer = setTimeout(() => { window.removeEventListener("message", receive); resolve({ error: "App did not acknowledge. Keep the app tab open, sign in and pair this account, then retry." }); }, timeout);
      function receive(event) {
        if (event.source !== window || event.origin !== location.origin || ![CAPTURE_RESPONSE_CHANNEL, "ayanami-capture-response"].includes(event.data?.channel) || event.data.nonce !== payload.nonce || event.data.requestId !== payload.requestId) return;
        clearTimeout(timer); window.removeEventListener("message", receive); resolve(event.data);
      }
      window.addEventListener("message", receive);
      // A newly opened app may still be mounting or waiting for sign-in.
      const ping = () => window.postMessage(payload, location.origin);
      ping();
      const interval = setInterval(ping, 1000);
      setTimeout(() => clearInterval(interval), timeout);
      window.addEventListener("message", function stop(event) {
        if (event.source === window && [CAPTURE_RESPONSE_CHANNEL, "ayanami-capture-response"].includes(event.data?.channel) && event.data.requestId === payload.requestId) {
          clearInterval(interval); window.removeEventListener("message", stop);
        }
      });
    }),
    args: [payload, timeout],
  });
  return result.result;
}

$("send").onclick = async () => {
  if (busy) return;
  let origin;
  try {
    const url = new URL($("origin").value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.port && url.port !== "443")) throw Error();
    origin = url.origin;
  } catch { status("Enter only your HTTPS app origin, without paths, credentials, query or fragment."); return; }
  // Must remain in the explicit click's user gesture.
  if (!await chrome.permissions.request({ origins: [`${origin}/*`] })) { status("App transfer permission was not granted."); return; }
  busy = true; $("send").disabled = true; $("scan").disabled = true; $("origin").disabled = true; $("selection").disabled = true;
  let appTab;
  try {
    const grants = await chrome.permissions.getAll();
    const oldOrigins = (grants.origins || []).filter((granted) => granted !== `${origin}/*`);
    if (oldOrigins.length) await chrome.permissions.remove({ origins: oldOrigins });
    await chrome.storage.local.set({ appOrigin: origin });
    const nonce = crypto.randomUUID();
    appTab = await chrome.tabs.create({ url: `${origin}/capture#capture=${nonce}` });
    status("In the app tab, sign in and explicitly pair the destination account. This tab must remain open.");
    // Wait for the tab document before injecting; no tabs/history permission.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(ready); reject(Error("App tab did not load.")); }, 60000);
      function ready(id, info) {
        if (id === appTab.id && info.status === "complete") { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(ready); resolve(); }
      }
      chrome.tabs.onUpdated.addListener(ready);
      chrome.tabs.get(appTab.id).then((tab) => { if (tab.status === "complete") ready(tab.id, { status: "complete" }); });
    });
    const base = { channel: CAPTURE_CHANNEL, nonce };
    const paired = await exchange(appTab.id, { ...base, kind: "pair", requestId: crypto.randomUUID() });
    if (!paired?.uid || paired.error) throw Error(paired?.error || "Account pairing failed.");
    status("Reading only the selected media anonymously (maximum 20 MiB)…");
    const [result] = await chrome.scripting.executeScript({ target: { tabId: sourceTab }, func: readSelection, args: [Number($("selection").value)] });
    if (!result.result || result.result.error) throw Error(result.result?.error || "Selected source is unavailable.");
    const received = await exchange(appTab.id, { ...base, kind: "file", requestId: crypto.randomUUID(), uid: paired.uid, ...result.result }, 30000);
    if (received?.error || !received?.ok) throw Error(received?.error || "The app did not accept the transfer.");
    status("Transferred. Review private labels and confirm saving in the app tab. Nothing is posted yet.");
    await chrome.tabs.update(appTab.id, { active: true });
  } catch (error) { status(error.message?.startsWith("Unsupported") || error.message?.includes("MiB") ? error.message : "Transfer stopped. Check the app tab, account pairing and source permission, then retry."); }
  finally { busy = false; $("send").disabled = false; $("scan").disabled = false; $("origin").disabled = false; $("selection").disabled = false; }
};
$("forget").onclick = async () => {
  if (busy) { status("Finish or close this transfer before forgetting permissions."); return; }
  const grants = await chrome.permissions.getAll();
  if (grants.origins?.length) await chrome.permissions.remove({ origins: grants.origins });
  await chrome.storage.local.remove("appOrigin");
  $("origin").value = "";
  status("App origin and its transfer permission removed. No account credentials or media were stored by the extension.");
};
