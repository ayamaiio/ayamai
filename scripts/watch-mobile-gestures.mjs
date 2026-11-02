import assert from "node:assert/strict";

/** Native W3C touch input, not dispatchEvent: the browser owns scroll/cancellation. */
export async function checkWatchGestures({ command, script, waitFor, platform, onlyCardSwitch = false }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let touchOffset = { x: 0, y: 0 };
  async function calibrateTouchCoordinates() {
    // Appium Safari may interpret viewport y relative to its browser toolbar.
    // Measure trusted input on a non-seek area instead of hardcoding an iOS offset.
    touchOffset = { x: 0, y: 0 };
    const probe = await script(`
      window.__watchTouchProbe = null;
      document.addEventListener('pointerdown', e => {
        window.__watchTouchProbe = { x: e.clientX, y: e.clientY, trusted: e.isTrusted };
      }, { once: true, capture: true });
      return { x: Math.round(innerWidth * 0.4), y: Math.round(innerHeight * 0.5) };
    `);
    await touch([move(probe.x, probe.y), down, move(probe.x + 20, probe.y, 100), up]);
    const actual = await script("return window.__watchTouchProbe");
    assert(actual?.trusted, "Touch coordinate calibration requires trusted device input");
    touchOffset = { x: probe.x - actual.x, y: probe.y - actual.y };
    console.log(`${platform}: measured native viewport offset ${JSON.stringify(touchOffset)}.`);
  }
  async function state() {
    return script(`
      const s = window.__watchGestureCheck;
      return {
        events: s.events,
        oldPaused: s.video.paused,
        oldConnected: s.video.isConnected,
        time: s.video.currentTime,
        duration: s.video.duration,
        scroll: document.querySelector('[data-testid="watch-device-feed"]').scrollTop,
        active: [...document.querySelectorAll('video')].filter(v => !v.paused).map(v => v.dataset.testid)
      };
    `);
  }
  async function prepare(id) {
    await waitFor(`clip ${id} playing`, () => script(`
      const v = document.querySelector('[data-testid="video-social-${id}"]');
      return v && !v.paused && v.readyState >= 2 && Number.isFinite(v.duration);
    `));
    await calibrateTouchCoordinates();
    // Keep the short CC0 sample away from its loop boundary during each gesture.
    await script(`
      const video = document.querySelector('[data-testid="video-social-${id}"]');
      video.currentTime = 0.5;
    `);
    await sleep(250);
    return script(`
      const video = document.querySelector('[data-testid="video-social-${id}"]');
      const surface = document.querySelector('[data-testid="watch-gesture-surface"]');
      const zone = surface.querySelector('[data-watch-seek-zone]');
      const r = zone.getBoundingClientRect();
      window.__watchGestureCheck = { video, events: [] };
      const events = window.__watchGestureCheck.events;
      for (const type of ['play','pause','seeking','seeked']) video.addEventListener(type, () =>
        events.push({ type, time: video.currentTime, connected: video.isConnected }));
      for (const type of ['pointerdown','pointermove','pointerup','pointercancel','pointerleave','lostpointercapture']) {
        surface.addEventListener(type, e => events.push({
          type, trusted: e.isTrusted, target: Number(zone.getAttribute('aria-valuenow')),
          x: e.clientX, y: e.clientY, seekZone: !!e.target.closest('[data-watch-seek-zone]'),
          at: performance.now(), button: e.button, primary: e.isPrimary, pointerType: e.pointerType
        }), true);
      }
      return { x: Math.round(r.left + r.width * 0.25), y: Math.round(r.top + r.height / 2),
        width: surface.clientWidth, height: innerHeight };
    `);
  }
  const move = (x, y, duration = 0) => ({
    type: "pointerMove", duration, origin: "viewport",
    x: Math.round(x + touchOffset.x), y: Math.round(y + touchOffset.y),
  });
  async function touch(actions) {
    await command("POST", "/actions", {
      actions: [{ type: "pointer", id: "watch-finger", parameters: { pointerType: "touch" }, actions }],
    });
  }
  const down = { type: "pointerDown", button: 0 };
  const up = { type: "pointerUp", button: 0 };
  // XCUITest can interpolate across a pause into the following move. An explicit
  // same-position waypoint makes the stationary hold part of the native path.
  const hold = (box) => move(box.x, box.y, 600);
  function nativeStart(result) {
    assert(result.events.some(e => e.type === "pointerdown" && e.trusted),
      "The device must deliver trusted native pointer input");
  }
  function noReplay(result) {
    assert(result.oldPaused, "The previous clip must remain paused");
    assert(!result.oldConnected, "The previous clip must be inactive");
    assert(!result.events.some(e => e.type === "play"), "The gesture must not restart the previous clip");
  }

  let box;
  let result;
  if (!onlyCardSwitch) {
  box = await prepare("lifecycle-fixture");
  const dx = Math.round(box.width * 0.25);
  await touch([move(box.x, box.y), down, hold(box), move(box.x + dx, box.y, 400), up]);
  await sleep(200);
  result = await state();
  nativeStart(result);
  const release = result.events.find(e => e.type === "pointerup");
  const pause = result.events.find(e => e.type === "pause");
  assert(pause && release, `A horizontal hold must pause and release: ${JSON.stringify({ box, result })}`);
  const expected = Math.min(result.duration - 0.05, pause.time + dx / box.width * result.duration);
  assert(Math.abs(release.target - expected) < 0.25, `Seek target ${release.target} must match ${expected}`);
  assert(result.events.some(e => e.type === "seeked" && Math.abs(e.time - expected) < 0.35),
    "The media element must actually seek, not just move the overlay");
  assert(!result.oldPaused, "A playing clip must resume after a completed seek");
  console.log(`${platform}: PASS horizontal hold-and-drag commits the seek and resumes the active clip.`);

  box = await prepare("lifecycle-fixture");
  await touch([move(box.x, box.y), down, move(box.x, box.height * 0.18, 400), up]);
  await waitFor("native vertical swipe to activate the second card", () => script(`
    return !!document.querySelector('[data-testid="video-social-gesture-second"]');
  `));
  await sleep(600);
  result = await state();
  nativeStart(result);
  assert(result.scroll > box.height * 0.65, "The feed must really scroll to the next card");
  assert(!result.events.some(e => e.type === "seeking"), "A vertical swipe must not seek");
  noReplay(result);
  console.log(`${platform}: PASS vertical swipe advances the feed without seeking or replaying the old clip.`);

  box = await prepare("gesture-second");
  await touch([move(box.x, box.y), down, hold(box), move(box.x + 3, box.height * 0.18, 450), up]);
  await waitFor("held vertical swipe to activate the third card", () => script(`
    return !!document.querySelector('[data-testid="video-social-gesture-third"]');
  `));
  await sleep(600);
  result = await state();
  nativeStart(result);
  assert(result.events.some(e => e.type === "pause"), "A hold must enter seeking before cancellation");
  assert(result.events.some(e => e.type === "pointercancel" && e.trusted),
    "Native scrolling must cancel the held pointer");
  assert(!result.events.some(e => e.type === "seeking"), "Cancelling must discard the pending seek");
  noReplay(result);
  console.log(`${platform}: PASS native pointer cancellation discards seeking and never restarts the inactive clip.`);
  } else {
    await script(`
      const root = document.querySelector('[data-testid="watch-device-feed"]');
      root.scrollTo({ top: root.clientHeight * 2, behavior: 'instant' });
    `);
  }

  box = await prepare("gesture-third");
  const switchDx = Math.round(box.width * 0.25);
  // One native action sequence: XCUITest cannot retain a down pointer across
  // WebDriver requests. Trigger navigation from the actual down event instead.
  await script(`
    const root = document.querySelector('[data-testid="watch-device-feed"]');
    document.querySelector('[data-testid="watch-gesture-surface"]').addEventListener('pointerdown', () => {
      setTimeout(() => root.scrollTo({ top: root.clientHeight * 3, behavior: 'instant' }), 700);
    }, { once: true });
  `);
  await touch([move(box.x, box.y), down, hold(box), move(box.x + switchDx, box.y, 200),
    move(box.x + switchDx, box.y, 500), up]);
  await waitFor("card switch while pointer held", () => script(`
    return !!document.querySelector('[data-testid="video-social-gesture-fourth"]');
  `));
  await sleep(800);
  result = await state();
  nativeStart(result);
  assert(result.events.some(e => e.type === "pause"), "The card must switch during a held seek");
  assert(!result.events.some(e => e.type === "seeking"), "Unmount must discard an uncommitted seek");
  noReplay(result);
  assert(result.active.length === 1 && result.active[0] === "video-social-gesture-fourth",
    "Only the newly active clip may play after releasing an old gesture");
  console.log(`${platform}: PASS switching cards during a held seek cannot resume an inactive clip.`);
  console.log(`${platform}: Watch real-touch gesture suite passed.`);
}
