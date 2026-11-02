import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VideoProgressBar } from "./video-progress-bar";

afterEach(cleanup);
describe("video thumbnail progress", () => {
  it("shows an accessible proportional playback bar", () => {
    render(<VideoProgressBar seconds={30} duration={120} />);
    const bar = screen.getByRole("progressbar", { name: "Playback progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(bar.getAttribute("aria-valuetext")).toBe("25% watched");
    expect((bar.firstElementChild as HTMLElement).style.transform).toBe("translateX(-75%)");
  });
  it.each([0, null, undefined, Number.NaN])("hides unwatched or invalid progress %s", seconds => {
    render(<VideoProgressBar seconds={seconds} duration={120} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("clamps completed playback to a full bar", () => {
    render(<VideoProgressBar seconds={130} duration={120} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });
  it.each([0, null, Number.NaN, Infinity])("hides unknown or invalid duration %s", duration => {
    render(<VideoProgressBar seconds={30} duration={duration} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
