import { describe, expect, it } from "vitest";
import { addTags, canonicalTag, draftFrom, newRow, toInput, validateDraft } from "./annotation-lib";

describe("annotation-lib", () => {
  it("canonicalizes tags like the server", () => {
    expect(canonicalTag("  #Golden  Hour ")).toBe("golden-hour");
    expect(canonicalTag("ＦＵＬＬ")).toBe("full");
    expect(addTags(["a"], "A, #b c,,b-c")).toEqual(["a", "b-c"]);
    expect(canonicalTag("#A\u200bQUA")).toBe("aqua");
  });
  it("rejects invalid or excessive tags rather than silently truncating the dataset", () => {
    const draft = draftFrom(undefined);
    draft.tags = addTags([], "x".repeat(81));
    expect(draft.tags[0].length).toBe(81);
    expect(validateDraft(draft).ok).toBe(false);
    draft.tags = Array.from({ length: 41 }, (_, i) => `tag-${i}`);
    expect(validateDraft(draft).ok).toBe(false);
    draft.tags = [];
    draft.attrs = [newRow("__proto__", "invalid")];
    expect(validateDraft(draft).ok).toBe(false);
    draft.attrs = [];
    draft.sourceUrl = "http://example.com";
    expect(validateDraft(draft).ok).toBe(false);
  });
  it("rejects duplicate and invalid attribute keys", () => {
    const d = draftFrom(undefined);
    d.attrs = [newRow("Mood", "warm"), newRow("mood", "cold"), newRow("bad!", "x")];
    const v = validateDraft(d);
    expect(v.ok).toBe(false);
    expect(Object.values(v.rows)).toContain("Duplicate attribute name.");
  });
  it("builds input with revision and null empty source", () => {
    const d = draftFrom(undefined);
    d.attrs = [newRow("Setting", "beach, dusk, beach")];
    expect(toInput(d, 3)).toMatchObject({ expectedRevision: 3, attributes: { setting: ["beach", "dusk"] }, sourceUrl: null });
  });
});
