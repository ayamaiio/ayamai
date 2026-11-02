#!/usr/bin/env node

import { createRequire } from "node:module";
import { checkWatchGestures } from "./watch-mobile-gestures.mjs";

const require = createRequire(import.meta.url);
const { Local } = require("browserstack-local");

const testMode = process.env.WATCH_DEVICE_TEST_MODE ?? "feed";
const suite = process.env.WATCH_DEVICE_SUITE ?? "lifecycle";
if (!["lifecycle", "gestures"].includes(suite)) {
  throw new Error("WATCH_DEVICE_SUITE must be lifecycle or gestures.");
}
const gestureCase = process.env.WATCH_DEVICE_GESTURE_CASE ?? "all";
if (!["all", "card-switch"].includes(gestureCase)) {
  throw new Error("WATCH_DEVICE_GESTURE_CASE must be all or card-switch.");
}
const gestureSuite = suite === "gestures";
if (gestureSuite && testMode !== "lifecycle-fixture") {
  throw new Error("The gesture suite requires WATCH_DEVICE_TEST_MODE=lifecycle-fixture (harmless clips only).");
}
if (testMode !== "feed" && testMode !== "lifecycle-fixture") {
  throw new Error("WATCH_DEVICE_TEST_MODE must be feed or lifecycle-fixture.");
}

const REQUIRED = [
  "BROWSERSTACK_USERNAME",
  "BROWSERSTACK_ACCESS_KEY",
  ...(testMode === "feed" ? ["WATCH_DEVICE_EMAIL", "WATCH_DEVICE_PASSWORD"] : []),
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(
    `Missing required environment variables: ${missing.join(", ")}. See docs/watch-mobile-testing.md.`,
  );
  process.exit(2);
}

const platform = (process.env.WATCH_DEVICE_PLATFORM ?? "ios").toLowerCase();
if (platform !== "ios" && platform !== "android") {
  throw new Error("WATCH_DEVICE_PLATFORM must be ios or android.");
}

const appUrl = new URL(process.env.WATCH_DEVICE_APP_URL ?? "http://bs-local.com:25221/");
if (appUrl.protocol !== "http:" || appUrl.hostname !== "bs-local.com") {
  throw new Error(
    "WATCH_DEVICE_APP_URL must use BrowserStack Local, for example http://bs-local.com:25221/.",
  );
}

const deviceName = process.env.WATCH_DEVICE_NAME ?? (platform === "ios" ? "iPhone 15" : "Google Pixel 8");
const osVersion = process.env.WATCH_DEVICE_OS_VERSION ?? (platform === "ios" ? "17" : "14.0");
const localIdentifier = `watch-mobile-${process.pid}`;
const backgroundSeconds = Number(process.env.WATCH_DEVICE_BACKGROUND_SECONDS ?? "8");
if (!Number.isInteger(backgroundSeconds) || backgroundSeconds < 3 || backgroundSeconds > 60) {
  throw new Error("WATCH_DEVICE_BACKGROUND_SECONDS must be an integer from 3 to 60.");
}
const preHidePauseGraceMs = 750;
const manualAuthSeconds = Number(process.env.WATCH_DEVICE_MANUAL_AUTH_SECONDS ?? "80");
if (!Number.isInteger(manualAuthSeconds) || manualAuthSeconds < 15 || manualAuthSeconds > 300) {
  throw new Error("WATCH_DEVICE_MANUAL_AUTH_SECONDS must be an integer from 15 to 300.");
}
const allowScreenRecording = process.env.WATCH_DEVICE_ALLOW_SCREEN_RECORDING === "true";

const hub = "https://hub-cloud.browserstack.com/wd/hub";
const auth = `Basic ${Buffer.from(
  `${process.env.BROWSERSTACK_USERNAME}:${process.env.BROWSERSTACK_ACCESS_KEY}`,
).toString("base64")}`;
const sessionName = process.env.WATCH_DEVICE_SESSION_NAME ?? `Watch lifecycle ${platform} ${new Date().toISOString()}`;

let sessionId;
let localTunnel;

function startLocalTunnel() {
  localTunnel = new Local();
  return new Promise((resolve, reject) => {
    localTunnel.start({
      key: process.env.BROWSERSTACK_ACCESS_KEY,
      localIdentifier,
      onlyAutomate: "true",
    }, (error) => error ? reject(error) : resolve());
  });
}

function stopLocalTunnel() {
  if (!localTunnel?.isRunning()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    localTunnel.stop((error) => error ? reject(error) : resolve());
  });
}

