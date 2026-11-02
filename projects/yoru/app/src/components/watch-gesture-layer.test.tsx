import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS } from "../lib/watch-gestures";
import { WatchGestureLayer } from "./watch-gesture-layer";
import { useWatchChrome, WATCH_CHROME_IDLE_MS } from "../lib/use-watch-chrome";

function makeVideo(currentTime = 40, duration = 100) {
  const video = document.createElement("video");
  let time = currentTime;
  let paused = false;
  Object.defineProperties(video, {
    currentTime: { configurable: true, get: () => time, set: (value: number) => { time = value; } },
    duration: { configurable: true, value: duration },
    paused: { configurable: true, get: () => paused },
    readyState: { configurable: true, value: 2 },
  });
  video.pause = vi.fn(() => { paused = true; });
  video.play = vi.fn(() => { paused = false; return Promise.resolve(); });
  return video;
}

function pointer(target: Element, type: string, values: { x: number; y: number }) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, {
    pointerId: 7, isPrimary: true, button: 0, clientX: values.x, clientY: values.y,
  });
  fireEvent(target, event);
}

function renderLayer(video: HTMLVideoElement, options: { controlsVisible?: boolean; onRevealControls?: () => void; onLike?: () => void } = {}) {
  const videoRef = createRef<HTMLVideoElement | null>();
  videoRef.current = video;
  const view = render(<WatchGestureLayer videoRef={videoRef} onLike={vi.fn()} isVideo {...options} />);
  const surface = screen.getByTestId("watch-gesture-surface");
  Object.defineProperty(surface, "clientWidth", { configurable: true, value: 400 });
  surface.setPointerCapture = vi.fn();
  surface.hasPointerCapture = vi.fn(() => true);
  surface.releasePointerCapture = vi.fn();
  return { ...view, surface, videoRef };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Watch gesture controls", () => {
  it("reveals without pausing when parent overlay visibility changes during the same touch", () => {
    vi.useFakeTimers();
    const video = makeVideo();
    const videoRef = createRef<HTMLVideoElement | null>();
    videoRef.current = video;
    function Watching() {
      const chrome = useWatchChrome("clip");
      return <div {...chrome.handlers}><WatchGestureLayer videoRef={videoRef} isVideo onLike={vi.fn()}
        controlsVisible={chrome.visible} onRevealControls={chrome.reveal} /></div>;
    }
    render(<Watching />);
    act(() => vi.advanceTimersByTime(WATCH_CHROME_IDLE_MS + 1));
    const surface = screen.getByTestId("watch-gesture-surface");
    surface.hasPointerCapture = vi.fn(() => false);
    pointer(surface, "pointerdown", { x: 180, y: 100 });
    pointer(surface, "pointerup", { x: 180, y: 100 });
    act(() => vi.advanceTimersByTime(500));
    expect(video.pause).not.toHaveBeenCalled();
    expect(surface.getAttribute("aria-label")).toContain("Tap to pause or play");
    pointer(surface, "pointerdown", { x: 180, y: 100 });
    pointer(surface, "pointerup", { x: 180, y: 100 });
    act(() => vi.advanceTimersByTime(500));
    expect(video.pause).toHaveBeenCalledOnce();
  });
  it("reveals hidden controls on a first tap without pausing playback", () => {
    vi.useFakeTimers();
    const video = makeVideo();
    const reveal = vi.fn();
    const { surface } = renderLayer(video, { controlsVisible: false, onRevealControls: reveal });
    pointer(surface, "pointerdown", { x: 180, y: 100 });
    pointer(surface, "pointerup", { x: 180, y: 100 });
    act(() => vi.advanceTimersByTime(500));
    expect(reveal).toHaveBeenCalledOnce();
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
  });
  it("still double-tap likes while controls are hidden, without pausing", () => {
    vi.useFakeTimers();
    const video = makeVideo();
    const like = vi.fn();
    const { surface } = renderLayer(video, { controlsVisible: false, onLike: like });
    pointer(surface, "pointerdown", { x: 180, y: 100 });
    pointer(surface, "pointerup", { x: 180, y: 100 });
    act(() => vi.advanceTimersByTime(70));
    pointer(surface, "pointerdown", { x: 180, y: 100 });
    pointer(surface, "pointerup", { x: 180, y: 100 });
    act(() => vi.advanceTimersByTime(500));
    expect(like).toHaveBeenCalledOnce();
    expect(video.pause).not.toHaveBeenCalled();
  });
  it("seeks the active clip after a horizontal touch drag", () => {
    vi.useFakeTimers();
    const video = makeVideo();
    const { surface, videoRef } = renderLayer(video);
    const seekZone = screen.getByRole("slider", { name: /Video position/ });

    act(() => {
      pointer(seekZone, "pointerdown", { x: 100, y: 300 });
      vi.advanceTimersByTime(HOLD_MS);
    });
    pointer(surface, "pointermove", { x: 200, y: 300 });
    pointer(surface, "pointerup", { x: 200, y: 300 });

    expect(video.currentTime).toBe(65);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.play).toHaveBeenCalledOnce();
    expect(videoRef.current).toBe(video);
  });

  it("updates the accessible position immediately and retains focus for every seek key", () => {
    const video = makeVideo();
    renderLayer(video);
    const seekZone = screen.getByRole("slider", { name: "Video position. Hold and drag horizontally, or use arrow keys." });

    expect(seekZone.getAttribute("tabindex")).toBe("0");
    expect(seekZone.getAttribute("aria-valuemin")).toBe("0");
    expect(seekZone.getAttribute("aria-valuemax")).toBe("100");
    expect(seekZone.getAttribute("aria-valuenow")).toBe("40");
    expect(seekZone.getAttribute("aria-valuetext")).toBe("0:40 of 1:40");
    seekZone.focus();
    // The video double does not emit timeupdate when currentTime is assigned.
    // Each key must publish the value without waiting for that event.
    for (const [key, time, text] of [
      ["ArrowRight", 45, "0:45 of 1:40"],
      ["ArrowLeft", 40, "0:40 of 1:40"],
      ["Home", 0, "0:00 of 1:40"],
      ["ArrowLeft", 0, "0:00 of 1:40"],
      ["End", 99.95, "1:39 of 1:40"],
      ["ArrowRight", 99.95, "1:39 of 1:40"],
    ] as const) {
      expect(fireEvent.keyDown(seekZone, { key })).toBe(false);
      expect(video.currentTime).toBe(time);
      expect(seekZone.getAttribute("aria-valuenow")).toBe(String(time));
      expect(seekZone.getAttribute("aria-valuetext")).toBe(text);
      expect(document.activeElement).toBe(seekZone);
    }
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
  });

  it("keeps keyboard seeking and media time updates in sync", () => {
    vi.useFakeTimers();
    const video = makeVideo();
    renderLayer(video);
    const seekZone = screen.getByRole("slider");
    seekZone.focus();
    fireEvent.keyDown(seekZone, { key: "ArrowRight" });
    act(() => vi.advanceTimersByTime(250));
    const announcement = screen.getByRole("status");
    expect(announcement.textContent).toBe("Video position: 45 seconds of 1 minute 40 seconds.");
    video.currentTime = 52;
    act(() => video.dispatchEvent(new Event("timeupdate")));
    expect(seekZone.getAttribute("aria-valuenow")).toBe("52");
    expect(seekZone.getAttribute("aria-valuetext")).toBe("0:52 of 1:40");
    expect(document.activeElement).toBe(seekZone);
    // Ordinary playback must not produce a live announcement every second.
    expect(announcement.textContent).toBe("Video position: 45 seconds of 1 minute 40 seconds.");
    fireEvent.blur(seekZone);
    expect(announcement.textContent).toBe("");
  });

  it("announces explicit elapsed and total time for each keyboard seek", () => {
    vi.useFakeTimers();
    renderLayer(makeVideo());
    const seekZone = screen.getByRole("slider");
    const announcement = screen.getByRole("status");
    expect(announcement.getAttribute("aria-live")).toBe("polite");
    expect(announcement.getAttribute("aria-atomic")).toBe("true");
    expect(announcement.textContent).toBe("");
    for (const [key, text] of [
      ["ArrowRight", "45 seconds"],
      ["ArrowLeft", "40 seconds"],
      ["End", "1 minute 39 seconds"],
      ["Home", "0 seconds"],
    ]) {
      fireEvent.keyDown(seekZone, { key });
      act(() => vi.advanceTimersByTime(250));
      expect(announcement.textContent).toBe(`Video position: ${text} of 1 minute 40 seconds.`);
    }
  });

  it("coalesces rapid seeks and cancels pending speech when focus leaves", () => {
    vi.useFakeTimers();
    const { unmount } = renderLayer(makeVideo());
    const seekZone = screen.getByRole("slider");
    const announcement = screen.getByRole("status");
    fireEvent.keyDown(seekZone, { key: "ArrowRight" });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.keyDown(seekZone, { key: "ArrowRight" });
    act(() => vi.advanceTimersByTime(249));
    expect(announcement.textContent).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(announcement.textContent).toBe("Video position: 50 seconds of 1 minute 40 seconds.");
    fireEvent.keyDown(seekZone, { key: "ArrowLeft" });
    fireEvent.blur(seekZone);
    act(() => vi.advanceTimersByTime(250));
    expect(announcement.textContent).toBe("");
    fireEvent.keyDown(seekZone, { key: "End" });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not invent a seek position before duration is known", () => {
    const video = makeVideo(0, Number.NaN);
    renderLayer(video);
    const seekZone = screen.getByRole("slider");
    seekZone.focus();
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      fireEvent.keyDown(seekZone, { key });
      expect(video.currentTime).toBe(0);
      expect(seekZone.getAttribute("aria-valuenow")).toBe("0");
      expect(seekZone.getAttribute("aria-valuetext")).toBe("0:00 of 0:00");
      expect(document.activeElement).toBe(seekZone);
      expect(screen.getByRole("status").textContent).toBe("");
    }
  });

  it("leaves vertical motion to feed scrolling and never seeks or resumes on cancellation", () => {
    vi.useFakeTimers();
    const video = makeVideo();
    const { surface } = renderLayer(video);
    const seekZone = screen.getByRole("slider");

    expect((surface as HTMLElement).style.touchAction).toBe("pan-y");
    act(() => {
      pointer(seekZone, "pointerdown", { x: 100, y: 300 });
      vi.advanceTimersByTime(HOLD_MS);
    });
    pointer(surface, "pointermove", { x: 106, y: 350 });

    expect(video.currentTime).toBe(40);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
  });

  it("does not apply a pending seek or resume after the active video changes", () => {
    vi.useFakeTimers();
    const oldVideo = makeVideo();
    const nextVideo = makeVideo(12, 90);
    const { surface, videoRef } = renderLayer(oldVideo);
    const seekZone = screen.getByRole("slider");

    act(() => {
      pointer(seekZone, "pointerdown", { x: 100, y: 300 });
      vi.advanceTimersByTime(HOLD_MS);
    });
    pointer(surface, "pointermove", { x: 200, y: 300 });
    videoRef.current = nextVideo;
    pointer(surface, "pointerup", { x: 200, y: 300 });

    expect(oldVideo.currentTime).toBe(40);
    expect(oldVideo.play).not.toHaveBeenCalled();
    expect(nextVideo.currentTime).toBe(12);
    expect(nextVideo.play).not.toHaveBeenCalled();
  });
});

