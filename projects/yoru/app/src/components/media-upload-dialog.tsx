import { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Cloud, Film, ImagePlus, LockKeyhole, Smartphone, Upload, X } from "lucide-react";
import { CloudImportPanel } from "./cloud-import-panel";
import { PostingFields } from "@/social/posting-fields";
import { defaultDraft, postingBlocker, toPostInput } from "@/social/social-lib";
import type { PostingDraft } from "@/social/social-lib";
import {
  useCreateMedia,
  useRequestMediaUploadUrl,
  useGetSocialAccount,
  getGetSocialAccountQueryKey,
} from "@workspace/api-client-react";
import type { PostInput } from "@workspace/api-client-react";
import { MAX_FILE_SIZE, formatBytes, getMediaFileInfo, putFile } from "@/lib/direct-upload";
import type { MediaFileInfo } from "@/lib/direct-upload";

const MAX_VISIBLE_QUEUE_ITEMS = 10;

type UploadState = "queued" | "uploading" | "complete" | "failed";
type UploadItem = {
  id: string;
  file: File;
  state: UploadState;
  progress: number;
  objectKey?: string;
  fileInfo?: MediaFileInfo;
  error?: string;
  /** Posting choice captured at first attempt; retries reuse it unchanged. */
  posting?: PostInput;
};

