export interface WatchFeedCandidate {
  id: string;
  title: string;
  collection: string | null;
  mediaType: string;
}

export interface WatchFeedSignal {
  mediaId: string;
  reaction: string | null;
  watchedSeconds: number;
  completions: number;
  replays: number;
  quickSkips: number;
}

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 2),
  );
}

function stableRandom(seed: string, id: string): number {
  let hash = 2166136261;
  for (const character of `${seed}:${id}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function signalStrength(signal: WatchFeedSignal, behaviorEnabled: boolean): number {
  let strength = signal.reaction === "like" ? 5 : signal.reaction === "dislike" ? -6 : 0;
  if (behaviorEnabled) {
    strength += Math.min(signal.watchedSeconds / 60, 3) * 0.12;
    strength += Math.min(signal.completions, 3) * 0.8;
    strength += Math.min(signal.replays, 3) * 0.25;
    strength -= Math.min(signal.quickSkips, 3) * 0.35;
  }
  return strength;
}

function addGroupValue(
  groups: Map<string, { total: number; count: number }>,
  key: string | null,
  value: number,
) {
  if (!key) return;
  const group = groups.get(key) ?? { total: 0, count: 0 };
  group.total += value;
  group.count += 1;
  groups.set(key, group);
}

function groupAverage(groups: Map<string, { total: number; count: number }>, key: string | null) {
  if (!key) return 0;
  const group = groups.get(key);
  return group ? group.total / group.count : 0;
}

/**
 * Deterministically blends the account's own preference signals with seeded
 * exploration. Explicit reactions are stronger than viewing behavior.
 */
export function rankWatchFeed(
  items: WatchFeedCandidate[],
  signals: WatchFeedSignal[],
  seed: string,
  behaviorEnabled: boolean,
): string[] {
  if (items.length < 2) return items.map((item) => item.id);
  const byId = new Map(signals.map((signal) => [signal.mediaId, signal]));
  const byCollection = new Map<string, { total: number; count: number }>();
  const byType = new Map<string, { total: number; count: number }>();
  const byToken = new Map<string, { total: number; count: number }>();
  const tokensById = new Map<string, Set<string>>();

  for (const item of items) {
    tokensById.set(item.id, titleTokens(item.title));
    const signal = byId.get(item.id);
    if (!signal) continue;
    const strength = signalStrength(signal, behaviorEnabled);
    addGroupValue(byCollection, item.collection?.toLowerCase() ?? null, strength);
    addGroupValue(byType, item.mediaType, strength);
    for (const token of tokensById.get(item.id) ?? []) {
      addGroupValue(byToken, token, strength);
    }
  }

  const affinity = new Map<string, number>();
  for (const candidate of items) {
    const direct = byId.get(candidate.id);
    const candidateTokens = tokensById.get(candidate.id) ?? new Set<string>();
    const tokenAffinity = [...candidateTokens].reduce(
      (total, token) => total + groupAverage(byToken, token),
      0,
    ) / Math.max(1, candidateTokens.size);
    const score =
      (direct ? signalStrength(direct, behaviorEnabled) : 0) +
      0.45 *
        (groupAverage(byCollection, candidate.collection?.toLowerCase() ?? null) +
          groupAverage(byType, candidate.mediaType) * 0.2 +
          tokenAffinity * 0.5);
    affinity.set(candidate.id, score);
  }

  const sortedAffinity = [...affinity.entries()].sort((a, b) => a[1] - b[1]);
  const affinityRank = new Map<string, number>();
  for (let start = 0; start < sortedAffinity.length;) {
    let end = start + 1;
    while (end < sortedAffinity.length && sortedAffinity[end]?.[1] === sortedAffinity[start]?.[1]) end += 1;
    const rank = ((start + end - 1) / 2) / Math.max(1, sortedAffinity.length - 1);
    for (let index = start; index < end; index += 1) {
      const id = sortedAffinity[index]?.[0];
      if (id) affinityRank.set(id, rank);
    }
    start = end;
  }
  const hasExplicitReaction = signals.some((signal) => signal.reaction !== null);
  const learnedWeight = hasExplicitReaction ? 0.65 : 0.45;

  return [...items]
    .sort((a, b) => {
      const scoreA =
        (affinityRank.get(a.id) ?? 0.5) * learnedWeight +
        stableRandom(seed, a.id) * (1 - learnedWeight);
      const scoreB =
        (affinityRank.get(b.id) ?? 0.5) * learnedWeight +
        stableRandom(seed, b.id) * (1 - learnedWeight);
      return scoreB - scoreA || a.id.localeCompare(b.id);
    })
    .map((item) => item.id);
}
