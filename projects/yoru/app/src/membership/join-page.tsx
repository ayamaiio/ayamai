import { useEffect, useState } from "react";
import { SignUp, useClerk, useUser } from "@clerk/react";
import { Link, Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useRedeemMembership } from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Input } from "@workspace/ayamai-design-system/components/ui/input";
import { Brand } from "@/social/app-nav";
import { usePageTitle } from "@/lib/page-title";
import { isLargeScreen } from "@/lib/use-large-screen";
import { errorText } from "@/social/social-lib";
import { useMembership } from "./membership-gate";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
export function readInvitationFragment(fragment: string) {
  return new URLSearchParams(fragment.replace(/^#/, "")).get("invite") ?? "";
}
export function JoinPage() {
  usePageTitle("By invitation");
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [token, setToken] = useState(() => readInvitationFragment(window.location.hash));
  const [acknowledged, setAcknowledged] = useState(false);
  const membership = useMembership();
  const redeem = useRedeemMembership();
  const client = useQueryClient();
  // Bearer codes stay out of query strings, referrers, persistent storage and history.
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return () => { /* State, including the token, is discarded on unmount. */ };
  }, []);
  if (user && membership.data?.member) return <Redirect to={isLargeScreen() ? "/videos" : "/feed"} />;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await redeem.mutateAsync({ data: { token: token.trim(), relationshipAcknowledged: true } }).then(async () => {
      setToken("");
      client.setQueryData(["/api/membership", user?.id], { member: true, isOperator: false });
      await client.invalidateQueries({ queryKey: ["/api/membership"] });
    }).catch(() => {});
  };
  return <div className="app-shell min-h-[100dvh] px-4 pb-12 pt-24 text-foreground">
    <header className="absolute inset-x-0 top-0 flex h-14 items-center justify-between border-b border-border px-4 md:px-8">
      <Brand /><Button asChild variant="ghost"><Link href="/sign-in">Sign in</Link></Button>
    </header>
    <main className="mx-auto w-full max-w-lg space-y-6">
      <div><p className="font-mono text-xs uppercase tracking-widest text-primary">A smaller circle · 18+</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">Someone thought of you.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">ayamai is a collection shared by invitation. Sign in or create a sign-in identity, then accept your invitation to enter. An identity alone does not grant access.</p></div>
      {!isLoaded ? <p role="status">Loading sign-in…</p> : !user ? <>
        <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">Keep your invitation handy. If an external sign-in provider reloads this page, reopen the original invitation link or paste the code after signing in. We don’t store invitation codes in your browser.</p>
        <SignUp routing="path" path={`${basePath}/join`} signInUrl={`${basePath}/sign-in`} forceRedirectUrl={`${basePath}/join`} />
      </> : membership.isLoading ? <p role="status">Checking your membership…</p> : membership.isError ? <div role="alert"><p>Couldn’t check membership. No changes were made.</p><Button className="mt-3" onClick={() => void membership.refetch()}>Try again</Button></div> : <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-card p-5">
        <label htmlFor="invitation-code" className="block text-sm font-medium">Invitation code</label>
        <Input id="invitation-code" autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} maxLength={43} aria-describedby="invitation-help" />
        <p id="invitation-help" className="text-xs leading-5 text-muted-foreground">A single-use code shared directly by a member. Unused invitations don’t expire but can be revoked.</p>
        <label className="flex gap-3 text-sm leading-6"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" /><span>This invitation was shared with me directly. I understand ayamai keeps an internal record of who invited whom, accessible only to the operator and authorized moderators—not other members or public profiles.</span></label>
        {redeem.isError && <p role="alert" className="text-sm text-destructive">{errorText(redeem.error, "Couldn’t accept that invitation. Please try again.")}</p>}
        <Button type="submit" className="w-full" disabled={!acknowledged || !/^[A-Za-z0-9_-]{43}$/.test(token.trim()) || redeem.isPending}>{redeem.isPending ? "Accepting…" : "Accept invitation"}</Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut({ redirectUrl: `${basePath}/join` })}>Use another sign-in</Button>
      </form>}
      <p className="text-sm text-muted-foreground">No invitation? <a className="text-primary underline" href="mailto:contact@ayamai.io?subject=ayamai%20access%20request">Request access</a>. Requests are reviewed, not guaranteed.</p>
      <p className="text-xs leading-5 text-muted-foreground">Anonymous to other members by default, not to the operator. Adult and content-policy checks still apply after joining. <Link href="/privacy" className="underline">Privacy</Link> · <Link href="/terms" className="underline">Terms</Link></p>
    </main>
  </div>;
}
