import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { getPlaybackBookmark, setPlaybackBookmark } from "@workspace/api-client-react";
import { usePlaybackBookmark } from "./use-playback-bookmark";

vi.mock("@workspace/api-client-react", () => ({
  getPlaybackBookmark: vi.fn(), setPlaybackBookmark: vi.fn(),
}));
vi.mock("@workspace/ayamai-design-system/hooks/use-toast", () => ({ toast: vi.fn() }));
const get = vi.mocked(getPlaybackBookmark), put = vi.mocked(setPlaybackBookmark);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  get.mockResolvedValue({ seconds: 30 });
  put.mockResolvedValue({ seconds: 60 });
});
function setup(ready = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const video = document.createElement("video");
  Object.defineProperties(video, {
    readyState: { configurable: true, value: ready },
    duration: { configurable: true, value: 120 },
    ended: { configurable: true, value: false },
  });
  video.pause = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const ref = { current: video };
  const hook = renderHook(({ uid, id }) => usePlaybackBookmark(ref, uid, id, "fixture.mp4"), {
    wrapper, initialProps: { uid: "viewer", id: "saved-video" },
  });
  const event = (type: string, seconds?: number) => act(() => {
    if (seconds !== undefined) video.currentTime = seconds;
    video.dispatchEvent(new Event(type));
  });
  return { ...hook, video, event };
}
it("fresh device restores only after metadata, and opening/closing alone never writes zero", async () => {
  const h = setup(0);
  await waitFor(() => expect(get).toHaveBeenCalledWith("saved-video", "viewer", expect.anything()));
  expect(h.video.currentTime).toBe(0);
  Object.defineProperty(h.video, "readyState", { value: 1 });
  h.event("loadedmetadata");
  await waitFor(() => expect(h.video.currentTime).toBe(30));
  h.event("pause");
  h.unmount();
  expect(put).not.toHaveBeenCalled();
});
it("throttles rapid seeking, flushes on pause and page exit, resets completion and saves replay", async () => {
  const h = setup();
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  h.event("play");
  h.event("timeupdate", 60);
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  await act(async () => {});
  h.event("timeupdate", 80);
  h.event("timeupdate", 100);
  expect(put).toHaveBeenCalledTimes(1);
  h.event("pause", 101);
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
  await act(async () => {});
  act(() => { h.video.currentTime = 110; window.dispatchEvent(new Event("pagehide")); });
  await waitFor(() => expect(put).toHaveBeenCalledTimes(3));
  await act(async () => {});
  h.event("ended", 120);
  await waitFor(() => expect(put).toHaveBeenLastCalledWith("saved-video", "viewer", { seconds: 0 }, { keepalive: true }));
  await act(async () => {});
  h.event("play", 0);
  h.event("pause", 12);
  await waitFor(() => expect(put).toHaveBeenLastCalledWith("saved-video", "viewer", { seconds: 12 }, { keepalive: true }));
  h.unmount();
});
it("account changes discard a delayed restore and never send old progress under the new account", async () => {
  let resolve!: (value: { seconds: number }) => void;
  get.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const h = setup();
  h.rerender({ uid: "other", id: "saved-video" });
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  await act(async () => resolve({ seconds: 90 }));
  expect(h.video.currentTime).toBe(30);
  expect(put).not.toHaveBeenCalled();
  h.event("play");
  h.event("pause", 50);
  await waitFor(() => expect(put).toHaveBeenCalledWith("saved-video", "other", { seconds: 50 }, expect.anything()));
  h.unmount();
});
it("surfaces read and save failures and retries without silently accepting unsynced progress", async () => {
  get.mockRejectedValueOnce(new Error("unavailable"));
  const h = setup();
  await waitFor(() => expect(h.result.current.error).toContain("couldn’t load"));
  h.event("play");
  h.event("pause", 40);
  expect(put).not.toHaveBeenCalled();
  act(() => h.result.current.retry());
  await waitFor(() => expect(h.result.current.error).toBe(""));
  put.mockRejectedValueOnce(new Error("unavailable"));
  h.event("play");
  h.event("pause", 40);
  await waitFor(() => expect(h.result.current.error).toContain("didn’t sync"));
  act(() => h.result.current.retry());
  await waitFor(() => expect(h.result.current.error).toBe(""));
  expect(put).toHaveBeenCalledTimes(2);
  h.unmount();
});
it("clamps a saved position against actual metadata and preserves a deliberate zero seek after play", async () => {
  get.mockResolvedValue({ seconds: 900 });
  const h = setup();
  await waitFor(() => expect(h.video.currentTime).toBe(119.9));
  h.event("play");
  h.event("pause", 0);
  await waitFor(() => expect(put).toHaveBeenCalledWith("saved-video", "viewer", { seconds: 0 }, expect.anything()));
  h.unmount();
});
