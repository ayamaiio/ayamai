import { useEffect, useState } from "react";

export const LARGE_SCREEN_QUERY = "(min-width: 768px)";

/** One-shot check by CSS width (never user agent). */
export function isLargeScreen() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(LARGE_SCREEN_QUERY).matches;
}

export function useLargeScreen() {
  const [large, setLarge] = useState(isLargeScreen);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(LARGE_SCREEN_QUERY);
    const onChange = () => setLarge(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return large;
}
