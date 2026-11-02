import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, FileJson, Lock, RotateCw, Tags } from "lucide-react";
import {
  getGetLabelQueueQueryKey, getLabelExportRows, getListLabelExportsQueryKey,
  useCreateLabelExport, useGetLabelQueue, useListLabelExports,
} from "@workspace/api-client-react";
import type { GetLabelQueueStatus, LabelExportManifest, LabelQueuePageItemsItem } from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ayamai-design-system/components/ui/alert";
import { Badge } from "@workspace/ayamai-design-system/components/ui/badge";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ayamai-design-system/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@workspace/ayamai-design-system/components/ui/empty";
import { Input } from "@workspace/ayamai-design-system/components/ui/input";
import { Label } from "@workspace/ayamai-design-system/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ayamai-design-system/components/ui/select";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";
import { LibraryPreview } from "@/components/library-preview";
import { usePageTitle } from "@/lib/page-title";
import { AppNav } from "./app-nav";
import { PrivateLabelSheet } from "./private-label-sheet";
import { canonicalTag } from "./annotation-lib";
import { errorStatus } from "./social-lib";

const PAGE = 25;
const EXPORT_PAGE = 100;
type ExportStatus = "all" | "draft" | "reviewed";
const statusText: Record<string, string> = { all: "All", unlabeled: "Unlabeled", draft: "Draft", reviewed: "Reviewed" };

/* ---------- account-scoped export checkpoints (validated) ---------- */
type Checkpoint = { cursor: number; done: boolean; parts: number; lastStart?: number };
const ckKey = (uid: string, id: string) => `ayanami:label-export:${uid}:${id}`;
function readCheckpoint(uid: string, id: string): Checkpoint | null {
  try {
    const raw = window.localStorage.getItem(ckKey(uid, id));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const { cursor, done, parts, lastStart } = v as Record<string, unknown>;
    if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > 2147483647 ||
      typeof done !== "boolean" || typeof parts !== "number" || !Number.isSafeInteger(parts) || parts < 0 ||
      (lastStart !== undefined && (typeof lastStart !== "number" || !Number.isSafeInteger(lastStart) || lastStart < 0 || lastStart > cursor))) {
      window.localStorage.removeItem(ckKey(uid, id));
      return null;
    }
    return { cursor, done, parts, ...(typeof lastStart === "number" ? { lastStart } : {}) };
  } catch { return null; }
}
function writeCheckpoint(uid: string, id: string, c: Checkpoint) {
  try { window.localStorage.setItem(ckKey(uid, id), JSON.stringify(c)); } catch { /* storage full or blocked: progress still shown in-session */ }
}
function clearCheckpoint(uid: string, id: string) {
  try { window.localStorage.removeItem(ckKey(uid, id)); } catch { /* ignore */ }
}

function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(); };
const expired = (iso: string) => { const t = new Date(iso).getTime(); return !Number.isNaN(t) && t <= Date.now(); };

/* ---------- queue ---------- */
function QueueRow({ item, active, onOpen }: { item: LabelQueuePageItemsItem; active: boolean; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} aria-current={active || undefined}
    className={`flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors ${active ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card hover:bg-secondary"}`}
    data-testid={`row-label-queue-${item.mediaId}`}>
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted"><LibraryPreview id={item.mediaId} visible /></div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold">{item.title || "Untitled"}</p>
      <p className="text-xs text-muted-foreground">{item.mediaType === "video" ? "Video" : "Photo"} · rev {item.revision}</p>
    </div>
    <Badge variant={item.reviewStatus === "reviewed" ? "default" : item.reviewStatus === "draft" ? "secondary" : "outline"}>{statusText[item.reviewStatus]}</Badge>
  </button>;
}

