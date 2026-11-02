import { describe, expect, it, vi } from "vitest";
import { playbackProgressToSave, restorePlaybackProgress } from "./playback-progress";

describe("saved video progress", () => {
  it("restores a valid saved position and keeps it before the end", () => {
    const video = { currentTime: 0, duration: 30 };
    expect(restorePlaybackProgress(video, 12.5)).toBe(true);
    expect(video.currentTime).toBe(12.5);

    expect(restorePlaybackProgress(video, 90)).toBe(true);
    expect(video.currentTime).toBe(29.9);
  });

  it("does not restore missing or invalid positions", () => {
    const video = { currentTime: 4, duration: 30 };
    expect(restorePlaybackProgress(video, null)).toBe(false);
    expect(restorePlaybackProgress(video, -1)).toBe(false);
    expect(restorePlaybackProgress(video, Number.NaN)).toBe(false);
    expect(video.currentTime).toBe(4);
    expect(restorePlaybackProgress({ currentTime: 0, duration: Number.NaN }, 10)).toBe(false);
    expect(restorePlaybackProgress({ currentTime: 0, duration: Infinity }, 10)).toBe(false);
  });

  it("saves meaningful progress updates and flushes smaller changes on close", () => {
    const persist = vi.fn();
    expect(playbackProgressToSave(13, 10)).toBeNull();
    const next = playbackProgressToSave(15, 10);
    if (next !== null) persist(next);
    expect(persist).toHaveBeenCalledWith(15);
    expect(playbackProgressToSave(16, 15, true)).toBe(16);
    expect(playbackProgressToSave(0, 0, true)).toBeNull();
  });
});
