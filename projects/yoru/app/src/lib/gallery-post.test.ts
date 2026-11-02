import { describe, expect, it } from "vitest";
import { MAX_GALLERY_IMAGES, admitFiles, clampSlide, gallerySlides, isAmbiguousFailure, moveItem } from "./gallery-post";
import { horizontalSwipeDirection } from "./watch-gestures";

const img = (n: number, type = "image/png") => ({ name: `f${n}.png`, type, size: 10 });
const vid = { name: "v.mp4", type: "video/mp4", size: 10 };

describe("admitFiles", () => {
  it("accepts up to the image limit, including GIFs", () => {
    const files = Array.from({ length: MAX_GALLERY_IMAGES + 2 }, (_, i) => img(i, i === 0 ? "image/gif" : "image/png"));
    const r = admitFiles("empty", 0, files);
    expect(r.accepted).toHaveLength(MAX_GALLERY_IMAGES);
    expect(r.kind).toBe("images");
    expect(r.problems.join()).toMatch(/up to 20/);
  });
  it("refuses mixing video with images", () => {
    expect(admitFiles("images", 2, [vid]).accepted).toHaveLength(0);
    expect(admitFiles("video", 1, [img(1)]).accepted).toHaveLength(0);
    const r = admitFiles("empty", 0, [vid, img(1)]);
    expect(r.kind).toBe("video");
    expect(r.accepted).toHaveLength(1);
  });
  it("skips empty and unsupported files", () => {
    const r = admitFiles("empty", 0, [{ name: "a.txt", type: "text/plain", size: 3 }, { name: "b.png", type: "image/png", size: 0 }]);
    expect(r.accepted).toHaveLength(0);
    expect(r.kind).toBe("empty");
  });
});

describe("ordering and retries", () => {
  it("moves items without mutating", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 2, 0)).toEqual(["c", "a", "b"]);
    expect(list).toEqual(["a", "b", "c"]);
    expect(moveItem(list, 0, 9)).toEqual(list);
  });
  it("treats network and server failures as ambiguous", () => {
    expect(isAmbiguousFailure(undefined)).toBe(true);
    expect(isAmbiguousFailure(502)).toBe(true);
    expect(isAmbiguousFailure(409)).toBe(true);
    expect(isAmbiguousFailure(400)).toBe(false);
  });
});

describe("gallery slides", () => {
  it("orders attachments by position and keeps the cover id as the post id", () => {
    const post = { id: "p", mediaType: "image" as const, attachments: [{ id: "b", contentType: "image/gif", position: 1 }, { id: "p", contentType: "image/png", position: 0 }] };
    expect(gallerySlides(post).map((s) => s.id)).toEqual(["p", "b"]);
  });
  it("tolerates missing attachments and videos", () => {
    expect(gallerySlides({ id: "p", mediaType: "image" })).toEqual([]);
    expect(gallerySlides({ id: "v", mediaType: "video", attachments: [] })).toEqual([]);
  });
  it("clamps navigation", () => {
    expect(clampSlide(-1, 3)).toBe(0);
    expect(clampSlide(5, 3)).toBe(2);
  });
  it("only recognises clearly horizontal swipes", () => {
    expect(horizontalSwipeDirection(-80, 10)).toBe(1);
    expect(horizontalSwipeDirection(80, 10)).toBe(-1);
    expect(horizontalSwipeDirection(60, 70)).toBeNull();
    expect(horizontalSwipeDirection(20, 0)).toBeNull();
  });
});
