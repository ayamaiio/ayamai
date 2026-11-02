import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Film, ImagePlus, LockKeyhole, RotateCw, Upload, X } from "lucide-react";
import {
  getGetSocialAccountQueryKey,
  useCreateGalleryPost,
  useCreateMedia,
  useGetSocialAccount,
  useRequestMediaUploadUrl,
} from "@workspace/api-client-react";
import type { PostInput } from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/ayamai-design-system/components/ui/dialog";
import { Input } from "@workspace/ayamai-design-system/components/ui/input";
import { Label } from "@workspace/ayamai-design-system/components/ui/label";
import { Progress } from "@workspace/ayamai-design-system/components/ui/progress";
import { PostingFields } from "@/social/posting-fields";
import { defaultDraft, errorStatus, postingBlocker, toPostInput } from "@/social/social-lib";
import type { PostingDraft } from "@/social/social-lib";
import { formatBytes, putFile } from "@/lib/direct-upload";
import type { MediaFileInfo } from "@/lib/direct-upload";
import { MAX_GALLERY_IMAGES, admitFiles, isAmbiguousFailure, moveItem } from "@/lib/gallery-post";
import type { SelectionKind } from "@/lib/gallery-post";
import { trackEvent } from "@/lib/analytics";

type Item = {
  id: string;
  file: File;
  info: MediaFileInfo;
  preview: string;
  progress: number;
  objectKey?: string;
  error?: string;
};
type Phase = "editing" | "uploading" | "posting" | "ambiguous" | "done";
/** Frozen at first submit so every retry sends the identical request. */
type Submission = { submissionId: string; posting: PostInput; collection: string | null };

