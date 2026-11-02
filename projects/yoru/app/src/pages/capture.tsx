import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check, Download, Link2, LockKeyhole, Plus, RotateCw, ShieldCheck, X } from "lucide-react";
import { getGetSocialAccountQueryKey, useGetSocialAccount } from "@workspace/api-client-react";
import { Badge } from "@workspace/ayamai-design-system/components/ui/badge";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ayamai-design-system/components/ui/card";
import { Input } from "@workspace/ayamai-design-system/components/ui/input";
import { Label } from "@workspace/ayamai-design-system/components/ui/label";
import { Progress } from "@workspace/ayamai-design-system/components/ui/progress";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";
import { Textarea } from "@workspace/ayamai-design-system/components/ui/textarea";
import { PostingFields } from "@/social/posting-fields";
import { defaultDraft, postingBlocker, toPostInput } from "@/social/social-lib";
import type { PostingDraft } from "@/social/social-lib";
import { MAX_TAGS, addTags, canonicalTag, draftFrom, newRow, toInput, validateDraft } from "@/social/annotation-lib";
import type { AnnotationDraft } from "@/social/annotation-lib";
import { formatBytes } from "@/lib/direct-upload";
import { useBrowserCapture, useCaptureSave } from "@/lib/use-browser-capture";
import { usePageTitle } from "@/lib/page-title";

const privateDraft = (): PostingDraft => ({ ...defaultDraft(), visibility: "private", rightsConfirmed: false });

function Shell({ children }: { children: ReactNode }) {
  return <div className="min-h-[100dvh] bg-background px-4 py-6 text-foreground sm:px-6">
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Link href="/library" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="link-return-library"><ArrowLeft size={14} /> Return to Library</Link>
      {children}
    </div>
  </div>;
}

function PrivateNote() {
  return <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-foreground" data-testid="text-private-marker"><LockKeyhole size={12} /> Private. Only you see these labels, notes and attributes.</p>;
}

function Instructions() {
  return <Card data-testid="card-capture-install">
    <CardHeader>
      <CardTitle>Install the browser capture extension</CardTitle>
      <CardDescription>Desktop Chrome or Edge only.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4 text-sm text-foreground/80">
      <Button asChild variant="secondary"><a href={`${import.meta.env.BASE_URL}browser-capture.zip`} download><Download size={15} /> Download extension ZIP</a></Button>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5">
        <li>Open chrome://extensions (or edge://extensions) and turn on Developer mode.</li>
        <li>Choose Load unpacked and select the extensions/browser-capture folder.</li>
        <li>On the source page, click the extension action, find visible media and choose one item.</li>
        <li>Enter your app’s HTTPS origin. Start transfer, then pair the destination account in the app tab before the file is read.</li>
      </ol>
      <div>
        <p className="font-semibold text-foreground">What can be captured</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          <li>Only the media you select, from direct HTTPS links.</li>
          <li>Images: PNG, JPEG, GIF, WebP, AVIF. Videos: MP4, WebM. Up to 20 MiB.</li>
          <li>The file must be readable with anonymous CORS, with no redirects, query strings or fragments.</li>
        </ul>
      </div>
      <div>
        <p className="font-semibold text-foreground">Not supported</p>
        <p className="mt-1">DRM-protected media, pages behind a login, cookies, blob URLs, streams, or media inside iframes.</p>
      </div>
      <p>For Google Drive, Dropbox or MEGA, use the bulk cloud import in your Library instead.</p>
    </CardContent>
  </Card>;
}

