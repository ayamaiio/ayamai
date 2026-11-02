import { useEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, Cloud, Link2, RefreshCw, ShieldCheck, X } from "lucide-react";
import {
  getListImportJobsQueryKey,
  useActOnImportJob,
  useListImportJobs,
  usePreviewImportLink,
  useStartImportJob,
} from "@workspace/api-client-react";
import type { ImportFile, ImportJob } from "@workspace/api-client-react";
import { useGetSocialAccount, getGetSocialAccountQueryKey } from "@workspace/api-client-react";
import { PostingFields } from "@/social/posting-fields";
import { defaultDraft, postingBlocker, toPostInput } from "@/social/social-lib";
import type { PostingDraft } from "@/social/social-lib";
import { CloudAccountBrowser } from "./cloud-account-browser";

const JOBS_PAGE = 4;
const FILES_PAGE = 12;
const MAX_SELECT = 200;
const ACTIVE = new Set(["queued", "processing", "cancelling"]);

const providerName: Record<string, string> = { drive: "Google Drive", dropbox: "Dropbox", mega: "MEGA" };

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function errorMessage(err: unknown, fallback: string) {
  if (err && typeof err === "object") {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
      return (data as { error: string }).error;
    }
    if (err instanceof Error && err.message) return err.message;
  }
  return fallback;
}

function isExpired(job: ImportJob) {
  return new Date(job.expiresAt).getTime() <= Date.now();
}

function statusLabel(job: ImportJob) {
  if (job.status === "preview") return isExpired(job) ? "Preview expired" : "Awaiting selection";
  return {
    queued: "Queued", processing: "Importing", cancelling: "Cancelling",
    complete: "Complete", failed: "Failed", cancelled: "Cancelled",
  }[job.status] ?? job.status;
}

function fileStatusLabel(file: ImportFile) {
  return {
    preview: "Available", queued: "Waiting", transferring: "Transferring", complete: "Imported",
    failed: "Failed", cancelled: "Cancelled", skipped: "Skipped",
  }[file.status] ?? file.status;
}

function jobProgress(job: ImportJob) {
  const chosen = job.files.filter((f) => f.status !== "preview" && f.status !== "skipped");
  const total = chosen.reduce((t, f) => t + f.size, 0);
  const done = chosen.reduce((t, f) => t + (f.status === "complete" ? f.size : Math.min(f.bytesTransferred, f.size)), 0);
  return { count: chosen.length, completed: chosen.filter((f) => f.status === "complete").length, pct: total ? Math.min(100, (done / total) * 100) : 0 };
}