export function CreatePostDialog({ collections, onClose, onOpenBulk }: { collections: string[]; onClose: () => void; onOpenBulk?: () => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [kind, setKind] = useState<SelectionKind>("empty");
  const [collection, setCollection] = useState("");
  const [draft, setDraft] = useState<PostingDraft>(defaultDraft);
  const [armed, setArmed] = useState(false);
  const [phase, setPhase] = useState<Phase>("editing");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const submission = useRef<Submission | null>(null);
  const running = useRef(false);
  const [postSent, setPostSent] = useState(false);
  const previews = useRef(new Set<string>());
  const account = useGetSocialAccount({ query: { queryKey: getGetSocialAccountQueryKey(), staleTime: 60_000 } });
  const askUrl = useRequestMediaUploadUrl();
  const createGallery = useCreateGalleryPost();
  const createVideo = useCreateMedia();
  const client = useQueryClient();
  const busy = phase === "uploading" || phase === "posting";
  // Once a post request has been sent, the selection and choices are locked until it resolves consistently.
  const locked = phase !== "editing";

  useEffect(() => () => { previews.current.forEach((u) => URL.revokeObjectURL(u)); }, []);
  useEffect(() => {
    if (!busy && phase !== "ambiguous") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, phase]);

  function addFiles(list: FileList | File[]) {
    if (locked) return;
    const { accepted, kind: nextKind, problems } = admitFiles(kind, items.length, Array.from(list));
    const added = accepted.map(({ file, info }) => {
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      return { id: crypto.randomUUID(), file, info, preview, progress: 0 };
    });
    if (added.length) { setItems((c) => [...c, ...added]); setKind(nextKind); }
    setNotice(problems.join(" "));
    setError(""); setArmed(false);
  }
  function remove(id: string) {
    if (locked) return;
    const target = items.find((i) => i.id === id);
    if (target) { URL.revokeObjectURL(target.preview); previews.current.delete(target.preview); }
    const next = items.filter((i) => i.id !== id);
    setItems(next);
    if (!next.length) setKind("empty");
    setArmed(false); setNotice("");
  }
  function move(from: number, to: number) { if (!locked) { setItems((c) => moveItem(c, from, to)); setArmed(false); } }
  const patch = (id: string, changes: Partial<Item>) => setItems((c) => c.map((i) => i.id === id ? { ...i, ...changes } : i));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current || phase === "done" || !items.length) return;
    if (!submission.current) {
      const blocker = postingBlocker(draft, account.data);
      if (blocker) { setError(blocker); return; }
      if (!armed) { setArmed(true); setError(""); return; }
      submission.current = { submissionId: crypto.randomUUID(), posting: toPostInput(draft), collection: collection.trim() || null };
    }
    const snap = submission.current;
    setArmed(false);
    running.current = true;
    setError("");
    const fileCount = items.length;
    trackEvent("upload_batch_started", { file_count: fileCount });
    // 1. Upload every file privately; uploaded keys are kept so retries never re-upload.
    setPhase("uploading");
    const keys = new Map(items.filter((i) => i.objectKey).map((i) => [i.id, i.objectKey as string]));
    for (const item of items) {
      if (keys.has(item.id)) continue;
      patch(item.id, { error: undefined, progress: 0 });
      try {
        const result = await askUrl.mutateAsync({ data: { name: item.file.name, size: item.file.size, contentType: item.info.contentType, mediaType: item.info.mediaType } });
        await putFile(result.uploadUrl, item.file, item.info.contentType, (progress) => patch(item.id, { progress }));
        keys.set(item.id, result.objectKey);
        patch(item.id, { objectKey: result.objectKey, progress: 100 });
      } catch (err) {
        patch(item.id, { error: err instanceof Error ? err.message : "Upload failed.", progress: 0 });
      }
    }
    if (keys.size !== items.length) {
      running.current = false;
      trackEvent("upload_batch_finished", { completed_count: 0, failed_count: fileCount });
      // Nothing has been posted yet; choices stay frozen so the retry matches what was confirmed.
      setPhase("ambiguous");
      setError("Some files didn’t upload. Nothing has been posted. Retry to continue with the same post.");
      return;
    }
    // 2. Exactly one post request for the whole set.
    setPhase("posting");
    setPostSent(true);
    try {
      if (kind === "video") {
        const item = items[0];
        await createVideo.mutateAsync({ data: {
          title: item.file.name.replace(/\.[^.]+$/, "").trim() || item.file.name,
          originalName: item.file.name, contentType: item.info.contentType, size: item.file.size,
          mediaType: "video", objectKey: keys.get(item.id) as string,
          ...(snap.collection ? { collection: snap.collection } : {}), posting: snap.posting,
        } });
      } else {
        await createGallery.mutateAsync({ data: {
          submissionId: snap.submissionId, collection: snap.collection, posting: snap.posting,
          images: items.map((i) => ({ objectKey: keys.get(i.id) as string, originalName: i.file.name, contentType: i.info.contentType, size: i.file.size })),
        } });
      }
    } catch (err) {
      running.current = false;
      trackEvent("upload_batch_finished", { completed_count: 0, failed_count: fileCount });
      if (isAmbiguousFailure(errorStatus(err))) {
        setPhase("ambiguous");
        setError("We couldn’t confirm the post was created. Retry sends the same post again and won’t duplicate it.");
      } else {
        // Definitive rejection: nothing was created, so editing is safe and the next attempt is a new submission.
        submission.current = null;
        setPostSent(false);
        setPhase("editing");
        setError(err instanceof Error && err.message ? err.message : "The post was rejected. Review it and try again.");
      }
      return;
    }
    running.current = false;
    trackEvent("upload_batch_finished", { completed_count: fileCount, failed_count: 0 });
    await Promise.all([
      client.invalidateQueries({ queryKey: ["/api/media"] }),
      client.invalidateQueries({ queryKey: ["/api/media/summary"] }),
      client.invalidateQueries({ queryKey: ["/api/media/collections"] }),
      client.invalidateQueries({ queryKey: ["/api/social/feed"], refetchType: "none" }),
      client.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/social/profiles"), refetchType: "none" }),
    ]);
    setPhase("done");
  }

  function discardAmbiguous() {
    // Only offered when no post request was sent (uploads failed): safe to edit again.
    submission.current = null;
    setPhase("editing"); setError("");
  }

  const isPublic = draft.visibility === "public";
  const totalBytes = items.reduce((t, i) => t + i.file.size, 0);
  const doneBytes = items.reduce((t, i) => t + (i.objectKey ? i.file.size : i.file.size * i.progress / 100), 0);
  const label = phase === "uploading" ? "Uploading…" : phase === "posting" ? "Posting…" : phase === "ambiguous" ? "Retry post"
    : armed ? `Confirm — publish ${isPublic ? "publicly" : "privately"}` : `Review & ${isPublic ? "publish" : "save privately"}`;

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[calc(100dvh-1.5rem)] max-w-xl overflow-y-auto" onInteractOutside={(e) => { if (busy || phase === "ambiguous") e.preventDefault(); }} onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }} data-testid="dialog-create-post">
      <DialogHeader>
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Create post</p>
        <DialogTitle className="text-2xl font-semibold tracking-tight">{phase === "done" ? "Posted." : "Share a set."}</DialogTitle>
        <DialogDescription>{phase === "done" ? "Your post is in your library and, if public, in Watch." : `Up to ${MAX_GALLERY_IMAGES} images or GIFs in order, or one video.`}</DialogDescription>
      </DialogHeader>

      {phase === "done" ? <div className="flex flex-col items-center gap-4 py-6 text-center" role="status" data-testid="status-post-created">
        <span className="grid h-12 w-12 place-items-center rounded-md bg-accent text-accent-foreground"><Check size={22} /></span>
        <p className="text-sm text-muted-foreground">{items.length > 1 ? `${items.length} images in one post.` : "One item posted."}</p>
        <Button type="button" onClick={onClose} data-testid="button-create-done">Done</Button>
      </div> : <form onSubmit={submit} data-testid="form-create-post">
        {!locked && <label
          className={`flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-5 py-5 text-center transition ${dragging ? "border-primary bg-primary/10" : "border-input bg-secondary"}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          data-testid="create-dropzone"
        >
          <input type="file" multiple={kind !== "video"} accept="image/*,video/*,.mkv,.avi,.m4v" className="sr-only" onChange={(e) => { if (e.currentTarget.files) addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} data-testid="input-create-files" />
          <span className="grid h-10 w-10 place-items-center rounded-md bg-primary/15 text-primary"><Upload size={18} /></span>
          <span className="mt-2 text-sm font-semibold text-foreground">{items.length ? "Add more images" : "Choose images, GIFs or a video"}</span>
          <span className="mt-1 text-xs text-muted-foreground">{kind === "images" ? `${items.length} of ${MAX_GALLERY_IMAGES}` : "Files stay private until you confirm"}</span>
        </label>}
        {notice && <p className="mt-2 text-xs text-warning" role="status" data-testid="status-create-notice">{notice}</p>}

        {items.length > 0 && <ol className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Post order" data-testid="list-create-items">
          {items.map((item, i) => <li key={item.id} className="relative overflow-hidden rounded-md border border-border bg-muted" data-testid={`item-create-${i}`}>
            <div className="aspect-square">
              {item.info.mediaType === "video"
                ? <video src={item.preview} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                : <img src={item.preview} alt={`Image ${i + 1}`} className="h-full w-full object-cover" />}
            </div>
            <span className="absolute left-1 top-1 rounded-md bg-background/80 px-1.5 font-mono text-[10px] text-foreground">{i === 0 ? "Cover" : i + 1}</span>
            {item.info.mediaType === "video" && <Film size={14} className="absolute right-1 top-1 text-foreground" aria-hidden="true" />}
            {(phase === "uploading" || item.objectKey) && <Progress value={item.objectKey ? 100 : item.progress} className="absolute inset-x-0 bottom-0 h-1 rounded-none" aria-label={`Upload ${i + 1}`} />}
            {item.error && <span className="absolute inset-x-0 bottom-1 truncate px-1 text-center text-[10px] text-destructive" title={item.error}>Retry needed</span>}
            {!locked && <div className="absolute bottom-1 right-1 flex gap-0.5">
              {kind === "images" && <>
                <Button type="button" size="icon" variant="secondary" className="h-6 w-6" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move image ${i + 1} earlier`} data-testid={`button-move-up-${i}`}><ArrowUp size={12} /></Button>
                <Button type="button" size="icon" variant="secondary" className="h-6 w-6" disabled={i === items.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move image ${i + 1} later`} data-testid={`button-move-down-${i}`}><ArrowDown size={12} /></Button>
              </>}
              <Button type="button" size="icon" variant="secondary" className="h-6 w-6" onClick={() => remove(item.id)} aria-label={`Remove item ${i + 1}`} data-testid={`button-remove-${i}`}><X size={12} /></Button>
            </div>}
          </li>)}
        </ol>}

        {items.length > 0 && <>
          <Label className="mt-4 block" htmlFor="create-collection">Collection</Label>
          <Input id="create-collection" list="create-collection-options" value={collection} maxLength={80} disabled={locked} onChange={(e) => { setCollection(e.target.value); setArmed(false); }} placeholder="Optional — series, creator or source" className="mt-2" data-testid="input-create-collection" />
          <datalist id="create-collection-options">{collections.map((n) => <option value={n} key={n} />)}</datalist>
          <PostingFields draft={draft} onChange={(d) => { setDraft(d); setArmed(false); setError(""); }} account={account.data} disabled={locked} idPrefix="create" />
        </>}

        {armed && <p className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-warning" role="status" data-testid="status-confirm-create">
          {isPublic ? `This ${items.length > 1 ? `${items.length}-image post` : "post"} will be published ${draft.attribution === "profile" ? `as @${account.data?.profile?.handle}` : "anonymously"}.` : "This post will be saved privately — only you can see it."} Press the button again to confirm.
        </p>}
        {busy && <div className="mt-3" role="status" aria-live="polite"><Progress value={totalBytes ? doneBytes / totalBytes * 100 : 0} aria-label="Overall progress" /><p className="mt-1 text-[11px] text-muted-foreground">{phase === "posting" ? "Creating one post…" : `${items.filter((i) => i.objectKey).length} of ${items.length} uploaded · ${formatBytes(totalBytes)}`}</p></div>}
        {error && <p className="mt-3 text-sm text-destructive" role="alert" data-testid="status-create-error">{error}</p>}

        <div className="mt-5 flex flex-col gap-2">
          <Button type="submit" disabled={busy || !items.length} className="w-full" data-testid="button-create-submit">{phase === "ambiguous" && <RotateCw size={15} />}{label}</Button>
          {phase === "ambiguous" && !postSent && <Button type="button" variant="ghost" onClick={discardAmbiguous} data-testid="button-create-edit-again">Edit before retrying</Button>}
          {!locked && onOpenBulk && <Button type="button" variant="ghost" onClick={onOpenBulk} data-testid="button-open-bulk"><ImagePlus size={15} /> Bulk import or cloud link instead</Button>}
        </div>
      </form>}
      <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground"><LockKeyhole size={12} /> Nothing is published without your explicit confirmation</p>
    </DialogContent>
  </Dialog>;
}
