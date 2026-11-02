import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePageTitle } from "./page-title";

describe("ayamai page titles", () => {
  it("uses the corrected name for route titles and the fallback", () => {
    const { rerender } = renderHook(({ title }) => usePageTitle(title), {
      initialProps: { title: "Library" },
    });
    expect(document.title).toBe("Library · yoru");
    rerender({ title: "" });
    expect(document.title).toBe("ayamai");
  });
});