export function CloudImportPanel({ collections }: { collections: string[] }) {
  const client = useQueryClient();
  const [url, setUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [currentPreview, setCurrentPreview] = useState<ImportJob | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collection, setCollection] = useState("");
  const [startError, setStartError] = useState("");
  const [visibleFiles, setVisibleFiles] = useState(FILES_PAGE);
  const [visibleJobs, setVisibleJobs] = useState(JOBS_PAGE);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [draft, setDraft] = useState<PostingDraft>(defaultDraft);
  const [armed, setArmed] = useState(false);
  const account = useGetSocialAccount({ query: { queryKey: getGetSocialAccountQueryKey(), staleTime: 60_000 } });
  const previewLock = useRef(false);
  const startLock = useRef(false);
  const actLock = useRef(false);

  const jobsQuery = useListImportJobs({ query: { queryKey: getListImportJobsQueryKey(), refetchInterval: 2000, refetchOnMount: "always" } });
  const preview = usePreviewImportLink();
  const start = useStartImportJob();
  const act = useActOnImportJob();

  const jobs = useMemo(() => jobsQuery.data?.jobs ?? [], [jobsQuery.data]);
  const activeJob = jobs.find((j) => j.id === activeId) ?? (currentPreview?.id === activeId ? currentPreview : undefined);
  useEffect(() => {
    const current = jobs.find((job) => job.id === activeId);
    if (current && current.status !== "preview") {
      setActiveId(null);
      setCurrentPreview(null);
      setSelected(new Set());
    }
  }, [jobs, activeId]);

  // Invalidate library caches when any job transitions into complete (or partially completes files).
  const seenComplete = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    if (!jobsQuery.data) return;
    const next = new Map<string, number>();
    for (const job of jobs) next.set(job.id, job.files.filter((f) => f.status === "complete").length);
    const prev = seenComplete.current;
    seenComplete.current = next;
    const changed = jobs.some((job) => (next.get(job.id) ?? 0) > (prev?.get(job.id) ?? 0));
    if (changed) {
      void client.invalidateQueries({ queryKey: ["/api/media"] });
      void client.invalidateQueries({ queryKey: ["/api/media/summary"] });
      void client.invalidateQueries({ queryKey: ["/api/media/collections"] });
      void client.invalidateQueries({ queryKey: ["/api/watch/feed"] });
      void client.invalidateQueries({ queryKey: ["/api/social/feed"] });
    }
  }, [jobsQuery.data, jobs, client]);

  function openPreview(job: ImportJob) {
    setCurrentPreview(job);
    setActiveId(job.id);
    setSelected(new Set(job.files.filter((f) => f.status === "preview").slice(0, MAX_SELECT).map((f) => f.id)));
    setVisibleFiles(FILES_PAGE);
    setStartError("");
  }

  async function submitLink(event: FormEvent) {
    event.preventDefault();
    if (previewLock.current) return;
    const trimmed = url.trim();
    if (trimmed.length < 10) { setLinkError("Paste a full share link."); return; }
    try { new URL(trimmed); } catch { setLinkError("That does not look like a valid link."); return; }
    previewLock.current = true;
    setLinkError("");
    try {
      const job = await preview.mutateAsync({ data: { url: trimmed } });
      openPreview(job);
      setUrl("");
      void client.invalidateQueries({ queryKey: getListImportJobsQueryKey() });
    } catch (err) {
      setLinkError(errorMessage(err, "We could not read that link. Check that it is shared publicly or with anyone who has the link."));
    } finally {
      previewLock.current = false;
    }
  }

  async function confirmStart() {
    if (!activeJob || startLock.current || !selected.size) return;
    if (isExpired(activeJob)) { setStartError("This preview expired. Paste the link again."); return; }
    const blocker = postingBlocker(draft, account.data);
    if (blocker) { setStartError(blocker); return; }
    if (draft.visibility === "public" && !armed) { setArmed(true); return; }
    setArmed(false);
    startLock.current = true;
    setStartError("");
    try {
      await start.mutateAsync({
        id: activeJob.id,
        data: { fileIds: Array.from(selected), ...(collection.trim() ? { collection: collection.trim() } : {}), posting: toPostInput(draft) },
      });
      trackEvent("cloud_import_started", { file_count: selected.size });
      setActiveId(null);
      setSelected(new Set());
      await client.invalidateQueries({ queryKey: getListImportJobsQueryKey() });
    } catch (err) {
      setStartError(errorMessage(err, "Could not start this import. Try again."));
    } finally {
      startLock.current = false;
    }
  }

  async function runAction(job: ImportJob, action: "retry" | "cancel") {
    if (actLock.current) return;
    actLock.current = true;
    setActingId(job.id);
    setActionError(null);
    try {
      await act.mutateAsync({ id: job.id, data: { action } });
      await client.invalidateQueries({ queryKey: getListImportJobsQueryKey() });
    } catch (err) {
      setActionError({ id: job.id, message: errorMessage(err, `Could not ${action} this import.`) });
    } finally {
      actLock.current = false;
      setActingId(null);
    }
  }

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECT) next.add(id);
      return next;
    });
  }

  const previewFiles = activeJob?.files ?? [];
  const selectable = previewFiles.filter((f) => f.status === "preview");
  const selectedBytes = selectable.filter((f) => selected.has(f.id)).reduce((t, f) => t + f.size, 0);
  const activeExpired = activeJob ? isExpired(activeJob) : false;
  const otherJobs = jobs.filter((j) => j.id !== activeId);
  const shownJobs = otherJobs.slice(0, visibleJobs);

  return <div data-testid="panel-cloud-import">
    <CloudAccountBrowser onPreview={openPreview} />
    <form onSubmit={submitLink} className="mt-5" noValidate>
      <label htmlFor="cloud-link" className="block text-xs font-bold uppercase tracking-[.1em] text-foreground/80">Share link</label>
      <div className="mt-2 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Link2 size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            id="cloud-link"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setLinkError(""); }}
            maxLength={4096}
            disabled={preview.isPending}
            placeholder="drive.google.com, dropbox.com or mega.nz link"
            className="w-full rounded-md border border-border bg-background/25 py-3 pl-10 pr-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            aria-invalid={!!linkError}
            aria-describedby="cloud-link-help"
            data-testid="input-cloud-link"
          />
        </div>
        <button
          type="submit"
          disabled={preview.isPending || !url.trim()}
          className="shrink-0 rounded-md bg-secondary px-4 text-sm font-semibold text-foreground hover:bg-accent disabled:opacity-40"
          data-testid="button-preview-link"
        >{preview.isPending ? "Reading…" : "Preview"}</button>
      </div>
      {linkError && <p className="mt-2 text-xs text-destructive" role="alert" data-testid="status-link-error">{linkError}</p>}
      <ul id="cloud-link-help" className="mt-3 space-y-1 text-[11px] leading-4 text-muted-foreground">
        <li><span className="font-semibold text-foreground/80">Google Drive, Dropbox:</span> paste individual shared file links, or connect your account above to browse entire folders.</li>
        <li><span className="font-semibold text-foreground/80">MEGA:</span> individual files, or folders up to 200 files.</li>
      </ul>
    </form>

    {activeJob && <section className="mt-5 overflow-hidden rounded-md border border-primary/30 bg-secondary" aria-label="Link preview" data-testid="section-import-preview">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{providerName[activeJob.provider]} · {selectable.length} file{selectable.length === 1 ? "" : "s"}</p>
          <p className="text-xs text-muted-foreground" data-testid="text-preview-expiry">
            {activeExpired ? "Preview expired. Paste the link again." : `Preview valid until ${new Date(activeJob.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
          </p>
        </div>
        <button type="button" onClick={() => setActiveId(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent" aria-label="Close preview" data-testid="button-close-preview"><X size={15} /></button>
      </div>
      {selectable.length === 0 ? <p className="px-4 py-5 text-center text-xs text-muted-foreground">No importable photos or videos were found at this link.</p> : <>
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs">
          <span className="text-muted-foreground" data-testid="text-selected-count">{selected.size} selected · {formatBytes(selectedBytes || 1)}</span>
          <button type="button" disabled={activeExpired} className="font-semibold text-accent-foreground disabled:opacity-40" data-testid="button-toggle-all"
            onClick={() => setSelected(selected.size ? new Set() : new Set(selectable.slice(0, MAX_SELECT).map((f) => f.id)))}
          >{selected.size ? "Select none" : "Select all"}</button>
        </div>
        <ul className="max-h-60 divide-y divide-border overflow-y-auto">
          {previewFiles.slice(0, visibleFiles).map((file) => {
            const can = file.status === "preview" && !activeExpired;
            return <li key={file.id}>
              <label className={`flex items-center gap-3 px-4 py-2.5 ${can ? "cursor-pointer hover:bg-secondary" : "opacity-50"}`}>
                <input type="checkbox" checked={selected.has(file.id)} disabled={!can} onChange={() => toggle(file.id)} className="h-4 w-4 accent-primary" data-testid={`checkbox-import-file-${file.id}`} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={file.name}>{file.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{file.status === "preview" ? formatBytes(file.size) : fileStatusLabel(file)}</span>
              </label>
            </li>;
          })}
        </ul>
        {previewFiles.length > visibleFiles && <button type="button" onClick={() => setVisibleFiles((c) => c + FILES_PAGE)} className="w-full border-t border-border px-4 py-3 text-xs font-semibold text-accent-foreground hover:bg-secondary" data-testid="button-show-more-preview-files">Show {Math.min(FILES_PAGE, previewFiles.length - visibleFiles)} more of {previewFiles.length}</button>}
      </>}
      <div className="border-t border-border p-4">
        <label className="block text-xs font-bold uppercase tracking-[.1em] text-foreground/80" htmlFor="cloud-collection">Collection</label>
        <input id="cloud-collection" list="cloud-collection-options" value={collection} onChange={(e) => setCollection(e.target.value)} maxLength={80} disabled={start.isPending}
          placeholder="Optional" className="mt-2 w-full rounded-md border border-border bg-background/25 px-4 py-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" data-testid="input-cloud-collection" />
        <datalist id="cloud-collection-options">{collections.map((n) => <option value={n} key={n} />)}</datalist>
        <PostingFields draft={draft} onChange={(d) => { setDraft(d); setArmed(false); setStartError(""); }} account={account.data} disabled={start.isPending} idPrefix="cloud" />
        {armed && <p className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-warning" role="status">Imported files will be posted publicly {draft.attribution === "profile" ? `as @${account.data?.profile?.handle}` : "anonymously"}. Press again to confirm.</p>}
        {startError && <p className="mt-2 text-xs text-destructive" role="alert" data-testid="status-start-error">{startError}</p>}
        <button type="button" onClick={confirmStart} disabled={start.isPending || !selected.size || activeExpired}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-start-import"
        >{start.isPending ? "Starting…" : draft.visibility === "public" ? (armed ? `Confirm — import & publish ${selected.size}` : `Review & publish ${selected.size}`) : `Import ${selected.size} file${selected.size === 1 ? "" : "s"} privately`}{!start.isPending && selected.size > 0 && <ArrowRight size={16} />}</button>
      </div>
    </section>}

    <div className="mt-4 flex gap-2.5 rounded-md border border-border bg-secondary p-3 text-[11px] leading-4 text-muted-foreground" data-testid="text-rights-reminder">
      <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" />
      <p>Only import media you own or have the right to keep. Files are copied into your storage and shared only with the choice you confirm above; we never show the source thumbnails. Retries keep the original choice. Imports keep running on the server after you close this window.</p>
    </div>

    <section className="mt-5" aria-label="Recent imports">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-[.1em] text-foreground/80">Recent imports</h3>
        <button type="button" onClick={() => void jobsQuery.refetch()} className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground" aria-label="Refresh imports" data-testid="button-refresh-imports">
          <RefreshCw size={12} className={jobsQuery.isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      {jobsQuery.isLoading ? <div className="mt-3 space-y-2" aria-busy="true">
        {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-secondary" />)}
      </div> : jobsQuery.isError && !jobsQuery.data ? <div className="mt-3 rounded-md border border-border p-4 text-center text-xs text-muted-foreground" role="alert">
        <p>Could not load your imports.</p>
        <button type="button" onClick={() => void jobsQuery.refetch()} className="mt-2 font-semibold text-accent-foreground" data-testid="button-retry-load-imports">Try again</button>
      </div> : otherJobs.length === 0 ? <div className="mt-3 flex flex-col items-center rounded-md border border-dashed border-border px-4 py-6 text-center" data-testid="status-imports-empty">
        <Cloud size={20} className="text-muted-foreground" />
        <p className="mt-2 text-xs text-muted-foreground">No other imports yet. Paste a link above to start.</p>
      </div> : <ul className="mt-3 space-y-2">
        {shownJobs.map((job) => <JobRow key={job.id} job={job} busy={actingId === job.id} anyBusy={actingId !== null}
          error={actionError?.id === job.id ? actionError.message : ""} onAction={runAction} onSelect={openPreview} />)}
      </ul>}
      {otherJobs.length > shownJobs.length && <button type="button" onClick={() => setVisibleJobs((c) => c + JOBS_PAGE)} className="mt-2 w-full rounded-md px-4 py-2.5 text-xs font-semibold text-accent-foreground hover:bg-secondary" data-testid="button-show-more-imports">Show {Math.min(JOBS_PAGE, otherJobs.length - shownJobs.length)} more of {otherJobs.length} imports</button>}
    </section>
  </div>;
}

function JobRow({ job, busy, anyBusy, error, onAction, onSelect }: {
  job: ImportJob; busy: boolean; anyBusy: boolean; error: string;
  onAction: (job: ImportJob, action: "retry" | "cancel") => void;
  onSelect: (job: ImportJob) => void;
}) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(FILES_PAGE);
  const p = jobProgress(job);
  const active = ACTIVE.has(job.status);
  const expired = isExpired(job);
  const failedFiles = job.files.filter((f) => f.status === "failed").length;
  const canRetry = job.status === "failed" && failedFiles > 0 && !expired;
  const canCancel = job.status === "preview" || job.status === "queued" || job.status === "processing";
  const tone = job.status === "complete" && !failedFiles ? "text-success" : job.status === "failed" ? "text-destructive" : active ? "text-accent-foreground" : "text-muted-foreground";
  const files = job.files.filter((f) => job.status === "preview" || f.status !== "preview");

  return <li className="rounded-md border border-border bg-secondary" data-testid={`row-import-${job.id}`}>
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-w-0 flex-1 text-left" data-testid={`button-expand-import-${job.id}`}>
          <p className="truncate text-sm font-semibold text-foreground">{providerName[job.provider]} · {job.status === "preview" ? `${job.files.length} found` : `${p.completed}/${p.count} imported`}</p>
          <p className="text-[11px] text-muted-foreground">{new Date(job.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
        </button>
        <span className={`shrink-0 text-[11px] font-semibold ${tone}`} data-testid={`status-import-${job.id}`}>{statusLabel(job)}</span>
      </div>
      {(active || job.status === "complete") && <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={Math.round(p.pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Import progress">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${p.pct}%` }} />
      </div>}
      {job.error && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{job.error}</p>}
      {error && <p className="mt-2 text-[11px] text-destructive" role="alert">{error}</p>}
      {(canRetry || canCancel || (job.status === "preview" && !expired)) && <div className="mt-3 flex gap-2">
        {job.status === "preview" && !expired && <button type="button" onClick={() => onSelect(job)} className="rounded-md bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground" data-testid={`button-select-import-${job.id}`}>Choose files</button>}
        {canRetry && <button type="button" disabled={anyBusy} onClick={() => onAction(job, "retry")} className="rounded-md bg-secondary px-3.5 py-1.5 text-xs font-semibold text-foreground disabled:opacity-40" data-testid={`button-retry-import-${job.id}`}>{busy ? "Working…" : "Retry"}</button>}
        {canCancel && <button type="button" disabled={anyBusy} onClick={() => onAction(job, "cancel")} className="rounded-md px-3.5 py-1.5 text-xs font-semibold text-foreground/80 ring-1 ring-border disabled:opacity-40" data-testid={`button-cancel-import-${job.id}`}>{busy ? "Working…" : "Cancel"}</button>}
      </div>}
    </div>
    {open && <>
      <ul className="max-h-52 divide-y divide-border overflow-y-auto border-t border-border">
        {files.slice(0, visible).map((f) => <li key={f.id} className="px-4 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-foreground" title={f.name}>{f.name}</span>
            <span className={`flex shrink-0 items-center gap-1 text-[10px] ${f.status === "failed" ? "text-destructive" : f.status === "complete" ? "text-success" : "text-muted-foreground"}`}>
              {f.status === "complete" && <Check size={11} />}
              {f.status === "transferring" && f.size ? `${Math.round((f.bytesTransferred / f.size) * 100)}%` : fileStatusLabel(f)}
            </span>
          </div>
          {f.error && <p className="truncate text-[10px] text-destructive" title={f.error}>{f.error}</p>}
        </li>)}
        {files.length === 0 && <li className="px-4 py-3 text-xs text-muted-foreground">No files in this import.</li>}
      </ul>
      {files.length > visible && <button type="button" onClick={() => setVisible((c) => c + FILES_PAGE)} className="w-full border-t border-border px-4 py-2.5 text-xs font-semibold text-accent-foreground" data-testid={`button-show-more-import-files-${job.id}`}>Show {Math.min(FILES_PAGE, files.length - visible)} more of {files.length}</button>}
    </>}
  </li>;
}
