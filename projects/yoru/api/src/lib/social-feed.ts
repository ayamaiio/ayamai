import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, mediaItemsTable as media, mediaAnnotationsTable as annotations, watchSignalsTable as signals, watchSettingsTable, watchFeedSessionsTable as sessions,
  videoReviewsTable as reviews, creatorFollowsTable as follows, profilesTable as profiles } from "@workspace/db";
import { publicEligible, unblocked, requireAdult, SocialError } from "./social-access";
import { postDTOs } from "./social-posts";
import { rankSocialPosts, type RankedPost } from "./social-ranking";
import { canonicalHashtag } from "./annotation-labels";
import { globalLibraryReader } from "./library-access";

const ranked = (item: typeof media.$inferSelect): RankedPost => ({
  id: item.id, tags: item.tags,
  // Anonymous uploads never form a publicly identifiable creator profile.
  creator: item.attribution === "profile" ? item.userId : null,
  mediaType: item.mediaType, createdAt: item.publishedAt ?? item.createdAt, durationSeconds: item.durationSeconds,
});
function eligible(userId: string, lane: string, type: string, hashtag = "") {
  return and(eq(media.moderationState, "active"),
    // The Watch feed is for things worth looking at: manga pages belong to the
    // reader, and game-asset dumps belong behind the Library's assets toggle.
    sql`not ('game-asset' = any(${media.tags}))`,
    sql`(${media.collection} is distinct from 'Manga')`,
    or(globalLibraryReader(userId), and(unblocked(userId),
      lane === "collection" ? eq(media.userId, userId) : publicEligible,
      sql`not exists (select 1 from watch_signals s where s.user_id = ${userId} and s.media_id = ${media.id} and s.reaction = 'dislike')`)),
    type === "all" ? undefined : eq(media.mediaType, type),
    hashtag ? sql`(
      exists (select 1 from unnest(${media.tags}) as t(tag)
        where lower(regexp_replace(ltrim(trim(normalize(t.tag, NFKC)), '#'), '\\s+', '-', 'g'))=${hashtag})
      or exists (select 1 from media_annotations a where a.user_id=${userId} and a.media_id=${media.id}
        and ${hashtag}=any(a.tags))
    )` : undefined)!;
}
export async function collaborativeData(userId: string) {
  // Only opted-in reactions to currently eligible PUBLIC posts participate.
  // No private upload names, tags, watches, saves, or reactions enter this query.
  const likes = sql`select s.user_id, s.media_id, s.reaction from watch_signals s
    join social_accounts a on a.user_id=s.user_id and a.collaborative_consent=true and a.accepted_at is not null
    join media_items m on m.id=s.media_id and m.visibility='public' and m.moderation_state='active' and m.rights_confirmed_at is not null
    where s.reaction is not null and s.public_reaction=true and not exists (select 1 from social_blocks b where
      (b.user_id=${userId} and b.blocked_user_id=s.user_id) or (b.blocked_user_id=${userId} and b.user_id=s.user_id))
    and not exists (select 1 from social_blocks b where
      (b.user_id=${userId} and b.blocked_user_id=m.user_id) or
      (b.blocked_user_id=${userId} and b.user_id=m.user_id))
    and exists (select 1 from social_accounts owner where owner.user_id=m.user_id and owner.accepted_at is not null)`;
  const popularityRows = await db.execute<{ media_id: string; positive: string; support: string }>(sql`
    with eligible_signals as (${likes})
    select media_id, count(*) filter(where reaction='like')::text positive, count(*)::text support
    from eligible_signals group by media_id having count(*) >= 5`);
  const neighbors = await db.execute<{ media_id: string; affinity: string }>(sql`
    with eligible_signals as (${likes}),
    own as (select media_id from eligible_signals where user_id=${userId} and reaction='like' limit 100),
    peers as (select s.user_id, count(*) overlap from eligible_signals s join own using(media_id)
      where s.user_id<>${userId} and s.reaction='like' group by s.user_id having count(*) >= 3
      order by count(*) desc limit 100),
    scores as (select s.media_id, count(*) supporters, sum(p.overlap::float/(p.overlap+10)) affinity
      from peers p join eligible_signals s using(user_id) where s.reaction='like' group by s.media_id)
    select media_id, least(1, affinity/10)::text affinity from scores where supporters>=5`);
  return {
    popularity: new Map(popularityRows.rows.map((r) => [r.media_id, { positive: Number(r.positive), support: Number(r.support) }])),
    collaborative: new Map(neighbors.rows.map((r) => [r.media_id, Number(r.affinity)])),
  };
}
// A feed session can hold the entire catalogue (GOD cycles do). Building one
// IN (...) clause from every id overflows the SQL compiler's stack, so large
// id lists are queried in bounded chunks and concatenated.
const CHUNK = 500;

async function inChunks<T>(ids: string[], load: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await load(ids.slice(i, i + CHUNK))));
  return out;
}

