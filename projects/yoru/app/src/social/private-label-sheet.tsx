import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { trackEvent } from "@/lib/analytics";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Plus, RotateCw, Trash2, X } from "lucide-react";
import { getGetLabelCatalogQueryKey, getGetPostAnnotationQueryKey, useGetLabelCatalog, useGetPostAnnotation, useUpdatePostAnnotation } from "@workspace/api-client-react";
import type { PostAnnotation } from "@workspace/api-client-react";
import { errorStatus } from "./social-lib";
import { addTags, canonicalTag, draftFrom, MAX_NOTES, MAX_TAGS, newRow, sameDraft, toInput, validateDraft } from "./annotation-lib";
import type { AnnotationDraft } from "./annotation-lib";

export const annotationKey = (id: string, uid: string) => [...getGetPostAnnotationQueryKey(id), uid] as const;

/** Read-only query shared with the tile; keyed per account so switches never leak labels. */
export function usePrivateAnnotation(id: string, uid: string, enabled: boolean) {
  return useGetPostAnnotation(id, { query: { enabled, queryKey: annotationKey(id, uid), staleTime: 30_000, retry: 1 } });
}

const seg = (on: boolean) => `flex-1 rounded-md px-3 py-2 text-xs font-bold transition ${on ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:text-foreground"}`;

