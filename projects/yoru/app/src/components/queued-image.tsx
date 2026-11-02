import { useEffect, useRef, useState } from "react";
import { ImageOff, RotateCw } from "lucide-react";
import { cn } from "@workspace/ayamai-design-system/lib/utils";

/**
 * Media authorization is budgeted server-side: a viewer gets two concurrent
 * grants. Rather than fight that boundary, images queue for a slot.
 *
 * Failures are expected (budget, deletion, a broken original), so an image may
 * be retried a couple of times before it is declared dead, and a dead image
 * still occupies its place in the layout instead of collapsing the page.
 */
// The server refills 8 authorizations a second with a burst of 24. Firing a
// grid faster than that earns 429s, so requests are paced, not just capped.
const MAX_CONCURRENT = 6;
const MIN_GAP_MS = 25;           // local budget is 64/s; edge traffic keeps its own limits
const waiting: (() => void)[] = [];
let active = 0;
let lastGrant = 0;

function acquire(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = () => {
      const wait = Math.max(0, lastGrant + MIN_GAP_MS - Date.now());
      if (wait > 0) { setTimeout(grant, wait); return; }
      lastGrant = Date.now();
      active += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        active -= 1;
        const next = waiting.shift();
        if (next) next();
      });
    };
    if (active < MAX_CONCURRENT) grant();
    else waiting.push(grant);
  });
}

type Props = {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  eager?: boolean;
  fit?: "cover" | "natural";
  retries?: number;
  label?: string;
};

type Status = "waiting" | "loaded" | "failed";

export function QueuedImage({ src, alt = "", className, eager = false, fit = "cover", retries = 3, label }: Props) {
  const release = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<Status>("waiting");
  const [attempt, setAttempt] = useState(0);
  const [slot, setSlot] = useState(false);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    setSlot(false);
    const timer = setTimeout(() => {
      acquire().then((grant) => {
        if (cancelled) { grant(); return; }
        release.current = grant;
        setSlot(true);
      });
      // Development double-mounts abort the first request; a retry at a few
      // hundred ms lands on a clean slot. Back off: 250, 500, 1000ms.
    }, attempt === 0 ? 0 : 400 * 2 ** (attempt - 1));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      release.current?.();
      release.current = null;
    };
  }, [src, attempt]);

  const settle = (ok: boolean) => () => {
    // The slot only gates the request. A loaded image keeps its node, so the
    // decoded bitmap is never thrown away by releasing the slot.
    release.current?.();
    release.current = null;
    if (ok) { setStatus("loaded"); return; }
    setSlot(false);
    if (attempt < retries) { setStatus("waiting"); setAttempt((a) => a + 1); return; }
    setStatus("failed");
  };

  const retry = () => { setStatus("waiting"); setAttempt(0); };

  if (status === "failed") {
    return (
      <div className={cn("grid place-items-center gap-2 border border-border bg-secondary px-3 py-6 text-center", className)} role="img" aria-label={alt || "image unavailable"}>
        <ImageOff size={18} className="text-muted-foreground" aria-hidden="true" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label ?? "page unavailable"}</p>
        <button
          type="button"
          onClick={retry}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCw size={12} /> retry
        </button>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden bg-secondary", className)}>
      {(slot || status === "loaded") && src
        ? <img
            src={src}
            alt={alt}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            onLoad={settle(true)}
            onError={settle(false)}
            className={fit === "cover" ? "h-full w-full object-cover" : "h-auto w-full"}
          />
        : <div className={cn("w-full animate-pulse bg-secondary", fit === "cover" ? "h-full" : "h-64")} aria-hidden="true" />}
    </div>
  );
}
