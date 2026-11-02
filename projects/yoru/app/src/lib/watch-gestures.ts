export const HOLD_MS = 350;
export const DOUBLE_TAP_MS = 300;
export type Tap = { x: number; y: number; at: number };

export function isDoubleTap(previous: Tap | null, current: Tap) {
  return previous !== null && current.at >= previous.at && current.at - previous.at <= DOUBLE_TAP_MS
    && Math.hypot(current.x - previous.x, current.y - previous.y) < 36;
}
export function seekPosition(start: number, deltaX: number, width: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(width) || width <= 0) return start;
  return Math.max(0, Math.min(duration - Math.min(0.05, duration), start + deltaX / width * duration));
}
export function isVerticalSwipe(dx: number, dy: number) {
  return Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx);
}
export const HORIZONTAL_SWIPE_PX = 48;
/** +1 = next (finger moved left), -1 = previous; null when the motion was not clearly horizontal. */
export function horizontalSwipeDirection(dx: number, dy: number): 1 | -1 | null {
  if (Math.abs(dx) < HORIZONTAL_SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.3) return null;
  return dx < 0 ? 1 : -1;
}
