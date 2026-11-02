import { describe, expect, it, vi, beforeEach } from "vitest";
import { QUICK_SKIP_MS, classifyDwell, isConsumeView, nextPage, consumeParam, sendSignal } from "./feed-signals";

describe("what a visit counts as", () => {
  it("is a skip below the threshold, attention at or above it", () => {
    expect(classifyDwell(0)).toBe("quick-skip");
    expect(classifyDwell(QUICK_SKIP_MS - 1)).toBe("quick-skip");
    expect(classifyDwell(QUICK_SKIP_MS)).toBe("dwell");
    expect(classifyDwell(30_000)).toBe("dwell");
  });

  it("does not trust a broken clock", () => {
    expect(classifyDwell(Number.NaN)).toBe("quick-skip");
    expect(classifyDwell(-500)).toBe("quick-skip");
  });
});

describe("a click through a collection", () => {
  it("walks the pages, then hands over to the feed", () => {
    expect(nextPage(0, 3)).toBe(1);
    expect(nextPage(1, 3)).toBe(2);
    expect(nextPage(2, 3)).toBeNull();
  });

  it("advances the post immediately when there is one page", () => {
    expect(nextPage(0, 1)).toBeNull();
    expect(nextPage(0, 0)).toBeNull();
  });

  it("clamps a page index that has run past the end", () => {
    expect(nextPage(9, 3)).toBeNull();
    expect(nextPage(-4, 3)).toBe(1);
  });
});

describe("reporting", () => {
  const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("posts one event with a rounded, non-negative duration", () => {
    sendSignal("abc", "dwell", 12.6);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/watch/media/abc/event");
    expect(JSON.parse(String(init.body))).toEqual({ event: "dwell", watchSeconds: 13 });
    expect(init.keepalive).toBe(true);
  });

  it("never throws when the network is gone", () => {
    fetchMock.mockImplementationOnce(() => { throw new Error("offline"); });
    expect(() => sendSignal("abc", "quick-skip", 0)).not.toThrow();
  });
});

describe("consumption mode", () => {
  it("is on only when the URL asks for it", () => {
    expect(isConsumeView("?play=1")).toBe(true);
    expect(isConsumeView("?play")).toBe(true);
    expect(isConsumeView("play=1")).toBe(true);
    expect(isConsumeView("?play=0")).toBe(false);
    expect(isConsumeView("?play=2")).toBe(false);
    expect(isConsumeView("")).toBe(false);
    expect(isConsumeView("?lens=video")).toBe(false);
  });

  it("writes what it means back into the querystring", () => {
    expect(consumeParam(true)).toBe("play=1");
    expect(consumeParam(false)).toBe("");
  });
});
