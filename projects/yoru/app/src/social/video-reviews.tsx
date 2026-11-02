import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { Lock, RotateCw, Star, Users } from "lucide-react";
import { deleteVideoReview, getGetVideoReviewsQueryKey, getVideoReviews, setVideoReview } from "@workspace/api-client-react";
import type { SocialPost, VideoReview, VideoReviewsPage } from "@workspace/api-client-react";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Textarea } from "@workspace/ayamai-design-system/components/ui/textarea";
import { Label } from "@workspace/ayamai-design-system/components/ui/label";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";
import { cn } from "@workspace/ayamai-design-system/lib/utils";
import { errorStatus, errorText, timeAgo } from "./social-lib";

export const reviewsKey = (postId: string, uid: string) => [...getGetVideoReviewsQueryKey(postId), uid, "infinite"];

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return <span className="inline-flex text-primary" aria-label={`${rating} of 5 stars`}>
    {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={size} fill={n <= rating ? "currentColor" : "none"} aria-hidden="true" />)}
  </span>;
}

/** Accessible 1–5 star rating built as a native radio group. */
function StarInput({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return <fieldset className="flex items-center gap-1" disabled={disabled}>
    <legend className="sr-only">Your rating</legend>
    {[1, 2, 3, 4, 5].map((n) => <label key={n} className="cursor-pointer rounded-md p-1 text-primary focus-within:ring-2 focus-within:ring-ring">
      <input type="radio" name="review-rating" value={n} checked={value === n} onChange={() => onChange(n)} className="sr-only" data-testid={`radio-rating-${n}`} />
      <Star size={22} fill={n <= value ? "currentColor" : "none"} aria-hidden="true" />
      <span className="sr-only">{n} star{n === 1 ? "" : "s"}</span>
    </label>)}
  </fieldset>;
}

export function VideoReviews({ post, uid, onDirtyChange }: { post: SocialPost; uid: string; onDirtyChange: (dirty: boolean) => void }) {
  const client = useQueryClient();
  const key = reviewsKey(post.id, uid);
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => getVideoReviews(post.id, { offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.hasMore ? last.nextOffset : undefined,
    staleTime: 30_000,
  });
  const first = q.data?.pages[0];
  const own = first?.ownReview ?? null;
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const base = useRef({ rating: 0, text: "" });
  const baseReview = useRef<VideoReview | null>(null);
  const hydratedFor = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [status, setStatus] = useState("");
  const dirty = rating !== base.current.rating || text !== base.current.text;
  const dirtyCb = useRef(onDirtyChange); dirtyCb.current = onDirtyChange;
  useEffect(() => { dirtyCb.current(dirty); }, [dirty]);
  useEffect(() => () => dirtyCb.current(false), []);

  const hydrate = (review: VideoReview | null) => {
    baseReview.current = review;
    const next = { rating: review?.rating ?? 0, text: review?.text ?? "" };
    base.current = next; setRating(next.rating); setText(next.text);
  };
  // Draft hydrates once per video/account; refetches never overwrite edits.
  useEffect(() => {
    const id = `${uid}:${post.id}`;
    if (first && hydratedFor.current !== id) { hydratedFor.current = id; hydrate(first.ownReview); }
  }, [first, post.id, uid]);

  const patchOwn = (review: VideoReview | null) => client.setQueryData<InfiniteData<VideoReviewsPage>>(key, (old) => old ? {
    ...old, pages: old.pages.map((p, i) => i === 0 ? { ...p, ownReview: review } : p),
  } : old);

  async function save() {
    if (rating < 1) return;
    setSaving(true); setError(null); setStatus("");
    try {
      const saved = await setVideoReview(post.id, { rating, text, expectedRevision: baseReview.current?.revision ?? 0, expectedReviewId: baseReview.current?.id ?? null });
      patchOwn(saved); hydrate(saved); setStatus("Review saved.");
      void client.invalidateQueries({ queryKey: key });
    } catch (err) {
      const conflict = errorStatus(err) === 409;
      setError({ conflict, message: conflict ? "Your review changed elsewhere. Your draft is kept — reload the latest to continue." : errorText(err, "Couldn’t save your review.") });
    } finally { setSaving(false); }
  }
  async function remove() {
    const saved = baseReview.current;
    if (!saved || !window.confirm("Delete your review?")) return;
    setSaving(true); setError(null); setStatus("");
    try {
      await deleteVideoReview(post.id, { expectedRevision: saved.revision, reviewId: saved.id });
      patchOwn(null); hydrate(null); setStatus("Review deleted.");
      void client.invalidateQueries({ queryKey: key });
    } catch (err) {
      const conflict = errorStatus(err) === 409;
      setError({ conflict, message: conflict ? "Your review changed elsewhere. Reload the latest before deleting." : errorText(err, "Couldn’t delete your review.") });
    } finally { setSaving(false); }
  }
  async function reload() {
    if (dirty && !window.confirm("Discard your unsaved review draft and load the latest?")) return;
    const result = await q.refetch();
    if (result.isError || !result.data) {
      setError({ conflict: false, message: "Couldn’t reload the saved review. Your draft is kept." });
      return;
    }
    hydrate(result.data?.pages[0]?.ownReview ?? null);
    setError(null);
  }

  const privateContext = post.visibility === "private" || post.attribution === "anonymous";
  const others = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((r) => !r.isOwn);

  return <section aria-labelledby="reviews-heading" className="rounded-lg border border-border bg-card p-4" data-testid="panel-video-reviews">
    <div className="flex items-center justify-between gap-2">
      <h2 id="reviews-heading" className="text-sm font-semibold text-foreground">Star reviews</h2>
      {first && first.canReadOthers && first.averageRating !== null && <span className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-review-average"><Stars rating={Math.round(first.averageRating)} /> {first.averageRating.toFixed(1)} · {first.count}</span>}
    </div>
    <p className="mt-2 flex gap-2 text-xs leading-5 text-muted-foreground" data-testid="text-review-audience">
      {privateContext ? <Lock size={14} className="mt-0.5 shrink-0" /> : <Users size={14} className="mt-0.5 shrink-0" />}
      {privateContext
        ? "Your review is private to you. Reviews on private or anonymous posts aren’t shown to anyone else."
        : "You always see your own review. Others’ reviews show only to the poster and to their followers who can already view this video. Reviewers are never named. Stars are separate from likes."}
    </p>
    {q.isLoading ? <div className="mt-3 space-y-2"><Skeleton className="h-8 w-40" /><Skeleton className="h-20 w-full" /></div>
      : q.isError && !first ? <div className="mt-3 flex items-center gap-2 text-sm text-destructive" role="alert">Reviews didn’t load.<Button size="sm" variant="outline" onClick={() => void q.refetch()} data-testid="button-retry-reviews">Try again</Button></div>
      : <>
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <p className="text-xs font-medium text-foreground">You {own && <span className="text-muted-foreground">· edited {timeAgo(own.updatedAt)}</span>}</p>
          <StarInput value={rating} onChange={setRating} disabled={saving} />
          <Label htmlFor="review-text" className="sr-only">Review text</Label>
          <Textarea id="review-text" value={text} maxLength={5000} rows={3} onChange={(e) => setText(e.target.value)} placeholder="What did you think? (optional)" disabled={saving} data-testid="input-review-text" />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={saving || rating < 1 || !dirty} data-testid="button-save-review">{saving ? "Saving…" : own ? "Update review" : "Post review"}</Button>
            {own && <Button type="button" size="sm" variant="ghost" onClick={() => void remove()} disabled={saving} data-testid="button-delete-review">Delete</Button>}
            <Button type="button" size="sm" variant="ghost" onClick={() => void reload()} disabled={saving || q.isFetching} data-testid="button-reload-reviews"><RotateCw size={13} /> Reload</Button>
            <span className="text-xs text-muted-foreground">{text.length}/5000</span>
          </div>
          {error && <div className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">{error.message}
            {error.conflict ? <Button type="button" size="sm" variant="outline" onClick={() => void reload()} data-testid="button-reload-latest-review">Reload latest</Button>
              : <Button type="button" size="sm" variant="outline" onClick={() => void save()} data-testid="button-retry-save-review">Retry</Button>}
          </div>}
          {status && <p className="text-xs text-muted-foreground" role="status">{status}</p>}
        </form>
        {first?.canReadOthers && <div className="mt-4 border-t border-border pt-3">
          {others.length === 0 ? <p className="text-xs text-muted-foreground">No other reviews yet.</p>
            : <ul className="space-y-3">{others.map((r) => <li key={r.id} className="text-sm" data-testid={`review-${r.id}`}>
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Other viewer</span><Stars rating={r.rating} size={12} /><span>{timeAgo(r.updatedAt)}</span></div>
              {r.text && <p className="mt-1 whitespace-pre-wrap leading-6 text-foreground/80">{r.text}</p>}
            </li>)}</ul>}
          {q.hasNextPage && <Button size="sm" variant="outline" className={cn("mt-3")} onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} data-testid="button-more-reviews">{q.isFetchingNextPage ? "Loading…" : "More reviews"}</Button>}
        </div>}
      </>}
  </section>;
}