async function request(path, { method = "GET", body, timeoutMs = 45_000 } = {}) {
  const response = await fetch(`${hub}${path}`, {
    method,
    headers: {
      authorization: auth,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.value?.error) {
    const detail = payload.value?.message ?? payload.message ?? response.statusText;
    throw new Error(`Device automation request failed (${response.status}): ${detail}`);
  }
  return payload.value ?? payload;
}

async function command(method, path, body) {
  if (!sessionId) throw new Error("Device session has not started.");
  return request(`/session/${sessionId}${path}`, { method, body });
}

async function script(source, args = []) {
  const result = await command("POST", "/execute/sync", { script: source, args });
  return result;
}

async function waitFor(description, predicate, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`);
}

async function findElements(using, value) {
  const result = await command("POST", "/elements", { using, value });
  return result ?? [];
}

function elementId(element) {
  return element["element-6066-11e4-a52e-4f735466cecf"] ?? element.ELEMENT;
}

async function findVisibleElement(using, value, description) {
  return waitFor(description, async () => {
    const elements = await findElements(using, value);
    for (const element of elements) {
      try {
        if (await command("GET", `/element/${elementId(element)}/displayed`)) return element;
      } catch {
        // A stale or hidden match should not prevent trying the other controls.
      }
    }
    return null;
  });
}

async function elementText(element) {
  return command("GET", `/element/${elementId(element)}/text`);
}

async function signInFormDiagnostic() {
  return script(`
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    return {
      url: location.origin + location.pathname,
      inputs: [...document.querySelectorAll("input")].filter(visible).map((input) => ({
        type: input.type,
        name: input.name,
        autocomplete: input.autocomplete,
        disabled: input.disabled,
        populated: Boolean(input.value),
        valid: input.validity.valid
      })),
      forms: [...document.forms].map((form) => ({ valid: form.checkValidity() })),
      visibleText: (document.body?.innerText ?? "")
        .slice(0, 1200)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, "[email redacted]"),
      buttons: [...document.querySelectorAll("button, input[type=submit], [role=button]")]
        .filter(visible)
        .map((button) => ({
          tag: button.tagName.toLowerCase(),
          type: button.type || "",
          label: (button.innerText || button.getAttribute("aria-label") || "").trim().slice(0, 60),
          disabled: Boolean(button.disabled)
        })),
      notices: [...document.querySelectorAll('[role="alert"], [role="status"], [data-localization-key]')]
        .map((node) => (node.innerText || node.getAttribute("data-localization-key") || "").trim())
        .filter(Boolean)
        .map((text) => text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, "[email redacted]").slice(0, 120))
    };
  `);
}

async function findVisibleActionButton(description) {
  return waitFor(description, async () => {
    const buttons = await findElements("css selector", "button, input[type=submit], [role=button]");
    for (const button of buttons) {
      try {
        if (!(await command("GET", `/element/${elementId(button)}/displayed`))) continue;
        const label = (await elementText(button)).trim();
        if (/^(continue|next|sign in|continue with password)$/i.test(label)) return button;
      } catch {
        // Ignore stale, hidden, or non-actionable controls.
      }
    }
    return null;
  });
}

async function click(element) {
  await command("POST", `/element/${elementId(element)}/click`, {});
}

async function type(element, text) {
  await command("POST", `/element/${elementId(element)}/value`, {
    text,
    value: [...text],
  });
}

async function signIn() {
  const signInUrl = new URL("/sign-in", appUrl);
  await command("POST", "/url", { url: signInUrl.href });

  let email;
  try {
    email = await findVisibleElement(
      "css selector",
      'input[type="email"], input[name="identifier"]',
      "the visible sign-in email field",
    );
  } catch (error) {
    const diagnostic = await script(`
      return {
        url: location.origin + location.pathname,
        title: document.title,
        readyState: document.readyState,
        inputs: [...document.querySelectorAll("input")].map((input) => ({
          type: input.type,
          name: input.name,
          autocomplete: input.autocomplete,
          placeholder: input.placeholder
        })),
        frames: [...document.querySelectorAll("iframe")].length,
        bodyPresent: Boolean(document.body)
      };
    `).catch(() => ({ unavailable: true }));
    throw new Error(`${error.message}. Safe page diagnostic: ${JSON.stringify(diagnostic)}`);
  }
  await type(email, process.env.WATCH_DEVICE_EMAIL);

  let password;
  try {
    password = await waitFor(
      "the password field (use a password-enabled test account)",
      async () => (await findElements("css selector", 'input[type="password"]'))[0],
    );
  } catch (error) {
    throw new Error(`${error.message}. Sign-in form: ${JSON.stringify(await signInFormDiagnostic())}`);
  }
  const passwordAccepted = await script(`
    const field = document.querySelector('input[type="password"]');
    if (!field) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) return false;
    setter.call(field, arguments[0]);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `, [process.env.WATCH_DEVICE_PASSWORD]);
  if (!passwordAccepted) throw new Error("Could not populate the password field.");
  await click(await findVisibleActionButton("the visible sign-in button"));

  const signInOutcome = await waitFor("Watch feed access or an account error", async () => {
      const currentUrl = await command("GET", "/url");
      const pageText = await script("return document.body?.innerText ?? \"\"");
      if (/an invitation is required|this account does not have access yet/i.test(String(pageText))) {
        return {
          error:
            "The signed-in account is blocked by the app invitation gate. Confirm it is the configured owner or an accepted invite; do not enter an invite code for the owner.",
        };
      }
      if (currentUrl.includes("/feed") || currentUrl.includes("/watch")) return { feed: true };
      if (/couldn.t find your account|account (does not|doesn't) exist/i.test(String(pageText))) {
        return { error: "The BrowserStack test account is not registered in this development Clerk instance." };
      }
      if (
        currentUrl.includes("/client-trust") ||
        /check your email to continue|signing in from a new device/i.test(String(pageText))
      ) {
        return allowScreenRecording
          ? { manualVerification: true }
          : {
              error: "Clerk requested email verification. Interactive BrowserStack verification requires screen recording; set WATCH_DEVICE_ALLOW_SCREEN_RECORDING=true only if that is approved.",
            };
      }
      return null;
  }).catch(async (error) => {
    throw new Error(`${error.message}. Sign-in state: ${JSON.stringify(await signInFormDiagnostic())}`);
  });
  if (signInOutcome.error) throw new Error(signInOutcome.error);
  if (signInOutcome.manualVerification) {
    console.log(
      `Clerk needs email verification. In BrowserStack App Automate, open session "${sessionName}", start Interactive Debugging, enter the code directly on the device, then stop Interactive Debugging. The test waits up to ${manualAuthSeconds} seconds for Watch.`,
    );
    const feedReached = await waitFor(
      "manual verification to return to Watch",
      async () => {
        const currentUrl = await command("GET", "/url");
        const pageText = await script("return document.body?.innerText ?? \"\"");
        if (/an invitation is required|this account does not have access yet/i.test(String(pageText))) {
          return { blockedByInvitation: true };
        }
        if (currentUrl.includes("/feed") || currentUrl.includes("/watch")) return { feed: true };
        if (/confirm.*(age|adult)|agree.*(policy|terms)|date of birth/i.test(String(pageText))) {
          throw new Error("Complete the age or policy confirmation manually; this test will not submit attestations.");
        }
        return false;
      },
      manualAuthSeconds * 1000,
    ).catch(() => null);
    if (feedReached?.blockedByInvitation) {
      throw new Error(
        "Email verification succeeded, but this account is blocked by the app invitation gate. Confirm the owner identity or accept an invite before running the lifecycle test.",
      );
    }
    if (!feedReached?.feed) {
      throw new Error(
        "Manual device verification did not return to Watch before the BrowserStack session timeout.",
      );
    }
  }

  const pageText = await script("return document.body.innerText.slice(0, 4000)");
  if (/an invitation is required|this account does not have access yet/i.test(String(pageText))) {
    throw new Error(
      "The signed-in account is blocked by the app invitation gate. Confirm the owner identity or an active invitation before running the lifecycle test.",
    );
  }
  if (/confirm.*(age|adult)|agree.*(policy|terms)|date of birth/i.test(String(pageText))) {
    throw new Error(
      "The test account is waiting for an age or policy confirmation. Complete that step manually in the account first; this test will not submit attestations.",
    );
  }
}

async function attachLifecycleRecorder() {
  return script(`
    const videos = [...document.querySelectorAll('video[data-testid^="video-social-"]')];
    const active = videos.find((video) => !video.paused && video.readyState >= 2);
    if (!active) return { ready: false, videos: videos.length };
    const postId = active.dataset.testid.replace(/^video-social-/, "");
    window.__watchDeviceLifecycle = { postId, events: [] };
    const record = (type, video = active) => window.__watchDeviceLifecycle.events.push({
      type,
      postId: video.dataset.testid.replace(/^video-social-/, ""),
      hidden: document.hidden,
      paused: video.paused,
      at: Date.now(),
      currentTime: video.currentTime
    });
    document.addEventListener("visibilitychange", () => record("visibility"));
    for (const video of videos) {
      for (const type of ["play", "playing", "pause", "timeupdate"]) {
        video.addEventListener(type, () => record(type, video));
      }
    }
    record("baseline", active);
    return { ready: true, postId, videoCount: videos.length };
  `);
}

async function backgroundAndCheck(label, background) {
  const baseline = await waitFor("an actively playing Watch video", async () => {
    const state = await attachLifecycleRecorder();
    return state?.ready ? state : null;
  });
  console.log(`${label}: active clip ${baseline.postId}; attempting the lifecycle transition.`);
  await background();

  const result = await waitFor(`${label} lifecycle events after returning to Watch`, async () =>
    script(`
      const state = window.__watchDeviceLifecycle;
      if (!state || !state.events.some((event) => event.type === "visibility" && event.hidden)) return null;
      return {
        postId: state.postId,
        events: state.events,
        videos: [...document.querySelectorAll('video[data-testid^="video-social-"]')].map((video) => ({
          postId: video.dataset.testid.replace(/^video-social-/, ""),
          paused: video.paused
        }))
      };
    `),
  );

  if (result.postId !== baseline.postId) {
    throw new Error(`${label}: active clip changed from ${baseline.postId} to ${result.postId}.`);
  }
  const hiddenIndex = result.events.findIndex((event) => event.type === "visibility" && event.hidden);
  const hiddenEvent = hiddenIndex >= 0 ? result.events[hiddenIndex] : null;
  const hiddenPause = Boolean(hiddenEvent && result.events.some((event, index) => {
    if (event.type !== "pause" || event.postId !== baseline.postId || !event.paused) return false;
    if (index >= hiddenIndex) return true;
    return event.at <= hiddenEvent.at && hiddenEvent.at - event.at <= preHidePauseGraceMs;
  }));
  if (!hiddenPause) {
    throw new Error(
      `${label}: Watch did not record the active clip pausing during the hidden transition. Events: ${JSON.stringify(result.events)}`,
    );
  }

  const resumed = await waitFor(`${label} to resume the same clip`, async () =>
    script(`
      const active = [...document.querySelectorAll('video[data-testid^="video-social-"]')]
        .filter((video) => !video.paused && video.readyState >= 2);
      return active.length ? active.map((video) => video.dataset.testid.replace(/^video-social-/, "")) : null;
    `, []),
  );
  if (resumed.length !== 1 || resumed[0] !== baseline.postId) {
    throw new Error(
      `${label}: expected only clip ${baseline.postId} to resume; active clips were ${JSON.stringify(resumed)}.`,
    );
  }
  console.log(`${label}: passed (hidden pause recorded; only the same clip resumed).`);
}

function isUnsupportedMobileCommand(error) {
  const message = error instanceof Error ? error.message : "";
  return /unknown mobile command|unsupported mobile command|not supported/i.test(message);
}

async function switchAwayFromBrowser() {
  if (platform === "ios") {
    // BrowserStack Safari sessions do not expose mobile: backgroundApp.
    await script("mobile: pressButton", [{ name: "home" }]);
    await new Promise((resolve) => setTimeout(resolve, backgroundSeconds * 1000));
    await script("mobile: activateApp", [{ bundleId: "com.apple.mobilesafari" }]);
    return;
  }

  try {
    await script("mobile: backgroundApp", [{ seconds: backgroundSeconds }]);
  } catch (error) {
    if (!isUnsupportedMobileCommand(error)) throw error;
    await command("POST", "/appium/device/press_keycode", { keycode: 3 });
    await new Promise((resolve) => setTimeout(resolve, backgroundSeconds * 1000));
    await command("POST", "/appium/device/activate_app", { appId: "com.android.chrome" });
  }
}

async function tryScreenLockCheck() {
  try {
    await backgroundAndCheck("Screen lock", async () => {
      await script("mobile: lock", [{ seconds: backgroundSeconds }]);
    });
    return true;
  } catch (error) {
    if (!isUnsupportedMobileCommand(error)) throw error;
    console.log(
      `${platform}: BrowserStack does not expose a screen-lock command for this browser session; screen-lock behavior was not verified.`,
    );
    return false;
  }
}

async function run() {
  console.log(`Starting BrowserStack Local tunnel to the running app at ${appUrl.origin}.`);
  await startLocalTunnel();
  console.log("BrowserStack Local tunnel is ready.");

  const bstackOptions = {
    userName: process.env.BROWSERSTACK_USERNAME,
    accessKey: process.env.BROWSERSTACK_ACCESS_KEY,
    deviceName,
    osVersion,
    projectName: "ayamai",
    buildName: process.env.WATCH_DEVICE_BUILD_NAME ?? "Watch mobile lifecycle",
    sessionName,
    debug: true,
    video: allowScreenRecording,
    interactiveDebugging: allowScreenRecording,
    idleTimeout: allowScreenRecording ? 300 : 90,
    networkLogs: false,
    local: true,
    localIdentifier,
  };
  const capabilities = {
    platformName: platform === "ios" ? "iOS" : "Android",
    browserName: platform === "ios" ? "safari" : "chrome",
    "appium:deviceName": deviceName,
    "appium:platformVersion": osVersion,
    "appium:automationName": platform === "ios" ? "XCUITest" : "UiAutomator2",
    "bstack:options": bstackOptions,
  };
  const session = await request("/session", {
    method: "POST",
    body: { capabilities: { alwaysMatch: capabilities, firstMatch: [{}] } },
    timeoutMs: 120_000,
  });
  sessionId = session.sessionId ?? session.value?.sessionId;
  if (!sessionId) throw new Error("The device cloud did not return a WebDriver session ID.");

  console.log(`Started BrowserStack real-device session: ${sessionName}`);
  console.log(`Device session ID: ${sessionId}; requested device: ${deviceName}, OS: ${osVersion}.`);
  await command("POST", "/timeouts", { pageLoad: 60_000, script: 20_000, implicit: 0 });
  if (testMode === "lifecycle-fixture") {
    const fixtureUrl = new URL("/__watch-lifecycle", appUrl);
    if (gestureSuite) fixtureUrl.searchParams.set("gestures", "1");
    await command("POST", "/url", { url: fixtureUrl.href });
    await waitFor("the development Watch lifecycle fixture", async () =>
      (await findElements("css selector", 'video[data-testid="video-social-lifecycle-fixture"]')).length > 0,
    );
    console.log("Using the development-only synthetic Watch fixture.");
  } else {
    await signIn();
    const feedUrl = new URL("/feed", appUrl);
    await command("POST", "/url", { url: feedUrl.href });
    await waitFor("a Watch video in the feed", async () =>
      (await findElements("css selector", 'video[data-testid^="video-social-"]')).length > 0,
    );
  }
  await waitFor(
    "video playback to start",
    async () =>
      script(
        "return [...document.querySelectorAll('video[data-testid^=\"video-social-\"]')].some((video) => !video.paused && video.readyState >= 2)",
      ),
    25_000,
  ).catch(async (error) => {
    if (testMode !== "lifecycle-fixture") throw error;
    const startButton = await findVisibleElement(
      "css selector",
      '[data-testid="button-start-lifecycle-clip"]',
      "the fixture's Start clip button",
    );
    await click(startButton);
    await waitFor("the fixture clip to start after a user gesture", async () =>
      script(
        "return [...document.querySelectorAll('video[data-testid^=\"video-social-\"]')].some((video) => !video.paused && video.readyState >= 2)",
      ),
    );
  });

  if (gestureSuite) {
    await checkWatchGestures({
      command, script, waitFor, platform,
      onlyCardSwitch: gestureCase === "card-switch",
    });
    return;
  }
  await backgroundAndCheck("App switch", switchAwayFromBrowser);
  const screenLockVerified = await tryScreenLockCheck();

  console.log(
    screenLockVerified
      ? "Watch mobile lifecycle checks passed."
      : "Watch mobile app-switch check passed; screen-lock behavior was not verified.",
  );
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Watch device test failed.");
  process.exitCode = 1;
} finally {
  if (sessionId) {
    try {
      await command("DELETE", "");
      console.log("Closed the BrowserStack device session.");
    } catch {
      console.error("Could not close the BrowserStack session automatically; it may expire on its own.");
      process.exitCode = 1;
    }
  }
  try {
    await stopLocalTunnel();
    console.log("Closed the BrowserStack Local tunnel.");
  } catch {
    console.error("Could not close the BrowserStack Local tunnel automatically.");
    process.exitCode = 1;
  }
}