export function PrivateLabelSheet({ mediaId, uid, onClose, onNext, onSaved, preview }: {
  mediaId: string; uid: string; onClose: () => void;
  /** Optional queue mode: advance to the next item (skip, or after save-and-next). */
  onNext?: () => void;
  onSaved?: (saved: PostAnnotation) => void;
  preview?: ReactNode;
}) {
  const client = useQueryClient();
  const q = usePrivateAnnotation(mediaId, uid, true);
  const update = useUpdatePostAnnotation();
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);
  const base = useRef<{ draft: AnnotationDraft; revision: number } | null>(null);
  const initFor = useRef<string | null>(null);
  const [tagText, setTagText] = useState("");
  const [status, setStatus] = useState<"" | "saved" | "error" | "conflict">("");
  const [errMsg, setErrMsg] = useState("");
  const [confirmClose, setConfirmClose] = useState<"" | "close" | "next">("");
  const advanceAfterSave = useRef(false);

  const reset = (a: PostAnnotation | undefined) => {
    const d = draftFrom(a);
    base.current = { draft: d, revision: a?.revision ?? 0 };
    setDraft(d);
  };
  useEffect(() => {
    if (!q.data || initFor.current === `${uid}:${mediaId}`) return;
    initFor.current = `${uid}:${mediaId}`;
    reset(q.data);
  }, [q.data, mediaId, uid]);

  const pendingDraft = draft ? { ...draft, tags: addTags(draft.tags, tagText) } : null;
  const dirty = !!pendingDraft && !!base.current && !sameDraft(pendingDraft, base.current.draft);
  const prefix = canonicalTag(tagText);
  const catalog = useGetLabelCatalog(prefix ? { prefix } : undefined, { query: { queryKey: [...getGetLabelCatalogQueryKey(prefix ? { prefix } : undefined), uid], staleTime: 60_000, enabled: !!draft } });
  const suggestions = (catalog.data?.items ?? []).filter((s) => !draft?.tags.includes(s.tag)).slice(0, 8);
  const check = pendingDraft ? validateDraft(pendingDraft) : null;

  const patch = (p: Partial<AnnotationDraft>) => { setDraft((d) => d && { ...d, ...p }); if (status === "saved") setStatus(""); };
  const commitTags = (text: string) => { if (!draft) return; patch({ tags: addTags(draft.tags, text) }); setTagText(""); };
  const requestClose = () => { if (update.isPending) return; if (dirty) setConfirmClose("close"); else onClose(); };
  const requestSkip = () => { if (!onNext || update.isPending) return; if (dirty) setConfirmClose("next"); else onNext(); };

  const save = (andNext = false) => {
    if (!draft || !pendingDraft || !base.current || !check?.ok || update.isPending) return;
    if (!dirty) { if (andNext && onNext) onNext(); return; }
    advanceAfterSave.current = andNext;
    setStatus(""); setErrMsg("");
    update.mutate({ id: mediaId, data: toInput(pendingDraft, base.current.revision) }, {
      onSuccess: (saved) => {
        trackEvent("private_labels_saved");
        client.setQueryData(annotationKey(mediaId, uid), saved);
        void client.invalidateQueries({ queryKey: getGetLabelCatalogQueryKey().slice(0, 1) });
        reset(saved); setTagText(""); setStatus("saved");
        onSaved?.(saved);
        if (advanceAfterSave.current && onNext) onNext();
      },
      onError: (err) => {
        const code = errorStatus(err);
        if (code === 409) { setStatus("conflict"); return; }
        setStatus("error");
        setErrMsg(code === 400 || code === 422
          ? draft.sourceUrl.trim() ? "Couldn’t save. Check your labels and that the source is a plain public link." : "Couldn’t save. Check your labels and try again."
          : code === 404 ? "This post is no longer available." : "Couldn’t save right now. Your draft is kept — try again.");
      },
    });
  };
  const reloadLatest = async () => {
    const res = await q.refetch();
    if (res.data) { reset(res.data); setStatus(""); }
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(!!onNext); }
    else if (e.key === "Escape") { e.preventDefault(); requestClose(); }
  };

  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-background/60 md:items-center" onPointerDown={stop} onTouchStart={stop} onWheel={stop} onClick={stop}
    onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }} onKeyDown={onKeyDown} data-testid="sheet-private-labels">
    <div role="dialog" aria-modal="true" aria-label="Private labels" className="sheet-up flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-3xl border border-border bg-card text-foreground md:rounded-3xl">
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 pb-3 pt-4">
        <div>
          <h3 className="text-lg font-bold">Your labels</h3>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent-foreground" data-testid="text-private-marker"><Lock size={11} /> Private — only you see these. They tune your next feed cycle.</p>
        </div>
        <button type="button" onClick={requestClose} aria-label="Close labels" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary" data-testid="button-close-labels"><X size={17} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {preview && <div className="mb-4" data-testid="label-sheet-preview">{preview}</div>}
        {q.isLoading || (!draft && !q.isError) ? <div className="space-y-3"><div className="h-9 animate-pulse rounded-md bg-secondary" /><div className="h-20 animate-pulse rounded-md bg-secondary" /><div className="h-9 w-2/3 animate-pulse rounded-md bg-secondary" /></div>
        : q.isError && !draft ? <div className="py-6 text-center" role="alert"><p className="text-sm text-foreground/80">{errorStatus(q.error) === 404 ? "This post is no longer available." : "Your labels didn’t load."}</p><button type="button" onClick={() => void q.refetch()} disabled={q.isFetching} className="mt-3 inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-retry-labels"><RotateCw size={13} /> {errorStatus(q.error) === 404 ? "Recheck" : "Try again"}</button></div>
        : draft && <div className="space-y-5">
          <section>
            <label htmlFor={`tag-input-${mediaId}`} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Hashtags <span className="font-normal normal-case tracking-normal text-muted-foreground">{draft.tags.length}/{MAX_TAGS}</span></label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {draft.tags.map((t) => <button type="button" key={t} onClick={() => patch({ tags: draft.tags.filter((x) => x !== t) })} className="inline-flex items-center gap-1 rounded-md border border-dashed border-accent-foreground/50 bg-accent-foreground/10 px-2.5 py-1 text-xs font-semibold text-accent-foreground" aria-label={`Remove ${t}`} data-testid={`chip-label-${t}`}>#{t}<X size={11} /></button>)}
              {draft.tags.length === 0 && <span className="text-xs text-muted-foreground">No labels yet.</span>}
            </div>
            <div className="mt-2 flex gap-2">
              <input id={`tag-input-${mediaId}`} value={tagText} onChange={(e) => setTagText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitTags(tagText); } }}
                placeholder="Add a tag, Enter to add" maxLength={200} disabled={draft.tags.length >= MAX_TAGS} autoComplete="off" autoFocus={!!onNext}
                className="min-w-0 flex-1 rounded-md border border-border bg-background/30 px-3 py-2.5 text-sm outline-none focus:border-primary" data-testid="input-label-tag" />
              <button type="button" onClick={() => commitTags(tagText)} disabled={!prefix} className="rounded-md bg-secondary px-3 text-xs font-bold disabled:opacity-40" data-testid="button-add-label-tag">Add</button>
            </div>
            {prefix && <p className="mt-1 text-[11px] text-muted-foreground">Saves as <span className="font-semibold text-foreground/80">#{prefix}</span></p>}
            {suggestions.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Suggested labels">
              {suggestions.map((s) => <button type="button" key={s.tag} onClick={() => commitTags(s.tag)} className="rounded-md bg-secondary px-2.5 py-1 text-xs text-foreground/80 hover:bg-accent" data-testid={`button-suggest-${s.tag}`}>#{s.tag} <span className="text-muted-foreground">{s.count}</span></button>)}
            </div>}
          </section>

          <section>
            <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Attributes</span>
              <button type="button" onClick={() => patch({ attrs: [...draft.attrs, newRow()] })} disabled={draft.attrs.length >= 20} className="inline-flex items-center gap-1 text-xs font-semibold text-warning disabled:opacity-40" data-testid="button-add-attribute"><Plus size={13} /> Add</button></div>
            <div className="mt-2 space-y-2">
              {draft.attrs.length === 0 && <p className="text-xs text-muted-foreground">Structured details like “setting: beach, dusk”.</p>}
              {draft.attrs.map((r, i) => <div key={r.key}>
                <div className="flex gap-2">
                  <input value={r.name} onChange={(e) => patch({ attrs: draft.attrs.map((x) => x.key === r.key ? { ...x, name: e.target.value } : x) })} placeholder="name" maxLength={40} aria-label="Attribute name" className="w-[34%] min-w-0 rounded-md border border-border bg-background/30 px-3 py-2 text-sm outline-none focus:border-primary" data-testid={`input-attr-name-${i}`} />
                  <input value={r.values} onChange={(e) => patch({ attrs: draft.attrs.map((x) => x.key === r.key ? { ...x, values: e.target.value } : x) })} placeholder="values, comma separated" aria-label="Attribute values" className="min-w-0 flex-1 rounded-md border border-border bg-background/30 px-3 py-2 text-sm outline-none focus:border-primary" data-testid={`input-attr-values-${i}`} />
                  <button type="button" onClick={() => patch({ attrs: draft.attrs.filter((x) => x.key !== r.key) })} aria-label="Remove attribute" className="grid w-9 shrink-0 place-items-center rounded-md bg-secondary text-foreground/80" data-testid={`button-remove-attr-${i}`}><Trash2 size={14} /></button>
                </div>
                {check?.rows[r.key] && <p className="mt-1 text-[11px] text-destructive" data-testid={`error-attr-${i}`}>{check.rows[r.key]}</p>}
              </div>)}
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <div><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Review</span>
              <div className="mt-2 flex rounded-full bg-secondary p-0.5">{(["draft", "reviewed"] as const).map((s) => <button type="button" key={s} aria-pressed={draft.reviewStatus === s} onClick={() => patch({ reviewStatus: s })} className={seg(draft.reviewStatus === s)} data-testid={`button-review-${s}`}>{s === "draft" ? "Draft" : "Reviewed"}</button>)}</div></div>
            <div><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Confidence</span>
              <div className="mt-2 flex rounded-full bg-secondary p-0.5">{(["unsure", "confident"] as const).map((s) => <button type="button" key={s} aria-pressed={draft.confidence === s} onClick={() => patch({ confidence: s })} className={seg(draft.confidence === s)} data-testid={`button-confidence-${s}`}>{s === "unsure" ? "Unsure" : "Confident"}</button>)}</div></div>
          </section>

          <section>
            <label htmlFor={`notes-${mediaId}`} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Notes</label>
            <textarea id={`notes-${mediaId}`} value={draft.notes} onChange={(e) => patch({ notes: e.target.value })} maxLength={MAX_NOTES} rows={3} placeholder="Anything you want to remember about this one" className="mt-2 w-full resize-y rounded-md border border-border bg-background/30 px-3 py-2.5 text-sm outline-none focus:border-primary" data-testid="input-label-notes" />
            <p className="text-right text-[10px] text-muted-foreground">{draft.notes.length}/{MAX_NOTES}</p>
          </section>

          <section>
            <label htmlFor={`source-${mediaId}`} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Source link <span className="font-normal normal-case tracking-normal text-muted-foreground">optional</span></label>
            <input id={`source-${mediaId}`} type="url" inputMode="url" value={draft.sourceUrl} onChange={(e) => patch({ sourceUrl: e.target.value })} maxLength={2000} placeholder="https://…" autoComplete="off" className="mt-2 w-full rounded-md border border-border bg-background/30 px-3 py-2.5 text-sm outline-none focus:border-primary" data-testid="input-label-source" />
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Public pages only. Query strings and #fragments are removed on save — never paste links containing tokens, passwords or private access keys.</p>
          </section>
        </div>}
      </div>

      <footer className="border-t border-border px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
        {check?.general && <p className="mb-2 text-xs text-destructive" role="alert">{check.general}</p>}
        {status === "conflict" && <div className="mb-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs" role="alert" data-testid="status-label-conflict">
          <p className="text-accent-foreground">These labels changed on another device. Your draft is kept here.</p>
          <button type="button" onClick={() => void reloadLatest()} disabled={q.isFetching} className="mt-2 rounded-md bg-warning px-3 py-1.5 font-medium text-warning-foreground disabled:opacity-50" data-testid="button-reload-labels">{q.isFetching ? "Loading…" : "Discard draft and load latest"}</button>
        </div>}
        {status === "error" && <p className="mb-2 text-xs text-destructive" role="alert" data-testid="status-label-error">{errMsg}</p>}
        {status === "saved" && <p className="mb-2 text-xs text-accent-foreground" role="status" data-testid="status-label-saved">Saved privately. Your next cycle will reflect it.</p>}
        {confirmClose ? <div className="flex items-center gap-2"><p className="flex-1 text-xs text-foreground/80">Discard unsaved labels?</p>
          <button type="button" onClick={() => setConfirmClose("")} className="rounded-md border border-border px-4 py-2.5 text-xs font-semibold" data-testid="button-keep-editing">Keep editing</button>
          <button type="button" onClick={() => { const next = confirmClose === "next"; setConfirmClose(""); if (next && onNext) onNext(); else onClose(); }} className="rounded-md bg-destructive px-4 py-2.5 text-xs font-bold" data-testid="button-discard-labels">Discard</button></div>
        : <div className="flex flex-wrap gap-2">
          {onNext && <button type="button" onClick={requestSkip} className="flex-1 rounded-full border border-border py-3 text-sm font-semibold" data-testid="button-skip-label">Skip</button>}
          <button type="button" onClick={requestClose} className="flex-1 rounded-full border border-border py-3 text-sm font-semibold">{dirty ? "Cancel" : "Done"}</button>
          <button type="button" onClick={() => save(false)} disabled={!draft || !dirty || !check?.ok || update.isPending} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-40" data-testid="button-save-labels">{update.isPending && <Loader2 size={15} className="animate-spin" />}{update.isPending ? "Saving…" : "Save labels"}</button>
          {onNext && <button type="button" onClick={() => save(true)} disabled={!draft || !check?.ok || update.isPending} className="w-full rounded-full bg-secondary py-3 text-sm font-bold disabled:opacity-40" title="Ctrl or Cmd + Enter" data-testid="button-save-next-labels">{dirty ? "Save and next" : "Next"} <span className="hidden text-xs font-normal text-muted-foreground md:inline">Ctrl/Cmd+Enter</span></button>}
        </div>}
      </footer>
    </div>
  </div>;
}
