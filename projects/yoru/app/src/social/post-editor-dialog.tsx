import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { getGetSocialAccountQueryKey, getGetSocialPostQueryKey, useGetSocialAccount, useGetSocialPost, useUpdateSocialPost } from "@workspace/api-client-react";
import { PostingFields } from "./posting-fields";
import { defaultDraft, errorText, isGone, postingBlocker, refreshSocial, toPostInput } from "./social-lib";
import type { PostingDraft } from "./social-lib";

/** Owned-only sharing editor opened from the Library viewer. Media stays private until an explicit publish. */
export function PostEditorDialog({ mediaId, onClose }: { mediaId: string; onClose: () => void }) {
  const client = useQueryClient();
  const account = useGetSocialAccount({ query: { queryKey: getGetSocialAccountQueryKey(), staleTime: 60_000 } });
  const post = useGetSocialPost(mediaId, { query: { queryKey: getGetSocialPostQueryKey(mediaId), retry: (n, err) => !isGone(err) && n < 2 } });
  const update = useUpdateSocialPost();
  const [draft, setDraft] = useState<PostingDraft>({ ...defaultDraft(), visibility: "private" });
  const [armed, setArmed] = useState(false);
  const init = useRef(false);
  useEffect(() => {
    if (init.current || (!post.data && !post.isError)) return;
    init.current = true;
    if (post.data) setDraft({ visibility: post.data.visibility, attribution: post.data.attribution, description: post.data.description, tagText: post.data.tags.join(", "), rightsConfirmed: false });
  }, [post.data, post.isError]);

  const wasPublic = post.data?.visibility === "public";
  const blocker = postingBlocker(draft, account.data);
  const publishing = draft.visibility === "public";
  const change = (d: PostingDraft) => { setDraft(d); setArmed(false); };
  function save() {
    if (blocker) return;
    if (publishing && !armed) { setArmed(true); return; }
    update.mutate({ id: mediaId, data: toPostInput(draft) }, {
      onSuccess: async (p) => {
        client.setQueryData(getGetSocialPostQueryKey(mediaId), p);
        await Promise.all([refreshSocial(client, mediaId), client.invalidateQueries({ queryKey: ["/api/media"] })]);
        onClose();
      },
    });
  }
  const label = update.isPending ? "Saving…" : !publishing ? (wasPublic ? "Make private" : "Keep private · save details") : armed ? (wasPublic ? "Confirm update" : "Confirm — publish publicly") : wasPublic ? "Update public post" : "Publish…";

  return <div className="fixed inset-0 z-[70] grid place-items-center bg-background/75 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget && !update.isPending) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby="post-editor-title" className="fade-up max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-popover p-5 text-foreground shadow-2xl sm:p-7" data-testid="dialog-post-editor">
      <div className="flex items-start justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[.14em] text-primary">{wasPublic ? "Public post" : "Private"}</p><h2 id="post-editor-title" className="mt-2 text-2xl font-bold">Sharing</h2></div>
        <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-foreground/80" aria-label="Close sharing" data-testid="button-close-post-editor"><X size={16} /></button>
      </div>
      {post.isLoading || account.isLoading ? <div className="mt-5 h-64 animate-pulse rounded-md bg-secondary" />
        : post.isError && !isGone(post.error) ? <div className="mt-6 text-center text-sm text-foreground/80">Couldn’t load sharing details.<button onClick={() => void post.refetch()} className="ml-2 font-semibold text-accent-foreground">Retry</button></div>
        : <>
          <PostingFields draft={draft} onChange={change} account={account.data} disabled={update.isPending} idPrefix="editor" />
          {blocker && publishing && <p className="mt-3 text-xs text-warning">{blocker}</p>}
          {armed && <p className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-warning" role="status">This will appear in the shared feed {draft.attribution === "profile" ? `as @${account.data?.profile?.handle}` : "anonymously"}. Press again to confirm.</p>}
          {update.isError && <p className="mt-3 text-xs text-destructive" role="alert">{errorText(update.error, "Couldn’t save. Try again.")}</p>}
          <button onClick={save} disabled={update.isPending || (publishing && !!blocker)} className="mt-5 w-full rounded-md bg-primary px-5 py-3.5 text-sm font-bold text-primary-foreground disabled:opacity-40" data-testid="button-save-post">{label}</button>
        </>}
    </div>
  </div>;
}
