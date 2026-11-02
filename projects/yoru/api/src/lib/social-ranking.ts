export interface RankedPost {
  id: string; tags: string[]; creator: string | null; mediaType: string;
  createdAt: Date; durationSeconds: number | null;
}
export interface Preference {
  mediaId: string; reaction: string | null; watchedSeconds: number;
  completions: number; replays: number; quickSkips: number; updatedAt: Date;
}
export interface RatingPreference {
  mediaId: string; rating: number; updatedAt: Date;
}
export function ratingStrength(signal: RatingPreference, now: number) {
  // Three stars is neutral; one/five stars contribute at most -2/+2.
  // Personal explicit feedback works even when inferred behavior is disabled.
  const age = Math.max(0, now - signal.updatedAt.getTime()) / 86400000;
  return Math.max(-2, Math.min(2, signal.rating - 3)) * Math.pow(0.5, age / 60);
}
export function seededUnit(seed: string, id: string) {
  let h = 2166136261;
  for (const ch of `${seed}:${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}
export function preferenceStrength(signal: Preference, duration: number | null, behavior: boolean, now: number) {
  // Explicit preference dominates inference; long videos cannot win by raw seconds.
  const age = Math.max(0, now - signal.updatedAt.getTime()) / 86400000;
  const decay = Math.pow(0.5, age / 60);
  const inferred = behavior ? Math.min(1, signal.watchedSeconds / Math.max(8, duration ?? 30)) * 0.7
    + Math.min(2, signal.completions) * 0.35 + Math.min(2, signal.replays) * 0.15
    - Math.min(3, signal.quickSkips) * 0.12 : 0;
  return ((signal.reaction === "like" ? 4 : signal.reaction === "dislike" ? -6 : 0) + inferred) * decay;
}
export function rankSocialPosts(input: {
  candidates: RankedPost[]; history: RankedPost[]; signals: Preference[];
  collaborative: Map<string, number>; popularity: Map<string, { positive: number; support: number }>;
  seed: string; behavior: boolean; now?: number; lengthPreference?: "balanced" | "short" | "long";
  ratings?: RatingPreference[]; followedCreators?: ReadonlySet<string>;
  includeDisliked?: boolean;
}) {
  const now = input.now ?? Date.now();
  const all = new Map([...input.history, ...input.candidates].map((p) => [p.id, p]));
  const signals = new Map(input.signals.map((s) => [s.mediaId, s]));
  const ratings = new Map((input.ratings ?? []).map((s) => [s.mediaId, s]));
  const tagAffinity = new Map<string, number>(), creatorAffinity = new Map<string, number>(), typeAffinity = new Map<string, number>();
  for (const id of new Set([...signals.keys(), ...ratings.keys()])) {
    const p = all.get(id);
    if (!p) continue;
    const s = signals.get(id), rating = ratings.get(id);
    const strength = Math.max(-6, Math.min(6,
      (s ? preferenceStrength(s, p.durationSeconds, input.behavior, now) : 0)
      + (rating ? ratingStrength(rating, now) : 0)));
    for (const tag of p.tags) tagAffinity.set(tag, (tagAffinity.get(tag) ?? 0) + strength / Math.sqrt(Math.max(1, p.tags.length)));
    if (p.creator) creatorAffinity.set(p.creator, (creatorAffinity.get(p.creator) ?? 0) + strength);
    typeAffinity.set(p.mediaType, (typeAffinity.get(p.mediaType) ?? 0) + strength);
  }
  const scored = input.candidates.filter((p) => input.includeDisliked || signals.get(p.id)?.reaction !== "dislike").map((p) => {
    const signal = signals.get(p.id);
    const affinity = p.tags.reduce((sum, tag) => sum + (tagAffinity.get(tag) ?? 0), 0) / Math.sqrt(Math.max(1, p.tags.length));
    const content = Math.tanh(affinity / 5) * 2.4
      + Math.tanh((p.creator ? creatorAffinity.get(p.creator) ?? 0 : 0) / 6) * 0.6
      + Math.tanh((typeAffinity.get(p.mediaType) ?? 0) / 8) * 0.25;
    const pop = input.popularity.get(p.id);
    // Five distinct consenting accounts required; Beta prior prevents tiny-sample dominance.
    const quality = pop && pop.support >= 5 ? (pop.positive + 2) / (pop.support + 6) * 0.35 : 0;
    const fresh = Math.exp(-Math.max(0, now - p.createdAt.getTime()) / (14 * 86400000)) * 0.25;
    const exposure = signal ? 0.65 * Math.exp(-Math.max(0, now - signal.updatedAt.getTime()) / 86400000) : 0;
    const rating = ratings.get(p.id);
    const direct = Math.max(-6, Math.min(6,
      (signal ? preferenceStrength(signal, p.durationSeconds, input.behavior, now) : 0)
      + (rating ? ratingStrength(rating, now) : 0))) * 0.12;
    // Only named creators can match follows. This bounded bonus does not grow
    // with follow count or duration, and exploration slots ignore it entirely.
    const follow = p.creator && input.followedCreators?.has(p.creator) ? 0.65 : 0;
    // A soft context preference, never a duration cutoff. Unknown lengths and
    // images are neutral; explicit/content affinities still dominate.
    const length = p.mediaType === "video" && p.durationSeconds != null && p.durationSeconds > 0
      ? Math.tanh(Math.log2(p.durationSeconds / 180)) * 0.5 : 0;
    const context = input.lengthPreference === "long" ? length : input.lengthPreference === "short" ? -length : 0;
    return { p, score: content + follow + Math.min(1, input.collaborative.get(p.id) ?? 0) * 1.2 + quality + fresh + direct + context - exposure + seededUnit(input.seed, p.id) * 0.9 };
  });
  const result: string[] = [], recent: RankedPost[] = [];
  // Greedy re-ranking is O(n^2) because every pick rescans the pool. Order the
  // base scores once, then re-rank only a window of the strongest candidates.
  // A session never needs to store an ordering of the whole library.
  const RANK_WINDOW = 400;
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > RANK_WINDOW) scored.length = RANK_WINDOW;
  // Greedy re-ranking: bounded pool, repetition penalties, and ~20% exploration slots.
  while (scored.length) {
    const explore = result.length % 5 === 4;
    let best = 0, score = -Infinity;
    for (let i = 0; i < scored.length; i++) {
      const { p } = scored[i];
      const last = recent.slice(-4);
      const creatorPenalty = p.creator ? last.filter((r) => r.creator === p.creator).length * 0.9 : 0;
      const tagPenalty = last.reduce((n, r) => n + Math.min(0.4, r.tags.filter((t) => p.tags.includes(t)).length * 0.1), 0);
      const typePenalty = last.length >= 3 && last.slice(-3).every((r) => r.mediaType === p.mediaType) ? 0.25 : 0;
      const value = (explore ? seededUnit(`${input.seed}:explore`, p.id) : scored[i].score) - creatorPenalty - tagPenalty - typePenalty;
      if (value > score) { best = i; score = value; }
    }
    const [chosen] = scored.splice(best, 1);
    result.push(chosen.p.id); recent.push(chosen.p);
  }
  return result;
}
