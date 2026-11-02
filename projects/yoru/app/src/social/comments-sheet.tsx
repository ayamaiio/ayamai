import { trackEvent } from "@/lib/analytics";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Trash2, X } from "lucide-react";
import { createSocialComment, deleteSocialComment, getGetSocialCommentsQueryKey, getSocialComments } from "@workspace/api-client-react";
import { errorText, isGone, timeAgo } from "./social-lib";

export function CommentsSheet({ postId, count, onClose, onCountChange, onGone }: {
  postId: string; count: number; onClose: () => void; onCountChange: (delta: number) => void; onGone: () => void;
}) {
  const client = useQueryClient();
  const key = [...getGetSocialCommentsQueryKey(postId), "infinite"];
  const list = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => getSocialComments(postId, { offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => last.hasMore ? pages.reduce((n, p) => n + p.comments.length, 0) : undefined,
    retry: (n, err) => !isGone(err) && n < 2,
  });
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const comments = list.data?.pages.flatMap((p) => p.comments) ?? [];
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  const listGone = list.isError && isGone(list.error);
  useEffect(() => { if (listGone) goneRef.current(); }, [listGone]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true); setError("");
    try {
      await createSocialComment(postId, { text: body, requestId: requestId.current });
      trackEvent("comment_created");
      requestId.current = crypto.randomUUID();
      setText("");
      onCountChange(1);
      await client.invalidateQueries({ queryKey: getGetSocialCommentsQueryKey(postId) });
    } catch (err) {
      if (isGone(err)) { onGone(); return; }
      setError(errorText(err, "Couldn’t post that comment. Try again."));
    } finally { setSending(false); }
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this comment?")) return;
    setDeleting(id); setError("");
    try {
      await deleteSocialComment(id);
      onCountChange(-1);
      await client.invalidateQueries({ queryKey: getGetSocialCommentsQueryKey(postId) });
    } catch (err) { setError(errorText(err, "Couldn’t delete that comment.")); }
    finally { setDeleting(null); }
  }

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-background/50 md:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="sheet-comments">
    <section role="dialog" aria-modal="true" aria-label="Comments" className="sheet-up flex max-h-[78dvh] w-full max-w-lg flex-col rounded-t-3xl border border-border bg-card text-foreground md:rounded-3xl">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-bold">{count} comment{count === 1 ? "" : "s"}</h2>
        <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-secondary" aria-label="Close comments" data-testid="button-close-comments"><X size={16} /></button>
      </header>
      <div className="min-h-[140px] flex-1 overflow-y-auto px-5 py-3">
        {list.isLoading ? <div className="space-y-3">{[0, 1, 2].map((n) => <div key={n} className="h-10 animate-pulse rounded-md bg-secondary" />)}</div>
          : list.isError ? <div className="py-8 text-center text-sm text-foreground/80">Comments didn’t load.<button onClick={() => void list.refetch()} className="ml-2 font-semibold text-accent-foreground">Retry</button></div>
          : comments.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No comments yet. Everyone here is anonymous — say something.</p>
          : <ul className="divide-y divide-border">{comments.map((c) => <li key={c.id} className="flex gap-3 py-3" data-testid={`comment-${c.id}`}>
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-foreground/80">A</span>
            <div className="min-w-0 flex-1"><p className="text-[11px] text-muted-foreground">Anonymous · {timeAgo(c.createdAt)}</p><p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">{c.text}</p></div>
            {c.canDelete && <button onClick={() => void remove(c.id)} disabled={deleting === c.id} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40" aria-label="Delete comment" data-testid={`button-delete-comment-${c.id}`}><Trash2 size={14} /></button>}
          </li>)}</ul>}
        {list.hasNextPage && <button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="mt-2 w-full rounded-md py-2.5 text-xs font-semibold text-accent-foreground hover:bg-secondary" data-testid="button-more-comments">{list.isFetchingNextPage ? "Loading…" : "Show more comments"}</button>}
      </div>
      {error && <p className="px-5 text-xs text-destructive" role="alert">{error}</p>}
      <form onSubmit={submit} className="flex gap-2 border-t border-border p-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]">
        <input value={text} disabled={sending} onChange={(e) => { setText(e.target.value); requestId.current = crypto.randomUUID(); }} maxLength={1000} placeholder="Add an anonymous comment" className="min-w-0 flex-1 rounded-md border border-border bg-background/30 px-4 py-3 text-sm outline-none focus:border-primary" data-testid="input-comment" />
        <button disabled={!text.trim() || sending} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40" aria-label="Post comment" data-testid="button-post-comment"><Send size={17} /></button>
      </form>
    </section>
  </div>;
}
