import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { getGetSocialAccountQueryKey, useGetSocialAccount, useUpdateSocialAccount } from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";
import { errorText } from "./social-lib";
import { Brand } from "./app-nav";
import { usePageTitle } from "@/lib/page-title";

/** Age + policy acknowledgement form. Collaborative consent is opt-in and defaults off. */
export function AdultGateForm({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const client = useQueryClient();
  const update = useUpdateSocialAccount();
  const [adult, setAdult] = useState(false);
  const [policy, setPolicy] = useState(false);
  const [collab, setCollab] = useState(false);
  const submit = () => update.mutate({ data: { adultConfirmed: true, policyAccepted: true, collaborativeConsent: collab } }, {
    onSuccess: (account) => { client.setQueryData(getGetSocialAccountQueryKey(), account); void client.invalidateQueries({ queryKey: ["/api/social/feed"] }); onDone?.(); },
  });
  const box = "mt-0.5 h-4 w-4 shrink-0 accent-primary";
  return <div className={compact ? "" : "space-y-1"} data-testid="form-adult-gate">
    <label className="flex gap-3 rounded-md px-1 py-2 text-sm leading-5 text-foreground/80"><input type="checkbox" className={box} checked={adult} onChange={(e) => setAdult(e.target.checked)} data-testid="checkbox-adult" />I am 18 or older and it is legal for me to view adult media where I am.</label>
    <label className="flex gap-3 rounded-md px-1 py-2 text-sm leading-5 text-foreground/80"><input type="checkbox" className={box} checked={policy} onChange={(e) => setPolicy(e.target.checked)} data-testid="checkbox-policy" />I accept the policy: every person or character depicted — including in drawings, illustrations and animation — must be an adult. No illegal, non-consensual, exploitative or stolen content. I only post publicly what I have the rights to share, and anything that breaks this is removed.</label>
    <label className="flex gap-3 rounded-md px-1 py-2 text-sm leading-5 text-muted-foreground"><input type="checkbox" className={box} checked={collab} onChange={(e) => setCollab(e.target.checked)} data-testid="checkbox-collab" /><span>Optional: let my anonymous likes and viewing patterns help recommendations for other adults. Off unless you choose it.</span></label>
    {update.isError && <p className="text-xs text-destructive" role="alert">{errorText(update.error, "Couldn’t save. Try again.")}</p>}
    <Button type="button" onClick={submit} disabled={!adult || !policy || update.isPending} className="mt-2 w-full" data-testid="button-accept-gate">{update.isPending ? "Saving…" : "Confirm and continue"}</Button>
  </div>;
}

export function AdultGate({ children }: { children: ReactNode }) {
  const account = useGetSocialAccount({ query: { queryKey: getGetSocialAccountQueryKey(), staleTime: 60_000 } });
  if (account.isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-background"><Skeleton className="h-8 w-40" /></div>;
  if (account.isError) return <div className="grid min-h-[100dvh] place-items-center bg-background px-6 text-center text-foreground"><div><p className="text-xl font-semibold">Couldn’t check your account.</p><Button onClick={() => void account.refetch()} className="mt-5" data-testid="button-retry-account">Try again</Button><Link href="/library" className="mt-3 block text-sm text-foreground/80 underline">Open your Library</Link></div></div>;
  if (account.data?.adultAccepted) return <>{children}</>;
  return <GateScreen />;
}

function GateScreen() {
  usePageTitle("Confirm age");
  return <div className="gate-shell grid min-h-[100dvh] place-items-center px-4 py-24 text-foreground">
    <div className="absolute left-4 top-4 md:left-8"><Brand /></div>
    <div className="fade-up w-full max-w-lg">
      <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-primary"><ShieldCheck size={14} aria-hidden="true" /> 18+ · shared collection</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">A shared collection for adults.</h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">Browse and contribute to a curated shared collection. You’re anonymous by default; choose a pseudonym only if you want one, and keep any upload unlisted whenever you like.</p>
      <div className="mt-7 rounded-lg border border-border bg-secondary p-4 sm:p-5"><AdultGateForm /></div>
      <Link href="/library" className="mt-5 inline-block text-sm font-semibold text-foreground/80 underline-offset-4 hover:text-foreground hover:underline" data-testid="link-gate-library">Skip — open my Library</Link>
    </div>
  </div>;
}
