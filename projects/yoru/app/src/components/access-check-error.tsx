import { useEffect, useState } from "react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { accessErrorStatus } from "@/hooks/use-access-status";

function retrySeconds(error: unknown): number {
  if (error && typeof error === "object" && "headers" in error && error.headers instanceof Headers) {
    const seconds = Number(error.headers.get("Retry-After"));
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(86_400, Math.ceil(seconds));
  }
  return 60;
}

export function AccessCheckError({ error, retry }: { error: unknown; retry: () => unknown }) {
  const limited = accessErrorStatus(error) === 429;
  const conflict = accessErrorStatus(error) === 409;
  const [remaining, setRemaining] = useState(() => limited ? retrySeconds(error) : 0);
  useEffect(() => {
    setRemaining(limited ? retrySeconds(error) : 0);
    if (!limited) return;
    const interval = window.setInterval(() => setRemaining(value => Math.max(0, value - 1)), 1_000);
    return () => window.clearInterval(interval);
  }, [error, limited]);
  return <section className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center" data-testid="status-access-load-error">
    <h1 className="text-xl font-semibold">{limited ? "Access checks temporarily paused" : conflict ? "Owner setup needs attention" : "Access could not be checked"}</h1>
    <p className="mt-2 text-sm leading-6 text-muted-foreground" role="status">
      {limited ? "Too many access checks. This is not an invitation rejection. Wait before trying again."
        : conflict ? "The configured owner conflicts with an existing account. An operator must review owner recovery."
        : "The private library is unavailable until your membership can be confirmed."}
    </p>
    <Button variant="outline" className="mt-5" disabled={limited && remaining > 0} onClick={() => void retry()} data-testid="button-retry-access-check">
      {limited && remaining > 0 ? `Try again in ${remaining}s` : "Try again"}
    </Button>
  </section>;
}
