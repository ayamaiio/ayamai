import { describe, expect, it } from "vitest";
import { withVideoViewCount } from "./video-view-cache";

const post = { id: "a", likeCount: 2, viewCount: 0, visibility: "public" };
describe("video view count cache", () => {
  it("patches details, lists and infinite pages without reordering or losing cursors", () => {
    const other = { ...post, id: "b" };
    const data = { pages: [{ items: [post, other], nextCursor: "next" }], pageParams: [""] };
    expect(withVideoViewCount(data, "a", 1, "public")).toEqual({
      pages: [{ items: [{ ...post, viewCount: 1 }, other], nextCursor: "next" }], pageParams: [""],
    });
    expect(withVideoViewCount({ post }, "a", 1, "public")).toEqual({ post: { ...post, viewCount: 1 } });
  });
  it("ignores stale visibility, out-of-order smaller totals and invalid counts", () => {
    const current = { ...post, viewCount: 5 };
    expect(withVideoViewCount(current, "a", 2, "public")).toBe(current);
    expect(withVideoViewCount(current, "a", 10, "private")).toBe(current);
    expect(withVideoViewCount(current, "a", -1, "public")).toBe(current);
    expect(withVideoViewCount(current, "a", Number.NaN, "public")).toBe(current);
  });
});
