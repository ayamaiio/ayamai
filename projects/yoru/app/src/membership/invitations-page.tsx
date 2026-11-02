import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMembershipInvitations, useCreateMembershipInvitation, useRevokeMembershipInvitation, useGetMembershipReferrals } from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Input } from "@workspace/ayamai-design-system/components/ui/input";
import { AppNav } from "@/social/app-nav";
import { errorText } from "@/social/social-lib";
import { usePageTitle } from "@/lib/page-title";
import { useMembership } from "./membership-gate";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
export function InvitationsPage() {
  usePageTitle("Invitations");
  const client = useQueryClient();
  const status = useMembership();
  const list = useGetMembershipInvitations({ query: { staleTime: 0, refetchInterval: 30_000 } });
  const create = useCreateMembershipInvitation();
  const revoke = useRevokeMembershipInvitation();
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = () => client.invalidateQueries({ queryKey: ["/api/membership/invitations"] });
  const issue = async () => {
    setNotice("");
    try {
      const invitation = await create.mutateAsync();
      setLink(`${window.location.origin}${basePath}/join#invite=${invitation.token}`);
      await refresh();
    } catch { /* The mutation error is displayed below. */ }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Revoke this unused invitation? The link will no longer grant access.")) return;
    try { await revoke.mutateAsync({ id }); setLink(""); await refresh(); } catch { /* Visible mutation error below. */ }
  };
  return <div className="app-shell min-h-[100dvh] pb-12 text-foreground"><AppNav />
    <main className="mx-auto max-w-3xl space-y-6 px-4 pt-24">
      <div><p className="font-mono text-xs uppercase tracking-widest text-primary">A smaller circle</p><h1 className="mt-2 text-3xl font-semibold">Invite someone you know.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Five successful referrals per member. Each unused invitation reserves one place until it is used or revoked. Invitations never expire. Please share privately, with an adult you know in real life.</p></div>
      <section className="space-y-4 rounded-lg border border-border bg-card p-5" aria-label="Your invitations">
        {list.isLoading ? <p role="status">Loading invitations…</p> : list.isError ? <div role="alert"><p>Couldn’t load your invitations.</p><Button className="mt-3" onClick={() => void list.refetch()}>Try again</Button></div> : <>
          <p className="text-sm">{list.data?.successful ?? 0} of 5 successful referrals · {list.data?.available ?? 0} places available</p>
          <p className="text-xs leading-5 text-muted-foreground">Adult confirmation is required before creating an invitation. If needed, finish it in <Link href="/account" className="text-primary underline">Account</Link>.</p>
          <Button onClick={() => void issue()} disabled={create.isPending || !list.data?.available}>{create.isPending ? "Creating…" : "Create invitation"}</Button>
          {link && <div className="space-y-3 rounded-md border border-primary/40 bg-accent p-4">
            <label htmlFor="new-invitation" className="text-sm font-medium">Copy this link now</label>
            <Input id="new-invitation" readOnly value={link} onFocus={(e) => e.target.select()} />
            <p className="text-xs leading-5 text-muted-foreground">For privacy, the code is shown only now. We can’t recover it later. Revoke it and create another if you lose it.</p>
            <Button variant="outline" onClick={() => {
              if (!navigator.clipboard) { setNotice("Copy unavailable. Select and copy the link above."); return; }
              void navigator.clipboard.writeText(link).then(() => setNotice("Invitation copied.")).catch(() => setNotice("Copy unavailable. Select and copy the link above."));
            }}>Copy link</Button>
            <Button variant="ghost" onClick={() => setLink("")}>Hide link</Button>
          </div>}
          {notice && <p role="status" className="text-sm">{notice}</p>}
          {list.data?.invitations.length ? <ul className="divide-y divide-border">
            {list.data.invitations.map((invitation) => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p className="text-sm capitalize">{invitation.status}</p><p className="text-xs text-muted-foreground">Created {new Date(invitation.createdAt).toLocaleDateString()}</p></div>
              {invitation.status === "unused" && <Button variant="outline" size="sm" disabled={revoke.isPending} onClick={() => void remove(invitation.id)}>Revoke</Button>}
            </li>)}
          </ul> : <p className="text-sm text-muted-foreground">No invitations yet.</p>}
        </>}
        {(create.isError || revoke.isError) && <p role="alert" className="text-sm text-destructive">{errorText(create.error ?? revoke.error, "Couldn’t update invitations. Try again.")}</p>}
      </section>
      <p className="text-xs leading-5 text-muted-foreground">You can see whether your invitation was used, not who used it or their activity. The operator retains the referral relationship internally. It never appears on public profiles.</p>
      {status.data?.isOperator && <OperatorRelationships />}
    </main>
  </div>;
}

function OperatorRelationships() {
  const [cursor, setCursor] = useState<string | undefined>();
  const rows = useGetMembershipReferrals(cursor ? { cursor } : undefined, { query: { staleTime: 0 } });
  return <section className="space-y-3 rounded-lg border border-border bg-card p-5">
    <h2 className="text-lg font-semibold">Internal referral records</h2>
    <p className="text-xs text-muted-foreground">Operator-only account relationships. Never copy these into public profiles or external analytics.</p>
    {rows.isLoading ? <p role="status">Loading…</p> : rows.isError ? <p role="alert">Couldn’t load relationships.</p> : <>
      <ul className="space-y-3">{rows.data?.relationships.map((r) => <li key={r.memberId} className="rounded-md bg-secondary p-3 text-xs">
        <p className="break-all"><strong>Inviter:</strong> {r.inviterId}</p><p className="mt-1 break-all"><strong>Joined:</strong> {r.memberId}</p><p className="mt-1 text-muted-foreground">{new Date(r.joinedAt).toLocaleDateString()}</p>
      </li>)}</ul>
      {!rows.data?.relationships.length && <p className="text-sm text-muted-foreground">No referred members yet.</p>}
      <div className="flex gap-2">{cursor && <Button variant="outline" onClick={() => setCursor(undefined)}>First page</Button>}{rows.data?.nextCursor && <Button variant="outline" onClick={() => setCursor(rows.data!.nextCursor!)}>Next page</Button>}</div>
    </>}
  </section>;
}