export async function socialFeed(userId: string, sessionId: string, lane: string, type: string, offset: number, hashtag = "", lengthPreference: "balanced" | "short" | "long" = "balanced") {
  if (lane === "for-you") await requireAdult(userId);
  const { rows: [{ god }] } = await db.execute<{ god: boolean }>(sql`select ${globalLibraryReader(userId)} as god`);
  let [session] = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId)).limit(1);
  if (session && (session.userId !== userId || session.lane !== lane || session.mediaType !== type || session.hashtag !== hashtag || session.lengthPreference !== lengthPreference)) throw new SocialError(409, "Start a new feed session.");
  if (!session) {
    const where = eligible(userId, lane, type, hashtag);
    const [recent, sample, historySignals, settings, ownRatings, followed] = await Promise.all([
      // GOD cycles cover the entire catalog; ordinary discovery keeps its bounded sample.
      // A ranked feed needs a bounded pool. GOD still sees the newest slice of
      // the whole catalogue, but ranking every row in a 247k library costs
      // minutes per session and is not what a page of 24 needs.
      god ? db.select().from(media).where(where).orderBy(desc(media.createdAt), desc(media.id)).limit(10000)
        : db.select().from(media).where(where).orderBy(desc(media.createdAt), desc(media.id)).limit(200),
      god ? Promise.resolve([]) : db.select().from(media).where(where).orderBy(sql`md5(${media.id}::text || ${sessionId})`).limit(800),
      db.select().from(signals).where(eq(signals.userId, userId)).orderBy(desc(signals.updatedAt)).limit(2000),
      db.select().from(watchSettingsTable).where(eq(watchSettingsTable.userId, userId)).limit(1),
      // Never load review text or other viewers' ratings. Follower visibility
      // is not collaborative consent; these inputs remain personal only.
      db.select({ mediaId: reviews.mediaId, rating: reviews.rating, updatedAt: reviews.updatedAt })
        .from(reviews).where(eq(reviews.userId, userId)).orderBy(desc(reviews.updatedAt), desc(reviews.mediaId)).limit(2000),
      db.select({ creator: profiles.userId }).from(follows)
        .innerJoin(profiles, eq(follows.profileId, profiles.id))
        .where(and(eq(follows.userId, userId), unblocked(userId, sql`${profiles.userId}`))),
    ]);
    const candidates = [...new Map([...recent, ...sample].map((m) => [m.id, m])).values()];
    const historyIds = [...new Set([...historySignals, ...ownRatings].map((s) => s.mediaId))];
    const history = historyIds.length ? await inChunks(historyIds, (chunk) => db.select().from(media).where(and(inArray(media.id, chunk),
      // Personal learning uses current read access; only GOD can use another
      // uploader's private metadata. These features never enter shared signals.
      or(globalLibraryReader(userId), and(sql`(${media.userId}=${userId} or (${publicEligible}))`, unblocked(userId))),
      eq(media.moderationState, "active")))) : [];
    const collab = lane === "for-you" ? await collaborativeData(userId) : { popularity: new Map(), collaborative: new Map() };
    const annotatedIds = [...new Set([...candidates, ...history].map((item) => item.id))];
    const ownLabels = annotatedIds.length ? await inChunks(annotatedIds, (chunk) => db.select().from(annotations)
      .where(and(eq(annotations.userId, userId), inArray(annotations.mediaId, chunk)))) : [];
    const byMedia = new Map(ownLabels.map((row) => [row.mediaId, row]));
    const personalized = (item: typeof media.$inferSelect): RankedPost => {
      const labels = byMedia.get(item.id);
      const structured = labels?.reviewStatus === "reviewed" && labels.confidence === "confident"
        ? Object.entries(labels.attributes).flatMap(([key, values]) => values.map((value) => `attribute:${key}:${value}`)) : [];
      const normalizedPublicTags = item.tags.map((tag) => {
        try { return canonicalHashtag(tag); } catch { return tag.normalize("NFKC").toLowerCase(); }
      });
      return { ...ranked(item), tags: [...new Set([...normalizedPublicTags, ...(labels?.tags ?? []), ...structured])] };
    };
    // These extra features are exclusively this viewer's labels. They never
    // enter public DTOs, aggregate popularity, or collaborative-neighbor queries.
    const accessibleHistoryIds = new Set(history.map((p) => p.id));
    const ids = rankSocialPosts({ candidates: candidates.map(personalized), history: history.map(personalized), signals: historySignals,
      ratings: ownRatings.filter((r) => accessibleHistoryIds.has(r.mediaId)),
      followedCreators: new Set(followed.map((f) => f.creator)),
      seed: sessionId, behavior: settings[0]?.behaviorEnabled ?? true, lengthPreference, includeDisliked: god, ...collab });
    await db.insert(sessions).values({ sessionId, userId, lane, mediaType: type, hashtag, lengthPreference, mediaIds: ids }).onConflictDoNothing();
    [session] = await db.select().from(sessions).where(eq(sessions.sessionId, sessionId)).limit(1);
    if (session.userId !== userId || session.lane !== lane || session.mediaType !== type || session.hashtag !== hashtag || session.lengthPreference !== lengthPreference) throw new SocialError(409, "Start a new feed session.");
    await db.delete(sessions).where(and(eq(sessions.userId, userId), sql`${sessions.createdAt} < now() - interval '7 days'`));
  }
  // Membership remains fixed during a session. Later rating/follow/label edits affect the
  // next cycle, while current authorization/moderation still revoke access now.
  const ordered: (typeof media.$inferSelect)[] = [];
  let nextOffset = Math.min(offset, session.mediaIds.length);
  // Advance over revoked/deleted slots and fill the page, even if an entire
  // stored page disappeared. nextOffset counts scanned slots, never returned rows.
  while (nextOffset < session.mediaIds.length && ordered.length < 24) {
    const ids = session.mediaIds.slice(nextOffset, nextOffset + 24);
    const items = await db.select().from(media).where(and(inArray(media.id, ids), eligible(userId, lane, type)));
    const map = new Map(items.map((m) => [m.id, m]));
    for (const id of ids) {
      nextOffset++;
      const item = map.get(id);
      if (item) ordered.push(item);
      if (ordered.length === 24) break;
    }
  }
  return { sessionId, items: await postDTOs(ordered, userId), offset, nextOffset, total: session.mediaIds.length, hasMore: nextOffset < session.mediaIds.length };
}
