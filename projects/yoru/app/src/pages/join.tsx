import { useEffect, useRef, useState } from "react";
import { useClerk, useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import {
  getGetAccessMeQueryKey,
  useAcceptAccessInvite,
  useValidateAccessInvite,
} from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ayamai-design-system/components/ui/card";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";
import { Brand } from "@/social/app-nav";
import { usePageTitle } from "@/lib/page-title";
import { useAccessStatus } from "@/hooks/use-access-status";
import { AccessCheckError } from "@/components/access-check-error";
import { isLargeScreen } from "@/lib/use-large-screen";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const TOKEN_KEY = "ayanami.pending-access-invite";

function readAndRemoveFragmentToken() {
  const fragment = window.location.hash.slice(1);
  const params = new URLSearchParams(fragment);
  const token = params.get("token") || (fragment && !fragment.includes("=") ? fragment : null);
  if (token) {
    try { window.sessionStorage.setItem(TOKEN_KEY, token); } catch { /* session storage may be unavailable */ }
  }
  if (fragment) {
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }
  try { return window.sessionStorage.getItem(TOKEN_KEY); } catch { return token; }
}

export function JoinPage() {
  usePageTitle("Accept invitation");
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const access = useAccessStatus();
  const [token, setToken] = useState<string | null>(null);
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const acceptedRef = useRef(false);
  const validation = useValidateAccessInvite();
  const accept = useAcceptAccessInvite();
  const validateMutation = useRef(validation.mutate);
  const acceptMutation = useRef(accept.mutate);
  validateMutation.current = validation.mutate;
  acceptMutation.current = accept.mutate;
  const intendedEmail = validation.data?.email ?? null;
  const emailMatches = !intendedEmail || Boolean(user?.emailAddresses.some((item) =>
    item.emailAddress.toLowerCase() === intendedEmail.toLowerCase() && item.verification.status === "verified"
  ));
  const wrongEmail = Boolean(isSignedIn && validation.data?.valid && !emailMatches);

  useEffect(() => {
    setToken(readAndRemoveFragmentToken());
    setTokenLoaded(true);
  }, []);

  useEffect(() => {
    if (token) validateMutation.current({ data: { token } });
    // Validate once for the token loaded from the URL or session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!isSignedIn || !access.isSuccess || access.data?.membership ||
        !token || !validation.data?.valid || !emailMatches || acceptedRef.current) return;
    acceptedRef.current = true;
    acceptMutation.current({ data: { token } }, {
      onSuccess: (snapshot) => {
        client.setQueryData(getGetAccessMeQueryKey(), snapshot);
        try { window.sessionStorage.removeItem(TOKEN_KEY); } catch { /* session storage may be unavailable */ }
      },
      onError: () => { acceptedRef.current = false; },
    });
  }, [access.data?.membership, access.isSuccess, client, emailMatches, isSignedIn, token, validation.data?.valid]);
  useEffect(() => {
    if (!isSignedIn || !access.data?.membership) return;
    try { window.sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage may be unavailable */ }
    navigate(isLargeScreen() ? "/videos" : "/feed", { replace: true });
  }, [access.data?.membership, isSignedIn, navigate]);
  const signInPath = `${basePath}/sign-in?redirect_url=${encodeURIComponent(`${basePath}/join`)}`;
  const signUpPath = `${basePath}/sign-up?redirect_url=${encodeURIComponent(`${basePath}/join`)}`;
  const continueToApp = () => navigate("/feed");

  if (isSignedIn && access.isError) return <main className="grid min-h-[100dvh] place-items-center bg-background px-4 py-10 text-foreground">
    <AccessCheckError error={access.error} retry={() => access.refetch()} />
  </main>;
  if (isSignedIn && (access.isLoading || access.data?.membership)) return <main className="grid min-h-[100dvh] place-items-center bg-background" aria-busy="true">
    <span className="sr-only">Checking library access</span><Skeleton className="h-8 w-8 rounded-full" />
  </main>;

  return <main className="grid min-h-[100dvh] place-items-center bg-background px-4 py-10 text-foreground">
    <div className="w-full max-w-lg">
      <div className="mb-6 flex justify-center"><Brand /></div>
      <Card className="border-border bg-card">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-md bg-accent text-accent-foreground"><ShieldCheck size={22} aria-hidden="true" /></div>
          <CardTitle className="text-2xl">Join the private library</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">Invitations are personal, expire, and are tied to one verified email address.</p>
        </CardHeader>
        <CardContent>
          {!isLoaded || !tokenLoaded || (Boolean(token) && validation.isPending) ? <div className="space-y-3" aria-busy="true" data-testid="status-join-loading">
            <Skeleton className="h-5 w-3/4" /><Skeleton className="h-10 w-full" />
          </div> : !token ? <div className="rounded-md border border-border bg-secondary p-4" data-testid="status-invite-missing">
            <h2 className="font-semibold">Invitation link not found</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Open the full invitation link you received. If it is missing or expired, ask the library owner to send a new one.</p>
            <Button asChild variant="outline" className="mt-4" data-testid="link-join-sign-in-missing"><Link href={signInPath}>Sign in</Link></Button>
          </div> : validation.isError || !validation.data?.valid ? <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4" role="alert" data-testid="status-invite-invalid">
            <h2 className="font-semibold">This invitation is unavailable</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">It may have expired, been revoked, or already been used. Ask the library owner for a new invitation.</p>
            <Button variant="outline" className="mt-4" onClick={() => { validation.reset(); validateMutation.current({ data: { token } }); }} data-testid="button-retry-invite-validation">Check invitation again</Button>
          </div> : accept.isSuccess ? <div className="rounded-md border border-primary/30 bg-primary/10 p-4" role="status" data-testid="status-invite-accepted">
            <div className="flex items-center gap-2 font-semibold"><Check size={18} aria-hidden="true" /> Invitation accepted</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Your account now has access to the shared library.</p>
            <Button className="mt-4 w-full" onClick={continueToApp} data-testid="button-continue-library">Continue to the library <ArrowRight size={16} /></Button>
          </div> : wrongEmail ? <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4" role="alert" data-testid="status-invite-email-mismatch">
            <h2 className="font-semibold">Use the invited email address</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">This invitation is for <span className="font-medium text-foreground">{intendedEmail}</span>. Sign out and sign in with that address after verifying it.</p>
            <Button variant="outline" className="mt-4" onClick={() => signOut({ redirectUrl: `${basePath}/join` })} data-testid="button-sign-out-wrong-email">Sign out</Button>
          </div> : accept.isError ? <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4" role="alert" data-testid="status-accept-error">
            <h2 className="font-semibold">Could not accept this invitation</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Check that you are signed in with the invited, verified email address, then try again.</p>
            <Button className="mt-4" onClick={() => { acceptedRef.current = false; acceptMutation.current({ data: { token } }); }} data-testid="button-retry-accept">Try again</Button>
          </div> : isSignedIn ? <div className="space-y-3" data-testid="status-invite-ready">
            <p className="text-sm leading-6 text-muted-foreground">Invitation for <span className="font-medium text-foreground">{intendedEmail}</span>. Accepting uses the verified email on your account.</p>
            {accept.isPending && <p className="text-sm text-muted-foreground" role="status">Accepting invitation…</p>}
          </div> : <div className="space-y-4" data-testid="status-invite-validated">
            <p className="text-sm leading-6 text-muted-foreground">This invitation is for <span className="font-medium text-foreground">{intendedEmail}</span>. Sign in or create an account with that email to continue.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button asChild data-testid="link-join-sign-in"><Link href={signInPath}>Sign in</Link></Button>
              <Button asChild variant="outline" data-testid="link-join-sign-up"><Link href={signUpPath}>Create account</Link></Button>
            </div>
          </div>}
        </CardContent>
      </Card>
      <p className="mt-4 text-center text-xs text-muted-foreground" data-testid="text-invitation-privacy">
        Access is managed by the library owner. Invitations are not public sign-up links.
      </p>
    </div>
  </main>;
}
