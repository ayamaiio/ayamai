import { usePageTitle } from "@/lib/page-title";
import { useAccessStatus } from "@/hooks/use-access-status";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useClerk } from "@clerk/react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Download, LogOut, ShieldAlert, Tags } from "lucide-react";
import {
  getGetAccessMeQueryKey, getGetSocialAccountQueryKey, getGetWatchSettingsQueryKey,
  useClearWatchHistory, useCreateAccessInvite, useGetSocialAccount,
  useRevokeAccessInvite, useRevokeAccessMember,
  useGetWatchSettings, useUpdateSocialAccount, useUpdateSocialProfile, useUpdateWatchSettings,
} from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Input } from "@workspace/ayamai-design-system/components/ui/input";
import { Label } from "@workspace/ayamai-design-system/components/ui/label";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";
import { AppNav } from "./app-nav";
import { FollowedCreators } from "./followed-creators";
import { AdultGateForm } from "./adult-gate";
import { errorText, refreshSocial } from "./social-lib";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const input = "mt-2 w-full rounded-md border border-border bg-background/25 px-4 py-3 text-sm text-foreground outline-none focus:border-primary";

function Card({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return <section className="rounded-lg border border-border bg-secondary p-5 sm:p-6">
    <p className="font-mono text-xs uppercase tracking-widest text-primary">{kicker}</p>
    <h2 className="mt-1 text-xl font-bold">{title}</h2>
    {children}
  </section>;
}

function Toggle({ on, label, hint, onClick, disabled, testId }: { on: boolean; label: string; hint: string; onClick: () => void; disabled?: boolean; testId: string }) {
  return <button type="button" role="switch" aria-checked={on} onClick={onClick} disabled={disabled} className="mt-4 flex w-full items-center justify-between gap-4 rounded-md border border-border bg-background/20 px-4 py-3 text-left disabled:opacity-50" data-testid={testId}>
    <span><span className="block text-sm font-semibold">{label}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{hint}</span></span>
    <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-primary" : "bg-secondary"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-foreground transition-transform ${on ? "translate-x-[22px]" : "translate-x-0.5"}`} /></span>
  </button>;
}

function makeInviteUrl(invitePath: string) {
  const path = invitePath.startsWith(basePath) ? invitePath : `${basePath}${invitePath.startsWith("/") ? "" : "/"}${invitePath}`;
  return `${window.location.origin}${path}`;
}

function AccessManagement() {
  const client = useQueryClient();
  const access = useAccessStatus();
  const createInvite = useCreateAccessInvite();
  const revokeInvite = useRevokeAccessInvite();
  const revokeMember = useRevokeAccessMember();
  const [email, setEmail] = useState("");
  const [createdLink, setCreatedLink] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  if (access.isLoading) return <section className="rounded-lg border border-border bg-secondary p-5 sm:p-6" aria-busy="true" data-testid="section-access-management-loading">
    <Skeleton className="h-5 w-40" /><Skeleton className="mt-4 h-20 w-full" />
  </section>;
  if (access.isError) return <section className="rounded-lg border border-border bg-secondary p-5 sm:p-6" data-testid="section-access-management-error">
    <p className="font-mono text-xs uppercase tracking-widest text-primary">Private access</p>
    <h2 className="mt-1 text-xl font-bold">Access management didn’t load</h2>
    <p className="mt-2 text-sm text-muted-foreground">Your settings are safe. Retry to check membership and invitations.</p>
    <Button variant="outline" className="mt-4" onClick={() => void access.refetch()} data-testid="button-retry-access-management">Try again</Button>
  </section>;
  if (access.data?.membership?.role !== "owner") return null;

  const snapshot = access.data;
  const pendingInvites = snapshot.invites.filter((invite) => invite.status === "pending");
  const expiredInvites = snapshot.invites.filter((invite) => invite.status === "expired");
  const invalidateAccess = () => client.invalidateQueries({ queryKey: getGetAccessMeQueryKey() });
  function submitInvite(event: FormEvent) {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized || createInvite.isPending || snapshot.inviteSlotsRemaining < 1) return;
    setCreatedLink("");
    setCopyMessage("");
    createInvite.mutate({ data: { email: normalized } }, {
      onSuccess: (result) => {
        setEmail("");
        setCreatedLink(makeInviteUrl(result.invitePath));
        void invalidateAccess();
      },
    });
  }
  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopyMessage("Invitation link copied. It will only be shown here once.");
    } catch {
      setCopyMessage("Copy was unavailable. Select and copy the link above.");
    }
  }
  function removeInvite(id: string, inviteEmail: string) {
    if (!window.confirm(`Revoke the pending invitation for ${inviteEmail}?`)) return;
    revokeInvite.mutate({ id }, { onSuccess: () => { setCreatedLink(""); void invalidateAccess(); } });
  }
  function removeMember(userId: string, memberEmail: string) {
    if (!window.confirm(`Remove ${memberEmail} from the private library?`)) return;
    revokeMember.mutate({ userId }, { onSuccess: () => void invalidateAccess() });
  }

  return <section className="rounded-lg border border-border bg-secondary p-5 sm:p-6" aria-labelledby="access-management-title" data-testid="section-access-management">
    <p className="font-mono text-xs uppercase tracking-widest text-primary">Owner controls</p>
    <h2 id="access-management-title" className="mt-1 text-xl font-bold">Private access</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">Invite people you trust. Each invitation is email-bound and expires. {snapshot.inviteSlotsRemaining} of 5 invitation slots remaining.</p>

    <form onSubmit={submitInvite} className="mt-5 grid gap-3 sm:grid-cols-2" data-testid="form-create-invitation">
      <div>
        <Label htmlFor="invite-email">Invite by email</Label>
        <Input id="invite-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2" placeholder="name@example.com" data-testid="input-invite-email" />
      </div>
      <Button type="submit" className="self-end" disabled={createInvite.isPending || snapshot.inviteSlotsRemaining < 1} data-testid="button-create-invitation">{createInvite.isPending ? "Creating…" : "Create invitation"}</Button>
    </form>
    {snapshot.inviteSlotsRemaining < 1 && <p className="mt-2 text-sm text-muted-foreground" data-testid="text-invite-slots-full">All invitation slots are in use. Revoke an invitation or member to free a slot.</p>}
    {createInvite.isError && <p className="mt-3 text-sm text-destructive" role="alert" data-testid="status-create-invitation-error">The invitation could not be created. Check the address and try again.</p>}
    {createdLink && <div className="mt-4 rounded-md border border-primary/30 bg-primary/10 p-4" data-testid="status-invitation-created">
      <p className="text-sm font-semibold">Invitation created</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Copy this one-time link now. It is shown only once and is not stored here after leaving the page.</p>
      <Label htmlFor="invite-link" className="mt-3 block">One-time invitation link</Label>
      <Input id="invite-link" readOnly value={createdLink} onFocus={(event) => event.currentTarget.select()} className="mt-2" data-testid="input-created-invitation-link" />
      <Button type="button" variant="outline" className="mt-3" onClick={() => void copyInviteLink()} data-testid="button-copy-invitation-link">Copy invitation link</Button>
      {copyMessage && <p className="mt-2 text-sm text-muted-foreground" role="status" data-testid="status-copy-invitation">{copyMessage}</p>}
    </div>}

    {(revokeInvite.isError || revokeMember.isError) && <p className="mt-3 text-sm text-destructive" role="alert" data-testid="status-revoke-access-error">That access change could not be completed. Refresh the list and try again.</p>}

    <div className="mt-6 space-y-6">
      <section aria-labelledby="active-members-title">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="active-members-title" className="font-semibold">Active members</h3>
          <span className="text-xs text-muted-foreground" data-testid="text-member-count">{snapshot.members.length} of 5</span>
        </div>
        {snapshot.members.length ? <ul className="mt-3 divide-y divide-border rounded-md border border-border" data-testid="list-active-members">
          {snapshot.members.map((member) => <li key={member.userId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-access-member-${member.userId}`}>
            <div className="min-w-0"><p className="break-all text-sm font-medium">{member.email}</p><p className="mt-1 text-xs text-muted-foreground">Joined {new Date(member.createdAt).toLocaleDateString()}</p></div>
            <Button type="button" variant="outline" size="sm" onClick={() => removeMember(member.userId, member.email)} disabled={revokeMember.isPending} data-testid={`button-revoke-member-${member.userId}`}>Remove access</Button>
          </li>)}
        </ul> : <p className="mt-2 rounded-md border border-border px-4 py-5 text-sm text-muted-foreground" data-testid="empty-access-members">No invited members have joined yet.</p>}
      </section>

      <section aria-labelledby="pending-invites-title">
        <div className="flex items-baseline justify-between gap-2"><h3 id="pending-invites-title" className="font-semibold">Pending invitations</h3><span className="text-xs text-muted-foreground">{pendingInvites.length}</span></div>
        {pendingInvites.length ? <ul className="mt-3 divide-y divide-border rounded-md border border-border" data-testid="list-pending-invitations">
          {pendingInvites.map((invite) => <li key={invite.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-pending-invite-${invite.id}`}>
            <div className="min-w-0"><p className="break-all text-sm font-medium">{invite.email}</p><p className="mt-1 text-xs text-muted-foreground">Expires {new Date(invite.expiresAt).toLocaleDateString()}</p></div>
            <Button type="button" variant="outline" size="sm" onClick={() => removeInvite(invite.id, invite.email)} disabled={revokeInvite.isPending} data-testid={`button-revoke-invite-${invite.id}`}>Revoke invitation</Button>
          </li>)}
        </ul> : <p className="mt-2 rounded-md border border-border px-4 py-5 text-sm text-muted-foreground" data-testid="empty-pending-invitations">No pending invitations.</p>}
      </section>

      <section aria-labelledby="expired-invites-title">
        <div className="flex items-baseline justify-between gap-2"><h3 id="expired-invites-title" className="font-semibold">Expired invitations</h3><span className="text-xs text-muted-foreground">{expiredInvites.length}</span></div>
        {expiredInvites.length ? <ul className="mt-3 divide-y divide-border rounded-md border border-border" data-testid="list-expired-invitations">
          {expiredInvites.map((invite) => <li key={invite.id} className="p-3" data-testid={`row-expired-invite-${invite.id}`}>
            <p className="break-all text-sm font-medium">{invite.email}</p><p className="mt-1 text-xs text-muted-foreground">Expired {new Date(invite.expiresAt).toLocaleDateString()}</p>
          </li>)}
        </ul> : <p className="mt-2 rounded-md border border-border px-4 py-5 text-sm text-muted-foreground" data-testid="empty-expired-invitations">No expired invitations.</p>}
      </section>
    </div>
  </section>;
}