describe("gallery swipes", () => {
  function renderGallery() {
    const onSwipe = vi.fn();
    const onLike = vi.fn();
    const videoRef = createRef<HTMLVideoElement | null>();
    render(<WatchGestureLayer videoRef={videoRef} onLike={onLike} isVideo={false} onHorizontalSwipe={onSwipe} />);
    const surface = screen.getByTestId("watch-gesture-surface");
    surface.hasPointerCapture = vi.fn(() => false);
    surface.releasePointerCapture = vi.fn();
    return { surface, onSwipe, onLike };
  }
  it("changes image on horizontal swipe and has no seek zone", () => {
    const { surface, onSwipe } = renderGallery();
    expect(screen.queryByTestId("watch-seek-zone")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    pointer(surface, "pointerdown", { x: 300, y: 300 });
    pointer(surface, "pointermove", { x: 200, y: 305 });
    pointer(surface, "pointerup", { x: 200, y: 305 });
    expect(onSwipe).toHaveBeenCalledWith(1);
  });
  it("leaves vertical motion to the feed", () => {
    const { surface, onSwipe } = renderGallery();
    pointer(surface, "pointerdown", { x: 300, y: 300 });
    pointer(surface, "pointermove", { x: 290, y: 150 });
    pointer(surface, "pointerup", { x: 290, y: 150 });
    expect(onSwipe).not.toHaveBeenCalled();
  });
  it("supports arrow keys", () => {
    const { surface, onSwipe } = renderGallery();
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    expect(onSwipe).toHaveBeenCalledWith(-1);
  });
});
