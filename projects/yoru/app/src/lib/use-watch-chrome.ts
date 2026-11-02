import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

export const WATCH_CHROME_IDLE_MS = 2200;
export const watchChromeClass = (visible: boolean) =>
  `transition-opacity duration-200 motion-reduce:transition-none ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`;
export const watchChromeAttributes = (visible: boolean) => ({
  "data-watch-chrome": "", "aria-hidden": !visible, inert: !visible,
});

/** Fade viewing chrome, never the media or its gesture surface. */
export function useWatchChrome(itemKey: string, pinned = false, enabled = true, alwaysVisible = false) {
  const [visible, setVisible] = useState(true);
  const [keyboard, setKeyboard] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const reveal = useCallback(() => {
    clear();
    setVisible(true);
    if (enabled && !alwaysVisible && !pinned && !keyboard && !hovered)
      timer.current = setTimeout(() => setVisible(false), WATCH_CHROME_IDLE_MS);
  }, [clear, enabled, alwaysVisible, pinned, keyboard, hovered]);
  useEffect(() => {
    reveal();
    return clear;
  }, [itemKey, reveal, clear]);

  return {
    visible: alwaysVisible || visible, reveal,
    handlers: {
      // Bubble after the media gesture has captured whether this tap only reveals.
      onPointerDown: () => { setKeyboard(false); setHovered(false); reveal(); },
      onPointerMoveCapture: (event: PointerEvent<HTMLElement>) => {
        if (event.pointerType !== "mouse") return;
        setKeyboard(false);
        setHovered(event.target instanceof Element && !!event.target.closest("[data-watch-chrome]"));
        reveal();
      },
      onPointerLeave: () => setHovered(false),
      onKeyDownCapture: () => { setKeyboard(true); reveal(); },
    },
  };
}