export function AccountPage() {
  usePageTitle("Account");
  const client = useQueryClient();
  const { signOut } = useClerk();
  const account = useGetSocialAccount({ query: { queryKey: getGetSocialAccountQueryKey() } });
  const settings = useGetWatchSettings({ query: { queryKey: getGetWatchSettingsQueryKey() } });
  const updateAccount = useUpdateSocialAccount();
  const updateProfile = useUpdateSocialProfile();
  const updateSettings = useUpdateWatchSettings();
  const clearHistory = useClearWatchHistory();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [message, setMessage] = useState("");
  const init = useRef(false);
  const profile = account.data?.profile ?? null;
  useEffect(() => {
    if (!account.data || init.current) return;
    init.current = true;
    if (account.data.profile) { setHandle(account.data.profile.handle); setDisplayName(account.data.profile.displayName); setBio(account.data.profile.bio); }
  }, [account.data]);

  const handleOk = /^[a-z0-9_]{3,24}$/.test(handle);
  function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!handleOk || !displayName.trim()) return;
    updateProfile.mutate({ data: { handle, displayName: displayName.trim(), bio: bio.trim() } }, {
      onSuccess: async (p) => {
        client.setQueryData(getGetSocialAccountQueryKey(), (old: typeof account.data) => old ? { ...old, profile: p } : old);
        setMessage("Profile saved.");
        await refreshSocial(client);
      },
    });
  }
  const toggleCollab = () => updateAccount.mutate({ data: { collaborativeConsent: !account.data?.collaborativeConsent } }, {
    onSuccess: (a) => { client.setQueryData(getGetSocialAccountQueryKey(), a); void client.invalidateQueries({ queryKey: ["/api/social/feed"] }); },
  });
  const toggleBehavior = () => updateSettings.mutate({ data: { behaviorEnabled: !(settings.data?.behaviorEnabled ?? false) } }, {
    onSuccess: (s) => { client.setQueryData(getGetWatchSettingsQueryKey(), s); setMessage("Saved. Applies to new feed cycles."); },
  });
  const clear = () => {
    if (!window.confirm("Clear watch time, completion, replay and skip history? Likes, dislikes and saves stay.")) return;
    clearHistory.mutate(undefined, { onSuccess: () => setMessage("Viewing history cleared. Likes and saves were kept.") });
  };

  return <div className="library-shell min-h-[100dvh] pb-16 text-foreground">
    <AppNav />
    <main className="mx-auto max-w-2xl space-y-4 px-3 pt-[84px] sm:px-6">
      <div><p className="font-mono text-xs uppercase tracking-widest text-primary">You, on your terms</p><h1 className="mt-1 text-4xl sm:text-5xl">Account</h1><Link href="/invitations" className="mt-4 inline-block rounded-md border border-border px-4 py-2 text-sm text-primary">Invite someone you know</Link></div>
      {message && <p className="rounded-md bg-primary/10 px-4 py-3 text-sm text-warning" role="status">{message}</p>}
      {account.isLoading ? <div className="space-y-3">{[0, 1, 2].map((n) => <div key={n} className="h-36 animate-pulse rounded-lg bg-secondary" />)}</div>
        : account.isError ? <div className="rounded-lg border border-border p-8 text-center"><p>Account didn’t load.</p><button onClick={() => void account.refetch()} className="mt-3 font-semibold text-accent-foreground">Try again</button></div>
        : <>
          {!account.data?.adultAccepted && <Card kicker="Required for sharing" title="Adult confirmation"><p className="mt-2 text-sm text-muted-foreground">Needed before you can watch the shared feed or post publicly. Your private Library works without it.</p><div className="mt-3"><AdultGateForm /></div></Card>}

          <AccessManagement />

          <Card kicker="Optional pseudonym" title={profile ? `@${profile.handle}` : "Create a profile"}>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Only posts you choose to attribute appear here. Anonymous posts are never linked to it. Never uses your sign-in name or email.</p>
            <form onSubmit={saveProfile} className="mt-3">
              <label className="block text-xs font-bold uppercase tracking-[.1em] text-muted-foreground" htmlFor="p-handle">Handle</label>
              <div className="relative"><span className="pointer-events-none absolute left-4 top-1/2 mt-1 -translate-y-1/2 text-sm text-muted-foreground">@</span><input id="p-handle" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} maxLength={24} className={`${input} pl-8`} data-testid="input-profile-handle" /></div>
              {handle && !handleOk && <p className="mt-1 text-xs text-destructive">3–24 lowercase letters, numbers, or underscores.</p>}
              <label className="mt-3 block text-xs font-bold uppercase tracking-[.1em] text-muted-foreground" htmlFor="p-name">Display name</label>
              <input id="p-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} className={input} data-testid="input-profile-name" />
              <label className="mt-3 block text-xs font-bold uppercase tracking-[.1em] text-muted-foreground" htmlFor="p-bio">Bio</label>
              <textarea id="p-bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} rows={3} className={`${input} resize-none`} data-testid="input-profile-bio" />
              {updateProfile.isError && <p className="mt-2 text-xs text-destructive" role="alert">{errorText(updateProfile.error, "Couldn’t save. That handle may be taken.")}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button disabled={!handleOk || !displayName.trim() || updateProfile.isPending} className="rounded-md bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:opacity-40" data-testid="button-save-profile">{updateProfile.isPending ? "Saving…" : profile ? "Save profile" : "Create profile"}</button>
                {profile && <Link href={`/profile/${profile.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-foreground/80 hover:text-foreground" data-testid="link-view-profile">View public profile <ArrowRight size={14} /></Link>}
              </div>
            </form>
          </Card>

          <FollowedCreators />

          <Card kicker="Behavior & privacy" title="How your feed learns">
            <Toggle on={settings.data?.behaviorEnabled ?? false} label="Use my viewing activity" hint="Watch time, completions and skips tune your For You. Off: likes and saves still count." onClick={toggleBehavior} disabled={settings.isLoading || updateSettings.isPending} testId="switch-watch-behavior" />
            <Toggle on={account.data?.collaborativeConsent ?? false} label="Help other adults’ recommendations" hint="Share anonymous, aggregated signals across accounts. Off by default." onClick={toggleCollab} disabled={updateAccount.isPending} testId="switch-collab-consent" />
            <button onClick={clear} disabled={clearHistory.isPending} className="mt-4 w-full rounded-md border border-border px-4 py-3 text-left text-sm font-semibold text-foreground/80 hover:bg-foreground/5 disabled:opacity-50" data-testid="button-clear-watch-history">{clearHistory.isPending ? "Clearing…" : "Clear viewing history"}</button>
            {(updateSettings.isError || updateAccount.isError || clearHistory.isError) && <p className="mt-2 text-xs text-destructive" role="alert">That setting couldn’t be saved. Try again.</p>}
          </Card>

          <Link href="/labels" className="flex items-center justify-between rounded-lg border border-border bg-secondary p-5" data-testid="link-private-labels"><span className="flex items-center gap-3"><Tags size={20} className="text-primary" /><span><span className="block font-bold">Private labels</span><span className="text-xs text-muted-foreground">Label queue and JSONL exports, only for you</span></span></span><ArrowRight size={18} /></Link>
          <Link href="/capture" className="flex items-center justify-between rounded-lg border border-border bg-secondary p-5" data-testid="link-browser-capture"><span className="flex items-center gap-3"><Download size={20} className="text-primary" /><span><span className="block font-bold">Browser capture</span><span className="text-xs text-muted-foreground">Pair the extension and save selected media privately</span></span></span><ArrowRight size={18} /></Link>

          {account.data?.isModerator && <Link href="/moderation" className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/[.07] p-5" data-testid="link-moderation"><span className="flex items-center gap-3"><ShieldAlert size={20} className="text-primary" /><span><span className="block font-bold">Moderation queue</span><span className="text-xs text-muted-foreground">Review reported posts</span></span></span><ArrowRight size={18} /></Link>}

          <button onClick={() => signOut({ redirectUrl: basePath || "/" })} className="flex w-full items-center justify-center gap-2 rounded-lg border border-border py-4 text-sm font-semibold text-foreground/80 hover:bg-foreground/5" data-testid="button-account-sign-out"><LogOut size={16} /> Sign out</button>
        </>}
      <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2 pt-4 text-xs text-muted-foreground" aria-label="Legal">
        <Link href="/privacy" className="hover:text-foreground" data-testid="link-account-privacy">Privacy Policy</Link>
        <Link href="/terms" className="hover:text-foreground" data-testid="link-account-terms">Terms of Service</Link>
        <a href="mailto:privacy@ayamai.io" className="hover:text-foreground" data-testid="link-account-contact">Contact</a>
      </nav>
    </main>
  </div>;
}
