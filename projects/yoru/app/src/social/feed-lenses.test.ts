import { describe, expect, it } from "vitest";
import { creatorLens, displayTags, ladderDepth, normalizeTag, tagLens } from "./feed-lenses";

describe("lenses", () => {
  it("counts only ladder rungs, so a tag never consumes one", () => {
    expect(ladderDepth([])).toBe(0);
    expect(ladderDepth([{ level: "kind", value: "pixiv", label: "pixiv" }])).toBe(1);
    expect(ladderDepth([
      { level: "tag", value: "landscape", label: "#landscape" },
      { level: "kind", value: "pixiv", label: "pixiv" },
    ])).toBe(1);
  });

  it("normalises a tag the way the API does", () => {
    expect(normalizeTag("  #Landscape ")).toBe("landscape");
    expect(normalizeTag("Original Work")).toBe("original-work");
    expect(normalizeTag("")).toBe("");
  });

  it("builds a tag lens, or nothing when the tag is empty", () => {
    expect(tagLens("#Night")).toEqual({ level: "tag", value: "night", label: "#night" });
    expect(tagLens("  ")).toBeNull();
    expect(creatorLens("Mariya T.")?.level).toBe("creator");
  });
});

describe("the tags a slide shows", () => {
  it("drops the bookkeeping tags and keeps the interesting ones", () => {
    const { shown, rest } = displayTags(["web-capture", "pixiv-post", "nsfw", "illustration", "original", "girl", "night", "city"]);
    expect(shown).toEqual(["illustration", "original", "girl", "night"]);
    expect(rest).toEqual(["city"]);
  });

  it("takes a limit", () => {
    expect(displayTags(["a", "b", "c"], 2)).toEqual({ shown: ["a", "b"], rest: ["c"] });
    expect(displayTags([]).shown).toEqual([]);
  });
});
