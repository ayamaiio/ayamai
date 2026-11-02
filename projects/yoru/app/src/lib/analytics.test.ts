import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent, trackPostAction } from "./analytics";

afterEach(() => { delete window.umami; });

describe("aggregate analytics boundary", () => {
  it("does nothing safely before the injected tracker is available", () => {
    expect(() => trackEvent("comment_created")).not.toThrow();
  });
  it("sends only allowlisted properties, not user content or IDs", () => {
    const track = vi.fn();
    window.umami = { track };
    const input = { file_count: 12, filename: "private.jpg", mediaId: "private-id", url: "https://private.invalid" };
    trackEvent("upload_batch_started", input);
    expect(track).toHaveBeenCalledExactlyOnceWith("upload_batch_started", { file_count: 12 });
  });
  it("ignores invalid values and untracked moderation actions", () => {
    const track = vi.fn(); window.umami = { track };
    trackEvent("upload_batch_started", { file_count: NaN });
    trackEvent("upload_batch_started", { file_count: -1 });
    trackPostAction("report", "scroll");
    expect(track).not.toHaveBeenCalled();
  });
  it("separates scroll and player outcomes", () => {
    const track = vi.fn(); window.umami = { track };
    trackPostAction("save", "scroll");
    trackPostAction("like", "player");
    expect(track).toHaveBeenNthCalledWith(1, "post_action_saved", { action: "save", surface: "scroll" });
    expect(track).toHaveBeenNthCalledWith(2, "post_action_saved", { action: "like", surface: "player" });
  });
  it("contains both thrown errors and rejected promises", async () => {
    window.umami = { track: () => { throw new Error("tracker unavailable"); } };
    expect(() => trackEvent("private_labels_saved")).not.toThrow();
    window.umami = { track: () => Promise.reject(new Error("offline")) };
    trackEvent("comment_created");
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});