export function MediaUploadDialog({
  collections,
  onClose,
}: {
  collections: string[];
  onClose: () => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [collection, setCollection] = useState("");
  const [error, setError] = useState("");
  const [showStorageHelp, setShowStorageHelp] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [visibleItemCount, setVisibleItemCount] = useState(MAX_VISIBLE_QUEUE_ITEMS);
  const [draft, setDraft] = useState<PostingDraft>(defaultDraft);
  const [armed, setArmed] = useState(false);
  const account = useGetSocialAccount({ query: { queryKey: getGetSocialAccountQueryKey(), staleTime: 60_000 } });
  const running = useRef(false);
  const askUrl = useRequestMediaUploadUrl();
  const create = useCreateMedia();
  const client = useQueryClient();

  useEffect(() => {
    if (!busy) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [busy]);

  function addFiles(fileList: FileList | File[]) {
    const selected = Array.from(fileList);
    if (!selected.length) return;
    setItems((current) => [
      ...current,
      ...selected.map((file) => ({
        id: crypto.randomUUID(),
        file,
        state: "queued" as const,
        progress: 0,
      })),
    ]);
    setVisibleItemCount((current) => Math.max(current, MAX_VISIBLE_QUEUE_ITEMS));
    setError("");
    setShowStorageHelp(false);
  }

  function updateItem(id: string, changes: Partial<UploadItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current) return;
    const pending = items.filter((item) => item.state === "queued" || item.state === "failed");
    if (!pending.length) return;
    const needsSnapshot = pending.some((item) => !item.posting);
    const blocker = needsSnapshot ? postingBlocker(draft, account.data) : null;
    if (blocker) { setError(blocker); return; }
    if (needsSnapshot && draft.visibility === "public" && !armed) { setArmed(true); return; }
    const snapshot = toPostInput(draft);
    setArmed(false);

    running.current = true;
    trackEvent("upload_batch_started", { file_count: pending.length });
    setBusy(true);
    setError("");
    setShowStorageHelp(false);
    let failed = 0;

    for (const item of pending) {
      const fileInfo = item.fileInfo ?? getMediaFileInfo(item.file);
      if (!fileInfo) {
        updateItem(item.id, { state: "failed", progress: 0, error: "Choose a supported image or video file." });
        failed += 1;
        continue;
      }
      if (item.file.size === 0) {
        updateItem(item.id, { state: "failed", progress: 0, error: "This file is empty." });
        failed += 1;
        continue;
      }
      if (item.file.size > MAX_FILE_SIZE) {
        updateItem(item.id, { state: "failed", progress: 0, error: "This file is over the 5 GB per-file limit." });
        failed += 1;
        continue;
      }

      const posting = item.posting ?? snapshot;
      updateItem(item.id, { state: "uploading", progress: item.objectKey ? 99 : 0, fileInfo, error: undefined, posting });
      try {
        let objectKey = item.objectKey;
        if (!objectKey) {
          const result = await askUrl.mutateAsync({
            data: {
              name: item.file.name,
              size: item.file.size,
              contentType: fileInfo.contentType,
              mediaType: fileInfo.mediaType,
            },
          });
          await putFile(result.uploadUrl, item.file, fileInfo.contentType, (progress) => {
            updateItem(item.id, { progress });
          });
          objectKey = result.objectKey;
          updateItem(item.id, { objectKey, fileInfo, progress: 99 });
        }
        const title = item.file.name.replace(/\.[^.]+$/, "").trim() || item.file.name;
        await create.mutateAsync({
          data: {
            title,
            originalName: item.file.name,
            contentType: fileInfo.contentType,
            size: item.file.size,
            mediaType: fileInfo.mediaType,
            objectKey,
            ...(collection.trim() ? { collection: collection.trim() } : {}),
            posting,
          },
        });
        updateItem(item.id, { state: "complete", progress: 100 });
      } catch (uploadError) {
        const isStorageConnectionError = uploadError instanceof TypeError;
        if (isStorageConnectionError) setShowStorageHelp(true);
        const message = uploadError instanceof Error
          ? uploadError.message
          : "Upload failed. Try again.";
        updateItem(item.id, { state: "failed", progress: 0, error: message });
        failed += 1;
      }
    }

    trackEvent("upload_batch_finished", { completed_count: pending.length - failed, failed_count: failed });
    await Promise.all([
      client.invalidateQueries({ queryKey: ["/api/media"] }),
      client.invalidateQueries({ queryKey: ["/api/media/summary"] }),
      client.invalidateQueries({ queryKey: ["/api/media/collections"] }),
      client.invalidateQueries({ queryKey: ["/api/social/feed"] }),
    ]);
    running.current = false;
    setBusy(false);
    if (failed === 0) onClose();
    else setError(`${failed} file${failed === 1 ? "" : "s"} need another try. Completed files are already in your library.`);
  }

  const pendingCount = items.filter((item) => item.state === "queued" || item.state === "failed").length;
  const totalSize = items.reduce((total, item) => total + item.file.size, 0);
  const completedCount = items.filter((item) => item.state === "complete").length;
  const uploadedBytes = items.reduce((total, item) => {
    if (item.state === "complete") return total + item.file.size;
    if (item.state === "uploading") return total + item.file.size * item.progress / 100;
    return total;
  }, 0);
  const overallProgress = totalSize ? Math.min(100, (uploadedBytes / totalSize) * 100) : 0;
  const activeUpload = items.find((item) => item.state === "uploading");
  const visibleQueueItems = items.slice(0, visibleItemCount);
  if (activeUpload && !visibleQueueItems.some((item) => item.id === activeUpload.id)) {
    visibleQueueItems[visibleQueueItems.length - 1] = activeUpload;
  }

  return <div
    className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-3 backdrop-blur-md sm:p-4"
    role="presentation"
    onMouseDown={(event) => {
      if (!busy && event.target === event.currentTarget) onClose();
    }}
  >
    <div
      className="fade-up max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-popover p-5 text-foreground shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-7"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-heading"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-[.15em] text-primary">Bulk import · one post per file</div>
          <h2 id="upload-heading" className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{mode === "local" ? "Add your files." : "Bring in a link."}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{mode === "local" ? "Select as many photos or videos as you need. You can add another batch before uploading." : "Paste a share link, pick the files, and the server copies them into your library."}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-foreground/80 disabled:opacity-40"
          aria-label="Close upload"
          data-testid="button-close-upload"
        ><X size={17} /></button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-1 rounded-full bg-background/30 p-1" role="tablist" aria-label="Upload source">
        {([["local", "This device", Smartphone], ["cloud", "Cloud link", Cloud]] as const).map(([value, label, Icon]) => <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          disabled={busy}
          onClick={() => setMode(value)}
          className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${mode === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground/80"}`}
          data-testid={`tab-upload-${value}`}
        ><Icon size={15} />{label}</button>)}
      </div>

      {mode === "cloud" ? <CloudImportPanel collections={collections} /> : <form onSubmit={submit} data-testid="form-local-upload">
      <label
        className={`mt-5 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-5 py-5 text-center transition ${dragging ? "border-primary bg-primary/10" : "border-input bg-secondary hover:border-input hover:bg-secondary"}`}
        data-testid="upload-dropzone"
        onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!busy) addFiles(event.dataTransfer.files);
        }}
      >
        <input
          type="file"
          accept="image/*,video/*,.mkv,.avi,.m4v"
          multiple
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            if (event.currentTarget.files) addFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
          data-testid="input-upload-file"
        />
        <span className="grid h-11 w-11 place-items-center rounded-md bg-primary/15 text-primary"><Upload size={20} /></span>
        <span className="mt-3 text-sm font-semibold text-foreground">{dragging ? "Drop files to add them" : "Choose files from this device"}</span>
        <span className="mt-1 text-xs text-muted-foreground">Phone photo picker, Files app, or desktop folders · up to 5 GB per file</span>
      </label>

      <label className="mt-4 block text-xs font-bold uppercase tracking-[.1em] text-foreground/80" htmlFor="media-collection">Collection</label>
      <input
        id="media-collection"
        list="media-collection-options"
        value={collection}
        onChange={(event) => setCollection(event.target.value)}
        maxLength={80}
        disabled={busy}
        placeholder="Optional — e.g. series, creator, or source"
        className="mt-2 w-full rounded-md border border-border bg-background/25 px-4 py-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        data-testid="input-media-collection"
      />
      <datalist id="media-collection-options">
        {collections.map((name) => <option value={name} key={name} />)}
      </datalist>
      <p className="mt-1 text-xs text-muted-foreground">This group applies to every file in this batch. Leave blank to keep them ungrouped.</p>
      <PostingFields draft={draft} onChange={(d) => { setDraft(d); setArmed(false); setError(""); }} account={account.data} disabled={busy} idPrefix="upload" />
      {items.some((item) => item.posting && item.state !== "complete") && <p className="mt-2 text-[11px] text-muted-foreground">Files being retried keep the sharing choice they were first submitted with.</p>}
      {armed && <p className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-warning" role="status" data-testid="status-confirm-publish">These files will be posted publicly {draft.attribution === "profile" ? `as @${account.data?.profile?.handle}` : "anonymously"}. Press the button again to confirm.</p>}

      {items.length > 0 && <section className="mt-5 overflow-hidden rounded-md border border-border bg-secondary" aria-label="Upload queue">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{items.length} selected</p>
            <p className="text-xs text-muted-foreground">{completedCount} uploaded · {formatBytes(totalSize)} total</p>
          </div>
          {!busy && items.some((item) => item.state === "complete") && <button
            type="button"
            onClick={() => setItems((current) => current.filter((item) => item.state !== "complete"))}
            className="text-xs font-semibold text-accent-foreground"
            data-testid="button-clear-uploaded"
          >Clear completed</button>}
        </div>
        <ul className="max-h-52 divide-y divide-border overflow-y-auto">
          {visibleQueueItems.map((item) => <li key={item.id} className="flex items-center gap-3 px-4 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-accent-foreground">
              {getMediaFileInfo(item.file)?.mediaType === "video" ? <Film size={17} /> : <ImagePlus size={17} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-xs font-semibold text-foreground" title={item.file.name}>{item.file.name}</p>
                <span className={`shrink-0 text-[10px] font-medium ${item.state === "failed" ? "text-destructive" : item.state === "complete" ? "text-success" : "text-muted-foreground"}`}>
                  {item.state === "complete" ? "Uploaded" : item.state === "uploading" ? `${item.progress}%` : item.state === "failed" ? "Retry needed" : "Waiting"}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">{formatBytes(item.file.size)}</span>
                {item.error && <span className="truncate text-[10px] text-destructive" title={item.error}>{item.error}</span>}
              </div>
              {(item.state === "uploading" || item.state === "complete") && <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${item.progress}%` }} />
              </div>}
            </div>
            {!busy && item.state !== "complete" && <button
              type="button"
              onClick={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Remove ${item.file.name}`}
            ><X size={15} /></button>}
            {item.state === "complete" && <Check size={16} className="shrink-0 text-success" />}
          </li>)}
        </ul>
        {busy && <div className="border-t border-border px-4 py-3" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate" title={activeUpload?.file.name}>{completedCount} of {items.length} uploaded{activeUpload ? ` · ${activeUpload.file.name}` : ""}</span>
            <span className="shrink-0">{Math.round(overallProgress)}%</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${overallProgress}%` }} />
          </div>
        </div>}
        {items.length > visibleQueueItems.length && <button
          type="button"
          onClick={() => setVisibleItemCount((current) => Math.min(items.length, current + MAX_VISIBLE_QUEUE_ITEMS))}
          className="w-full border-t border-border px-4 py-3 text-xs font-semibold text-accent-foreground hover:bg-secondary"
          data-testid="button-show-more-uploads"
        >Show {Math.min(MAX_VISIBLE_QUEUE_ITEMS, items.length - visibleQueueItems.length)} more of {items.length} files</button>}
      </section>}

      {error && <p className="mt-3 text-sm text-destructive" role="alert" data-testid="status-upload-error">{error}</p>}
      {showStorageHelp && <div className="mt-3 rounded-md border border-border bg-secondary p-3 text-xs leading-5 text-foreground/80">
        <p className="font-semibold text-foreground">Cloudflare setting needed</p>
        <p className="mt-1">In R2, open bucket <strong>rei</strong> → Settings → CORS Policy. Allow this origin:</p>
        <code className="mt-1 block break-all rounded bg-background/30 px-2 py-1 text-[11px] text-foreground">{window.location.origin}</code>
        <p className="mt-1">Allow GET, PUT, and HEAD; allow Content-Type and Range headers. The bucket can remain private.</p>
      </div>}

      <button
        type="submit"
        disabled={busy || pendingCount === 0}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="button-upload-submit"
      >
        {busy ? "Uploading files…" : !pendingCount ? "Upload complete" : draft.visibility === "public" && items.some((i) => !i.posting) ? (armed ? `Confirm — publish ${pendingCount} publicly` : `Review & publish ${pendingCount}`) : `Upload ${pendingCount} file${pendingCount === 1 ? "" : "s"}${draft.visibility === "private" ? " privately" : ""}`}
        {!busy && pendingCount > 0 && <ArrowRight size={16} />}
      </button>
      </form>}
      <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground"><LockKeyhole size={12} /> Nothing is published without your explicit confirmation</p>
    </div>
  </div>;
}