function QueueSection({ uid }: { uid: string }) {
  const client = useQueryClient();
  const [status, setStatus] = useState<GetLabelQueueStatus>("unlabeled");
  const [tagText, setTagText] = useState("");
  const [tag, setTag] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  // Keep the open item independent of background list refreshes. A changed
  // filter membership must not unmount an editor and silently discard a draft.
  const [selected, setSelected] = useState<LabelQueuePageItemsItem | null>(null);
  const cursor = cursors[cursors.length - 1];
  const params = useMemo(() => ({ status, limit: PAGE, ...(tag ? { tag } : {}), ...(cursor ? { cursor } : {}) }), [status, tag, cursor]);
  const queue = useGetLabelQueue(params, { query: { queryKey: [...getGetLabelQueueQueryKey(params), uid], staleTime: 15_000 } });
  const items = queue.data?.items ?? [];
  const idx = selected ? items.findIndex((i) => i.mediaId === selected.mediaId) : -1;
  const selectedItem = selected;
  const pendingAdvance = useRef(false);

  const resetPaging = () => { pendingAdvance.current = false; setCursors([]); setSelected(null); };
  const applyTag = (e: FormEvent) => { e.preventDefault(); setTag(canonicalTag(tagText)); resetPaging(); };

  const goNext = () => {
    if (queue.isFetching) return;
    const next = selected ? items.find((item) => item.mediaId > selected.mediaId) : undefined;
    if (next) { setSelected(next); return; }
    if (queue.data?.nextCursor) { pendingAdvance.current = true; setSelected(null); setCursors((c) => [...c, queue.data!.nextCursor!]); return; }
    setSelected(null);
  };
  // After loading the next bounded page during save-and-next, open its first item.
  useEffect(() => {
    if (queue.isError) { pendingAdvance.current = false; return; }
    if (!pendingAdvance.current || queue.isFetching || !queue.data) return;
    pendingAdvance.current = false;
    setSelected(queue.data.items[0] ?? null);
  }, [queue.data, queue.isFetching, queue.isError]);

  const refreshQueue = () => void client.invalidateQueries({ queryKey: getGetLabelQueueQueryKey().slice(0, 1), refetchType: "none" });

  return <Card data-testid="section-label-queue">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><Tags size={18} /> Labeling queue</CardTitle>
      <CardDescription>Open an item, label it, then save and move on. Ctrl/Cmd+Enter saves and opens the next one.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="space-y-2 md:w-48">
          <Label htmlFor="queue-status">Status</Label>
          <Select value={status} onValueChange={(v) => { setStatus(v as GetLabelQueueStatus); resetPaging(); }}>
            <SelectTrigger id="queue-status" data-testid="select-queue-status"><SelectValue /></SelectTrigger>
            <SelectContent>{(["unlabeled", "draft", "reviewed", "all"] as const).map((s) => <SelectItem key={s} value={s}>{statusText[s]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <form onSubmit={applyTag} className="flex flex-1 items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="queue-tag">Your tag</Label>
            <Input id="queue-tag" value={tagText} onChange={(e) => setTagText(e.target.value)} maxLength={80} placeholder="Any tag" autoComplete="off" data-testid="input-queue-tag" />
          </div>
          <Button type="submit" variant="outline" data-testid="button-apply-queue-tag">Filter</Button>
          {tag && <Button type="button" variant="ghost" onClick={() => { setTag(""); setTagText(""); resetPaging(); }} data-testid="button-clear-queue-tag">Clear</Button>}
        </form>
      </div>

      {queue.isLoading ? <div className="space-y-2">{[0, 1, 2, 3].map((n) => <Skeleton key={n} className="h-16 w-full rounded-md" />)}</div>
      : queue.isError ? <Alert variant="destructive" data-testid="status-queue-error"><AlertTitle>Your queue didn’t load.</AlertTitle><AlertDescription><Button size="sm" variant="outline" className="mt-2" onClick={() => void queue.refetch()} data-testid="button-retry-queue"><RotateCw size={14} /> Try again</Button></AlertDescription></Alert>
      : items.length === 0 ? <Empty data-testid="empty-label-queue"><EmptyHeader><EmptyMedia variant="icon"><Tags /></EmptyMedia><EmptyTitle>Nothing in this view.</EmptyTitle><EmptyDescription>{tag || status !== "unlabeled" ? "Try another status or tag." : "Everything you can see is labeled."}</EmptyDescription></EmptyHeader></Empty>
      : <div className="space-y-2" data-testid="list-label-queue">{items.map((item) => <QueueRow key={item.mediaId} item={item} active={item.mediaId === selected?.mediaId} onOpen={() => setSelected(item)} />)}</div>}

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" disabled={!cursors.length || queue.isFetching} onClick={() => { setCursors((c) => c.slice(0, -1)); setSelected(null); }} data-testid="button-queue-prev"><ChevronLeft size={14} /> Previous</Button>
        <span className="text-xs text-muted-foreground" data-testid="text-queue-page">Page {cursors.length + 1}</span>
        <Button variant="outline" size="sm" disabled={!queue.data?.nextCursor || queue.isFetching} onClick={() => { setCursors((c) => [...c, queue.data!.nextCursor!]); setSelected(null); }} data-testid="button-queue-next">Next page <ChevronRight size={14} /></Button>
      </div>
    </CardContent>

    {selectedItem && <PrivateLabelSheet key={`${uid}:${selectedItem.mediaId}`} mediaId={selectedItem.mediaId} uid={uid}
      onClose={() => { setSelected(null); refreshQueue(); void queue.refetch(); }}
      onNext={goNext}
      onSaved={refreshQueue}
      preview={<div className="space-y-2">
        <div className="mx-auto aspect-video max-h-48 overflow-hidden rounded-md bg-muted"><LibraryPreview id={selectedItem.mediaId} visible /></div>
        <p className="truncate text-sm font-semibold" data-testid="text-label-sheet-title">{selectedItem.title || "Untitled"}</p>
        <p className="text-xs text-muted-foreground">Still preview only; videos never autoplay here. {idx >= 0 ? `Item ${idx + 1} of ${items.length} on this page.` : "This item's queue status changed."}</p>
      </div>} />}
  </Card>;
}

/* ---------- exports ---------- */
function ExportRow({ uid, manifest }: { uid: string; manifest: LabelExportManifest }) {
  const [ck, setCk] = useState<Checkpoint | null>(() => readCheckpoint(uid, manifest.id));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const isExpired = expired(manifest.expiresAt);
  const cancel = useRef(false);
  useEffect(() => () => { cancel.current = true; }, []);

  const downloadParts = async (repeatLast = false) => {
    setBusy(true); setMsg(null); cancel.current = false;
    const state: Checkpoint = ck ?? { cursor: 0, done: false, parts: 0 };
    const start = repeatLast ? state.lastStart ?? 0 : state.cursor;
    try {
      // One bounded file per explicit click avoids browsers silently blocking
      // automatic multi-file downloads. A checkpoint is not proof of disk save.
      const page = await getLabelExportRows(manifest.id, { cursor: start, limit: EXPORT_PAGE });
      if (cancel.current) return; // including account switches / unmounts
      if (page.jsonl.length > 0) downloadText(`label-export-${manifest.id}-from-${String(start).padStart(10, "0")}.jsonl`, page.jsonl, "application/x-ndjson");
      if (!repeatLast) {
        const next = { cursor: page.nextCursor, done: page.done, lastStart: start, parts: state.parts + (page.jsonl.length > 0 ? 1 : 0) };
        writeCheckpoint(uid, manifest.id, next);
        setCk(next);
      }
      setMsg({ kind: "ok", text: page.jsonl.length
        ? `${page.done ? "Final part" : "Part"} download requested. Check it saved; use “Retry last part” if the browser blocked it.`
        : page.done ? "Finished. No remaining accessible rows." : "This part has no accessible rows; continue to the next part." });
    } catch (err) {
      if (cancel.current) return;
      const code = errorStatus(err);
      setMsg({ kind: "err", text: code === 404 || code === 410 ? "This export expired or is no longer available." : `Download stopped at cursor ${state.cursor}. Parts already saved are safe; resume to continue.` });
    } finally { setBusy(false); }
  };
  const restart = () => { clearCheckpoint(uid, manifest.id); setCk(null); setMsg(null); };
  const downloadManifest = () => {
    downloadText(`label-export-${manifest.id}-manifest.json`, JSON.stringify(manifest, null, 2), "application/json");
    setMsg({ kind: "ok", text: "Manifest downloaded." });
  };

  const label = busy ? "Downloading…" : ck?.done ? "Complete" : ck && ck.cursor > 0 ? `Next part from ${ck.cursor}` : "Download first part";
  return <div className="space-y-3 rounded-md border border-border bg-card p-4" data-testid={`row-label-export-${manifest.id}`}>
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={manifest.status === "reviewed" ? "default" : "secondary"}>{statusText[manifest.status]}</Badge>
      {manifest.tag && <Badge variant="outline">#{manifest.tag}</Badge>}
      {isExpired && <Badge variant="destructive">Expired</Badge>}
      <span className="text-sm font-semibold" data-testid={`text-export-count-${manifest.id}`}>{manifest.recordCount} records</span>
    </div>
    <p className="text-xs text-muted-foreground">Snapshot {fmt(manifest.snapshotAt)} · expires {fmt(manifest.expiresAt)} · schema v{manifest.schemaVersion}, taxonomy v{manifest.taxonomyVersion}</p>
    {ck && !ck.done && ck.cursor > 0 && !busy && <p className="text-xs text-muted-foreground" data-testid={`text-export-checkpoint-${manifest.id}`}>Saved progress: {ck.parts} parts, next cursor {ck.cursor}.</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => void downloadParts()} disabled={busy || isExpired || ck?.done} data-testid={`button-download-export-${manifest.id}`}><Download size={14} /> {label}</Button>
      {ck?.lastStart !== undefined && <Button size="sm" variant="outline" onClick={() => void downloadParts(true)} disabled={busy || isExpired} data-testid={`button-retry-export-${manifest.id}`}>Retry last part</Button>}
      <Button size="sm" variant="outline" onClick={downloadManifest} disabled={busy} data-testid={`button-download-manifest-${manifest.id}`}><FileJson size={14} /> Manifest</Button>
      {busy && <Button size="sm" variant="ghost" onClick={() => { cancel.current = true; }} data-testid={`button-pause-export-${manifest.id}`}>Pause</Button>}
      {ck && !busy && <Button size="sm" variant="ghost" onClick={restart} data-testid={`button-restart-export-${manifest.id}`}>Start over</Button>}
    </div>
    {msg && <p role={msg.kind === "err" ? "alert" : "status"} className={`text-xs ${msg.kind === "err" ? "text-destructive" : "text-accent-foreground"}`} data-testid={`status-export-${manifest.id}`}>{msg.text}</p>}
  </div>;
}

function ExportSection({ uid }: { uid: string }) {
  const client = useQueryClient();
  const listKey = [...getListLabelExportsQueryKey(), uid];
  const exports = useListLabelExports({ query: { queryKey: listKey } });
  const create = useCreateLabelExport();
  const [status, setStatus] = useState<ExportStatus>("reviewed");
  const [tagText, setTagText] = useState("");
  const [err, setErr] = useState("");
  const [created, setCreated] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(""); setCreated("");
    const tag = canonicalTag(tagText);
    create.mutate({ data: { status, ...(tag ? { tag } : {}) } }, {
      onSuccess: (m) => { setCreated(`Export created with ${m.recordCount} records.`); void client.invalidateQueries({ queryKey: listKey }); },
      onError: (e2) => setErr(errorStatus(e2) === 429 ? "Too many exports right now. Try again later." : "Couldn’t create that export. Try again."),
    });
  };
  const items = exports.data?.items ?? [];

  return <Card data-testid="section-label-exports">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><Download size={18} /> Exports</CardTitle>
      <CardDescription>Snapshots of your private labels as JSONL. Manifests expire after seven days.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <Alert>
        <AlertTitle>Before you use an export</AlertTitle>
        <AlertDescription className="space-y-1 text-xs">
          <p>Each click downloads one part of up to {EXPORT_PAGE} records, named by its starting cursor. Check that each file saved, then continue. Concatenate parts in cursor order, without duplicates. Progress is kept in this browser.</p>
          <p>Train only on “current_label” records. Separate “audit” records describe revisions, not additional training examples.</p>
          <p>Items you can no longer access are omitted from rows, so row totals may be below the manifest count.</p>
        </AlertDescription>
      </Alert>
      <form onSubmit={submit} className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="space-y-2 md:w-48">
          <Label htmlFor="export-status">Include</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as ExportStatus)}>
            <SelectTrigger id="export-status" data-testid="select-export-status"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="reviewed">Reviewed only</SelectItem><SelectItem value="draft">Drafts only</SelectItem><SelectItem value="all">All labeled</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="flex-1 space-y-2">
          <Label htmlFor="export-tag">Your tag (optional)</Label>
          <Input id="export-tag" value={tagText} onChange={(e) => setTagText(e.target.value)} maxLength={80} placeholder="Any tag" autoComplete="off" data-testid="input-export-tag" />
        </div>
        <Button type="submit" disabled={create.isPending} data-testid="button-create-export">{create.isPending ? "Creating…" : "Create export"}</Button>
      </form>
      {err && <p role="alert" className="text-xs text-destructive" data-testid="status-create-export-error">{err}</p>}
      {created && <p role="status" className="text-xs text-accent-foreground" data-testid="status-create-export-ok">{created}</p>}

      {exports.isLoading ? <div className="space-y-2">{[0, 1].map((n) => <Skeleton key={n} className="h-28 w-full rounded-md" />)}</div>
      : exports.isError ? <Alert variant="destructive"><AlertTitle>Your exports didn’t load.</AlertTitle><AlertDescription><Button size="sm" variant="outline" className="mt-2" onClick={() => void exports.refetch()} data-testid="button-retry-exports"><RotateCw size={14} /> Try again</Button></AlertDescription></Alert>
      : items.length === 0 ? <Empty data-testid="empty-label-exports"><EmptyHeader><EmptyMedia variant="icon"><FileJson /></EmptyMedia><EmptyTitle>No exports yet.</EmptyTitle><EmptyDescription>Create one above. Reviewed labels are included by default.</EmptyDescription></EmptyHeader></Empty>
      : <div className="space-y-2">{items.map((m) => <ExportRow key={`${uid}:${m.id}`} uid={uid} manifest={m} />)}</div>}
    </CardContent>
  </Card>;
}

export function LabelsPage({ uid }: { uid: string }) {
  usePageTitle("Private labels");
  return <div className="library-shell min-h-[100dvh] pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-foreground">
    <AppNav />
    <main className="mx-auto max-w-3xl space-y-6 px-3 pb-8 pt-[76px] sm:px-4 md:px-6 md:pt-20">
      <div>
        <p className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-primary"><Lock size={12} /> Only you see these</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">Private labels</h1>
      </div>
      <QueueSection uid={uid} />
      <ExportSection uid={uid} />
    </main>
  </div>;
}
