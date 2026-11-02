import { describe, expect, it } from "vitest";
import { CAPTURE_MAX, decodeCapture, safeCaptureSource } from "./capture-protocol";
describe("capture boundary", () => {
  it("retains safe numeric post provenance, not capability URLs", () => {
    expect(safeCaptureSource("https://example.com/posts/123?token=secret#key")).toBe("https://example.com/posts/123");
    expect(safeCaptureSource("https://example.com/share/short-secret")).toBe("https://example.com/");
    expect(() => safeCaptureSource("https://u:p@example.com/post")).toThrow();
    expect(() => safeCaptureSource("http://example.com/post")).toThrow();
  });
  it("accepts only bounded supported byte payloads, not MIME or size lies", async () => {
    const data = { base64: btoa("benign"), contentType: "image/png", size: 6, sourceUrl: "https://example.com/posts/1" };
    expect(decodeCapture(data).file.size).toBe(6);
    expect(decodeCapture({ ...data, contentType: "video/mp4" }).file.type).toBe("video/mp4");
    for (const patch of [{ size: 0 }, { size: CAPTURE_MAX + 1 }, { size: 3 }, { contentType: "image/svg+xml" }, { base64: "bad%%" }, { sourceUrl: "javascript:alert(1)" }]) expect(() => decodeCapture({ ...data, ...patch })).toThrow();
  });
});
