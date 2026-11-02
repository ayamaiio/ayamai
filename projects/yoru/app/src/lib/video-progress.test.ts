import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { readVideoProgress, rememberVideoProgress } from "./video-progress";

beforeEach(() => localStorage.clear());
describe("personal video progress", () => {
  it("persists playback through reloads, without crossing accounts", () => {
    const client = new QueryClient();
    rememberVideoProgress(client, "viewer-a", "video", 30, 120);
    expect(readVideoProgress("viewer-a").video).toEqual({ seconds: 30, duration: 120 });
    expect(readVideoProgress("viewer-b")).toEqual({});
    expect(client.getQueryData(["video-playback-progress", "viewer-a"])).toEqual(readVideoProgress("viewer-a"));
    client.clear();
  });
  it("clamps progress and ignores anonymous, invalid or corrupt records", () => {
    const client = new QueryClient();
    rememberVideoProgress(client, "viewer", "video", 130, 120);
    expect(readVideoProgress("viewer").video.seconds).toBe(120);
    rememberVideoProgress(client, "anon", "video", 30, 120);
    expect(readVideoProgress("anon")).toEqual({});
    rememberVideoProgress(client, "viewer", "invalid", 30, Infinity);
    expect(readVideoProgress("viewer").invalid).toBeUndefined();
    localStorage.setItem("ayanami:video-progress:viewer", "broken JSON");
    expect(readVideoProgress("viewer")).toEqual({});
    client.clear();
  });
});
