// ayamai browser tool — the thinnest possible client.
//
// It reads the page with the permissions it was granted, then asks the local
// agent to do something with it. No model keys here, no prompts of its own.
const DOOR = "http://ayamai.local";

const $ = (id) => document.getElementById(id);
const say = (text) => { $("answer").textContent = text; };
const hint = (text) => { $("hint").textContent = text; };

async function token() {
  const stored = await chrome.storage.local.get("token");
  return stored.token ?? $("token").value.trim();
}

async function readPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      url: location.href,
      title: document.title,
      text: (document.body?.innerText ?? "").slice(0, 20000),
    }),
  });
  return result.result;
}

async function task(intent, input) {
  const response = await fetch(`${DOOR}/agent/task`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ayamai-token": await token() },
    body: JSON.stringify({ intent, input }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `agent said ${response.status}`);
  return body;
}

chrome.storage.local.get("token").then((stored) => { if (stored.token) $("token").value = stored.token; });

$("token").addEventListener("change", () => chrome.storage.local.set({ token: $("token").value.trim() }));

$("ask").addEventListener("click", async () => {
  const prompt = $("prompt").value.trim() || "Summarise this page in three sentences.";
  $("ask").disabled = true;
  hint("reading the page…");
  say("waiting…");
  try {
    const page = await readPage();
    hint(`sent ${page.title.slice(0, 40)}`);
    const result = await task("llm.prompt", {
      prompt: `Page: ${page.url}\nTitle: ${page.title}\n\n${page.text.slice(0, 8000)}\n\n${prompt}`,
    });
    say(result.result?.text ?? result.result?.error ?? "no answer");
  } catch (error) {
    say(String(error.message ?? error));
  } finally {
    $("ask").disabled = false;
  }
});

$("capture").addEventListener("click", async () => {
  $("capture").disabled = true;
  hint("capturing…");
  try {
    const page = await readPage();
    const result = await task("page.capture", page);
    say(`saved\n${result.result?.saved ?? ""}`);
  } catch (error) {
    say(String(error.message ?? error));
  } finally {
    $("capture").disabled = false;
  }
});
