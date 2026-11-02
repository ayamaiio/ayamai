import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PointerEvent } from "react";
import { useWatchChrome, WATCH_CHROME_IDLE_MS, watchChromeAttributes, watchChromeClass } from "./use-watch-chrome";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const idle = () => act(() => { vi.advanceTimersByTime(WATCH_CHROME_IDLE_MS + 1); });
describe("Watch overlay visibility", () => {
  it("cancels hiding immediately when always-visible is enabled and resumes when disabled", () => {
    const { result, rerender } = renderHook(
      ({ alwaysVisible }) => useWatchChrome("one", false, true, alwaysVisible),
      { initialProps: { alwaysVisible: false } },
    );
    idle();
    expect(result.current.visible).toBe(false);
    rerender({ alwaysVisible: true });
    idle();
    expect(result.current.visible).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    act(() => result.current.handlers.onPointerDown());
    idle();
    expect(result.current.visible).toBe(true);
    rerender({ alwaysVisible: false });
    idle();
    expect(result.current.visible).toBe(false);
  });
  it("fades on idle and reveals on touch and a new post", () => {
    const { result, rerender } = renderHook(({ id }) => useWatchChrome(id), { initialProps: { id: "one" } });
    idle(); expect(result.current.visible).toBe(false);
    act(() => result.current.handlers.onPointerDown());
    expect(result.current.visible).toBe(true);
    idle(); expect(result.current.visible).toBe(false);
    rerender({ id: "two" });
    expect(result.current.visible).toBe(true);
  });
  it("keeps paused playback, open menus and failed media visible until unpinned", () => {
    const { result, rerender } = renderHook(({ pinned }) => useWatchChrome("one", pinned), { initialProps: { pinned: true } });
    idle(); expect(result.current.visible).toBe(true);
    rerender({ pinned: false });
    idle(); expect(result.current.visible).toBe(false);
    rerender({ pinned: true });
    expect(result.current.visible).toBe(true);
  });
  it("holds controls for keyboard navigation, then resumes fading for pointer input", () => {
    const { result } = renderHook(() => useWatchChrome("one"));
    idle();
    act(() => result.current.handlers.onKeyDownCapture());
    idle(); expect(result.current.visible).toBe(true);
    act(() => result.current.handlers.onPointerDown());
    idle(); expect(result.current.visible).toBe(false);
  });
  it("reveals on mouse movement and stays visible while hovering controls", () => {
    const button = document.createElement("button");
    button.dataset.watchChrome = "";
    const { result } = renderHook(() => useWatchChrome("one"));
    idle();
    const move = (target: Element) => act(() => result.current.handlers.onPointerMoveCapture({ pointerType: "mouse", target } as unknown as PointerEvent<HTMLElement>));
    move(button);
    idle(); expect(result.current.visible).toBe(true);
    move(document.body);
    expect(result.current.visible).toBe(true);
    idle(); expect(result.current.visible).toBe(false);
  });
  it("makes hidden controls inert and inaccessible, not invisible click targets", () => {
    function Example() {
      const chrome = useWatchChrome("one");
      return <div {...watchChromeAttributes(chrome.visible)} className={watchChromeClass(chrome.visible)}><button>Like</button></div>;
    }
    const { container } = render(<Example />);
    idle();
    const controls = container.firstElementChild!;
    expect(controls.hasAttribute("inert")).toBe(true);
    expect(controls.getAttribute("aria-hidden")).toBe("true");
    expect(controls.className).toContain("opacity-0");
    expect(controls.className).toContain("motion-reduce:transition-none");
  });
  it("clears idle timers when unmounted", () => {
    const { unmount } = renderHook(() => useWatchChrome("one"));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