export function CapturePage({ uid }: { uid: string }) {
  usePageTitle("Browser capture");
  const cap = useBrowserCapture(uid);
  const saver = useCaptureSave(uid);
  const account = useGetSocialAccount({ query: { queryKey: getGetSocialAccountQueryKey(), staleTime: 60_000 } });

  const [title, setTitle] = useState("");
  const [collection, setCollection] = useState("");
  const [posting, setPosting] = useState<PostingDraft>(privateDraft);
  const [labels, setLabels] = useState<AnnotationDraft>(() => draftFrom(undefined));
  const [tagText, setTagText] = useState("");
  const [armed, setArmed] = useState(false);
  const [formError, setFormError] = useState("");
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);

  const file = cap.file;
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!file) return;
    setTitle(file.name.replace(/\.[^.]+$/, "").trim() || file.name);
    setLabels((d) => ({ ...d, sourceUrl: cap.sourceUrl }));
  }, [file, cap.sourceUrl]);

  const locked = saver.locked || saver.busy;
  const isVideo = !!file && file.type.startsWith("video/");
  const isPublic = posting.visibility === "public";
  const pending = { ...labels, tags: addTags(labels.tags, tagText) };
  const check = validateDraft(pending);
  const disarm = () => { setArmed(false); setFormError(""); };
  const patchLabels = (p: Partial<AnnotationDraft>) => { setLabels((d) => ({ ...d, ...p })); disarm(); };
  const commitTags = () => { patchLabels({ tags: addTags(labels.tags, tagText) }); setTagText(""); };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || saver.busy || saver.done) return;
    if (!saver.locked) {
      if (!permissionConfirmed) { setFormError("Confirm you own this file or have permission to save it."); return; }
      if (!title.trim()) { setFormError("Give this item a title."); return; }
      const blocker = postingBlocker(posting, account.data);
      if (blocker) { setFormError(blocker); return; }
      if (!check.ok) { setFormError(check.general || "Fix the highlighted attributes."); return; }
      if (!armed) { setArmed(true); setFormError(""); return; }
    }
    setArmed(false);
    await saver.save(file, cap.sourceUrl, toPostInput(posting), toInput(pending, 0), title.trim(), collection.trim());
  }

  function startOver() {
    cap.reset();
    setPosting(privateDraft()); setLabels(draftFrom(undefined)); setTagText(""); setCollection(""); setArmed(false); setFormError("");
  }

  if (!cap.paired) return <Shell>
    <Card data-testid="card-capture-pair">
      <CardHeader>
        <p className="font-mono text-xs uppercase tracking-widest text-primary">Browser capture</p>
        <CardTitle>Pair the extension with this account</CardTitle>
        <CardDescription>Captured media will be saved into this account only.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-md border border-border bg-secondary p-3">
          <p className="text-xs text-muted-foreground">Account ID</p>
          <p className="break-all font-mono text-sm text-foreground" data-testid="text-capture-uid">{uid}</p>
        </div>
        <p className="flex gap-2 text-sm text-foreground/80"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" /> The extension only sends the media you explicitly select. It never reads your cookies, browsing history, or other tabs.</p>
        {cap.error && <p className="text-sm text-destructive" role="alert">{cap.error}</p>}
        <Button type="button" onClick={cap.pair} data-testid="button-pair-account"><Link2 size={15} /> Pair this account</Button>
      </CardContent>
    </Card>
    <Instructions />
  </Shell>;

  if (!file) return <Shell>
    <Card data-testid="card-capture-waiting">
      <CardHeader>
        <div className="flex items-center gap-2"><Badge variant="secondary">Paired</Badge><span className="truncate font-mono text-xs text-muted-foreground">{uid}</span></div>
        <CardTitle>{cap.incoming ? "Receiving media" : "No capture yet"}</CardTitle>
        <CardDescription>{cap.incoming ? "Transferring the selected file from the extension." : "Use the extension action on a source page to send a selected image or video here."}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {cap.incoming && <><Skeleton className="aspect-video w-full" /><Progress aria-label="Transfer" className="animate-pulse" value={50} /></>}
        {cap.error && <div className="flex flex-col gap-2" role="alert"><p className="text-sm text-destructive">{cap.error}</p><Button type="button" variant="secondary" onClick={cap.reset} data-testid="button-capture-retry"><RotateCw size={15} /> Try again</Button></div>}
      </CardContent>
    </Card>
    <Instructions />
  </Shell>;

  if (saver.done) return <Shell>
    <Card data-testid="card-capture-done">
      <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-md bg-accent text-accent-foreground"><Check size={22} /></span>
        <p className="text-lg font-semibold">Saved to your library</p>
        <p className="text-sm text-muted-foreground">{saver.phase}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="secondary" onClick={startOver} data-testid="button-capture-another"><Download size={15} /> Capture another</Button>
          <Button asChild><Link href="/library">Return to Library</Link></Button>
        </div>
      </CardContent>
    </Card>
  </Shell>;

  const label = saver.busy ? (saver.phase || "Saving") : saver.locked ? "Retry save"
    : armed ? `Confirm: ${isPublic ? "publish publicly" : "save privately"}` : `Review and ${isPublic ? "publish" : "save privately"}`;

  return <Shell>
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="form-capture">
      <Card><CardContent className="pt-6"><Label className="flex items-start gap-3"><input type="checkbox" checked={permissionConfirmed} disabled={locked} onChange={(e) => { setPermissionConfirmed(e.target.checked); disarm(); }} data-testid="checkbox-capture-permission" /><span>I own this file or have permission to save it. Viewing a file does not grant download or redistribution rights. Public sharing requires the separate rights confirmation below.</span></Label></CardContent></Card>
      <Card>
        <CardHeader>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Captured media</p>
          <CardTitle className="break-all">{file.name}</CardTitle>
          <CardDescription className="break-all">{formatBytes(file.size)} · {file.type || "unknown type"}{cap.sourceUrl ? ` · ${cap.sourceUrl}` : ""}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-md border border-border bg-muted">
            {isVideo
              ? <video src={preview} controls muted playsInline preload="metadata" className="max-h-96 w-full object-contain" data-testid="preview-capture-video" />
              : <img src={preview} alt="Captured media preview" className="max-h-96 w-full object-contain" data-testid="preview-capture-image" />}
          </div>
          {!locked && <Button type="button" variant="ghost" onClick={startOver} data-testid="button-capture-discard"><X size={15} /> Discard capture</Button>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="capture-title">Title</Label>
            <Input id="capture-title" value={title} maxLength={200} disabled={locked} onChange={(e) => { setTitle(e.target.value); disarm(); }} data-testid="input-capture-title" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="capture-collection">Collection</Label>
            <Input id="capture-collection" value={collection} maxLength={80} disabled={locked} onChange={(e) => { setCollection(e.target.value); disarm(); }} placeholder="Optional: series, creator or source" data-testid="input-capture-collection" />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-capture-labels">
        <CardHeader>
          <CardTitle>Your private labels</CardTitle>
          <PrivateNote />
        </CardHeader>
        <CardContent>
          <fieldset disabled={locked} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="capture-tag">Hashtags <span className="font-normal text-muted-foreground">{labels.tags.length}/{MAX_TAGS}</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {labels.tags.map((t) => <Button key={t} type="button" size="sm" variant="secondary" onClick={() => patchLabels({ tags: labels.tags.filter((x) => x !== t) })} aria-label={`Remove ${t}`}>#{t} <X size={12} /></Button>)}
                {labels.tags.length === 0 && <span className="text-xs text-muted-foreground">No labels yet.</span>}
              </div>
              <div className="flex gap-2">
                <Input id="capture-tag" value={tagText} maxLength={200} autoComplete="off" placeholder="Add a tag, Enter to add" onChange={(e) => setTagText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitTags(); } }} data-testid="input-capture-tag" />
                <Button type="button" variant="secondary" disabled={!canonicalTag(tagText)} onClick={commitTags}>Add</Button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between"><Label>Attributes</Label>
                <Button type="button" size="sm" variant="ghost" onClick={() => patchLabels({ attrs: [...labels.attrs, newRow()] })} data-testid="button-capture-add-attr"><Plus size={14} /> Add</Button>
              </div>
              {labels.attrs.length === 0 && <p className="text-xs text-muted-foreground">Structured fields like character, artist or outfit.</p>}
              {labels.attrs.map((row) => <div key={row.key} className="flex flex-col gap-1">
                <div className="flex gap-2">
                  <Input aria-label="Attribute name" placeholder="name" value={row.name} onChange={(e) => patchLabels({ attrs: labels.attrs.map((r) => r.key === row.key ? { ...r, name: e.target.value } : r) })} />
                  <Input aria-label="Attribute values" placeholder="values, comma separated" value={row.values} onChange={(e) => patchLabels({ attrs: labels.attrs.map((r) => r.key === row.key ? { ...r, values: e.target.value } : r) })} />
                  <Button type="button" size="icon" variant="ghost" aria-label="Remove attribute" onClick={() => patchLabels({ attrs: labels.attrs.filter((r) => r.key !== row.key) })}><X size={14} /></Button>
                </div>
                {check.rows[row.key] && <p className="text-xs text-destructive">{check.rows[row.key]}</p>}
              </div>)}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="capture-notes">Notes</Label>
              <Textarea id="capture-notes" rows={3} value={labels.notes} onChange={(e) => patchLabels({ notes: e.target.value })} placeholder="Only visible to you" data-testid="input-capture-notes" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="capture-source">Source page</Label>
              <Input id="capture-source" value={labels.sourceUrl} onChange={(e) => patchLabels({ sourceUrl: e.target.value })} placeholder="https://" data-testid="input-capture-source" />
            </div>
            {check.general && <p className="text-xs text-destructive" role="alert">{check.general}</p>}
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <PostingFields draft={posting} onChange={(d) => { setPosting(d); disarm(); }} account={account.data} disabled={locked} idPrefix="capture" />
          {account.isError && <p className="mt-2 text-xs text-destructive" role="alert">Your account settings didn't load. <Button type="button" size="sm" variant="link" onClick={() => void account.refetch()}>Retry</Button></p>}

          {armed && <p className="mt-4 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-warning" role="status" data-testid="status-capture-confirm">
            {isPublic ? `This will be published ${posting.attribution === "profile" ? `as @${account.data?.profile?.handle}` : "anonymously"}. Your labels and notes stay private.` : "This will be saved privately. Only you can see it."} Press the button again to confirm.
          </p>}
          {(saver.busy || saver.progress > 0) && <div className="mt-4" role="status" aria-live="polite">
            <Progress value={saver.progress} aria-label="Upload progress" />
            <p className="mt-1 text-xs text-muted-foreground">{saver.phase || "Uploading"} · {Math.round(saver.progress)}% of {formatBytes(file.size)}</p>
          </div>}
          {(formError || saver.error) && <p className="mt-4 text-sm text-destructive" role="alert" data-testid="status-capture-error">{formError || saver.error}</p>}
          {saver.locked && !saver.busy && saver.error && <p className="mt-1 text-xs text-muted-foreground">Your choices are frozen so the retry sends exactly what you confirmed.</p>}

          <Button type="submit" className="mt-5 w-full" disabled={saver.busy || !account.data} data-testid="button-capture-submit">
            {saver.locked && !saver.busy && <RotateCw size={15} />}{label}
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole size={12} /> Nothing is published without your explicit confirmation</p>
        </CardContent>
      </Card>
    </form>
  </Shell>;
}
