import { expect, it } from "vitest";
import { DOUBLE_TAP_MS, HOLD_MS, isDoubleTap, isVerticalSwipe, seekPosition } from "./watch-gestures";

it("a double tap must be close in time and space, not an unrelated tap", () => {
  const first = { x: 100, y: 200, at: 1000 };
  expect(isDoubleTap(first, { x: 105, y: 209, at: 1250 })).toBe(true);
  expect(isDoubleTap(first, { ...first, at: first.at + DOUBLE_TAP_MS })).toBe(true);
  expect(isDoubleTap(first, { ...first, at: first.at + DOUBLE_TAP_MS + 1 })).toBe(false);
  expect(isDoubleTap(first, { x: 200, y: 200, at: 1100 })).toBe(false);
  expect(isDoubleTap(null, first)).toBe(false);
  expect(HOLD_MS).toBeGreaterThan(DOUBLE_TAP_MS);
});
it("horizontal drag seeks relatively in either direction and clamps safely", () => {
  expect(seekPosition(50, 100, 400, 100)).toBe(75);
  expect(seekPosition(50, -100, 400, 100)).toBe(25);
  expect(seekPosition(2, -400, 400, 100)).toBe(0);
  expect(seekPosition(90, 400, 400, 100)).toBe(99.95);
  expect(seekPosition(10, 20, 0, 100)).toBe(10);
  expect(seekPosition(10, 20, 400, Infinity)).toBe(10);
  expect(seekPosition(10, 20, 400, NaN)).toBe(10);
});
it("upward/downward motion remains a swipe rather than an accidental seek", () => {
  expect(isVerticalSwipe(5, -40)).toBe(true);
  expect(isVerticalSwipe(5, 40)).toBe(true);
  expect(isVerticalSwipe(100, 40)).toBe(false);
  expect(isVerticalSwipe(0, 10)).toBe(false);
});
