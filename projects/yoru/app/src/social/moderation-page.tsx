import { usePageTitle } from "@/lib/page-title";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ShieldAlert, Trash2 } from "lucide-react";
import { getGetMediaViewUrlQueryKey, getGetSocialModerationQueryKey, useGetMediaViewUrl, useGetSocialModeration, useModerateSocialReport } from "@workspace/api-client-react";
import type { ModerationQueueReportsItem } from "@workspace/api-client-react";
import { AppNav } from "./app-nav";
import { errorStatus, errorText, forgetPost, refreshSocial, timeAgo } from "./social-lib";

function ReportRow({ report }: { report: ModerationQueueReportsItem }) {
  const client = useQueryClient();
  const [reveal, setReveal] = useState(false);
  const [asImage, setAsImage] = useState(false);
  const view = useGetMediaViewUrl(report.mediaId, { query: { enabled: reveal, queryKey: getGetMediaViewUrlQueryKey(report.mediaId), staleTime: 30_000, retry: false } });
  const moderate = useModerateSocialReport();
  const decide = (action: "remove" | "dismiss") => {
    if (action === "remove" && !window.confirm("Remove this post from public view?")) return;
    moderate.mutate({ id: report.id, data: { action } }, {
      onSuccess: async () => {
        if (action === "remove") forgetPost(client, report.mediaId);
        await Promise.all([client.invalidateQueries({ queryKey: getGetSocialModerationQueryKey() }), refreshSocial(client, report.mediaId)]);
      },
    });
  };
  const url = view.data?.url;
  return <li className="overflow-hidden rounded-lg border border-border bg-secondary" data-testid={`report-${report.id}`}>
    <div className="grid gap-4 p-4 sm:grid-cols-[160px_1fr]">
      <button onClick={() => setReveal(true)} className="relative aspect-[4/5] w-full overflow-hidden rounded-md bg-background/40 text-xs font-semibold text-muted-foreground sm:w-40" aria-label="Reveal reported media" data-testid={`button-reveal-${report.id}`}>
        {!reveal ? "Tap to reveal" : view.isLoading ? <span className="absolute inset-0 animate-pulse bg-secondary" /> : view.isError ? "Media unavailable" : url ? (asImage ? <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <video src={url} className="absolute inset-0 h-full w-full object-cover" muted playsInline autoPlay loop controls={false} onError={() => setAsImage(true)} />) : null}
      </button>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">Reported {timeAgo(report.createdAt)}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{report.reason}</p>
        {moderate.isError && <p className="mt-2 text-xs text-destructive" role="alert">{errorText(moderate.error, "That decision didn’t save.")}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={() => decide("remove")} disabled={moderate.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2.5 text-xs font-bold text-foreground disabled:opacity-40" data-testid={`button-remove-${report.id}`}><Trash2 size={14} /> Remove post</button>
          <button onClick={() => decide("dismiss")} disabled={moderate.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2.5 text-xs font-semibold text-foreground/80 disabled:opacity-40" data-testid={`button-dismiss-${report.id}`}><Check size={14} /> Dismiss</button>
        </div>
      </div>
    </div>
  </li>;
}

export function ModerationPage() {
  usePageTitle("Moderation");
  const queue = useGetSocialModeration({ query: { queryKey: getGetSocialModerationQueryKey(), refetchInterval: 30_000, retry: (n, err) => errorStatus(err) !== 403 && n < 2 } });
  const reports = queue.data?.reports ?? [];
  const forbidden = queue.isError && (errorStatus(queue.error) === 403 || errorStatus(queue.error) === 401);
  return <div className="library-shell min-h-[100dvh] pb-16 text-foreground">
    <AppNav />
    <main className="mx-auto max-w-3xl px-3 pt-[84px] sm:px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-primary">Safety</p>
      <h1 className="mt-1 text-4xl sm:text-5xl">Review queue</h1>
      {queue.isLoading ? <div className="mt-6 space-y-3">{[0, 1].map((n) => <div key={n} className="h-44 animate-pulse rounded-lg bg-secondary" />)}</div>
        : forbidden ? <div className="mt-10 rounded-lg border border-border p-10 text-center"><ShieldAlert className="mx-auto text-muted-foreground" /><p className="mt-3 font-semibold">Moderator access only.</p></div>
        : queue.isError ? <div className="mt-10 text-center"><p>Queue didn’t load.</p><button onClick={() => void queue.refetch()} className="mt-3 font-semibold text-accent-foreground">Try again</button></div>
        : reports.length === 0 ? <div className="mt-10 rounded-lg border border-dashed border-border p-12 text-center"><Check className="mx-auto text-success" /><p className="mt-3 font-semibold">Queue is clear.</p><p className="mt-1 text-sm text-muted-foreground">New reports appear here automatically.</p></div>
        : <ul className="mt-6 space-y-3">{reports.map((r) => <ReportRow key={r.id} report={r} />)}</ul>}
    </main>
  </div>;
}
