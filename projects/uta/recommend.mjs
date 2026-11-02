// What to play next, and why.
//
// Deterministic on purpose: the same library and history always give the same
// answer, so the reason can be trusted. The weights are a starting point, not a
// truth — they are named here so they can be argued with.
export const WEIGHTS = { artist: 0.55, staleness: 0.25, novelty: 0.2, justPlayed: 0.9 };
export const LOOKBACK_DAYS = 30;
export const RECENT_TRACKS = 10;
export const RECENT_MS = 30 * 60 * 1000;
/** The last ten plays only block repeats while the session is still young. */
export const SESSION_MS = 3 * 60 * 60 * 1000;

const DAY = 24 * 60 * 60 * 1000;

/** The plays that still matter for taste: the last 30 days, newest first. */
export function recentPlays(plays = [], now = Date.now()) {
  return plays.filter((play) => Number.isFinite(play.at) && now - play.at <= LOOKBACK_DAYS * DAY);
}

/**
 * Pure: pick a track and explain it.
 * @returns {{track: object|null, why: string, score: number}}
 */
export function chooseNext({ tracks = [], plays = [], seed = null, now = Date.now() } = {}) {
  if (!tracks.length) return { track: null, why: "nothing in the library yet", score: 0 };

  const window = recentPlays(plays, now);
  const playedIds = new Map(); // id → most recent play time
  for (const play of window) {
    const previous = playedIds.get(play.id) ?? 0;
    if (play.at > previous) playedIds.set(play.id, play.at);
  }

  // Never repeat the current session (the last ten plays within three hours), nor
  // anything from the last half hour. A play from days ago is history, not a
  // reason to skip the artist you actually listen to.
  const lastTen = plays
    .filter((play) => now - play.at <= SESSION_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT_TRACKS)
    .map((play) => play.id);
  const recent = new Set(lastTen);
  const fresh = new Set(plays.filter((play) => now - play.at <= RECENT_MS).map((play) => play.id));

  const artistPlays = new Map();
  for (const play of window) {
    if (play.skipped) continue;
    const artist = play.artist ?? null;
    if (artist) artistPlays.set(artist, (artistPlays.get(artist) ?? 0) + 1);
  }
  // Spotify's top artists count as plays you have not made yet.
  const seeded = new Map();
  for (const [name, weight] of Object.entries(seed?.artists ?? {})) {
    if (!name) continue;
    seeded.set(name, Math.max(0, Number(weight) || 0));
  }
  const maxArtist = Math.max(1, ...artistPlays.values(), ...seeded.values());

  const ranked = tracks
    .filter((track) => !recent.has(track.id) && !fresh.has(track.id))
    .map((track) => {
      const artist = track.artist ?? null;
      const played = artist ? (artistPlays.get(artist) ?? 0) : 0;
      const taste = artist ? (seeded.get(artist) ?? 0) : 0;
      const affinity = artist ? Math.max(played, taste) / maxArtist : 0;
      const last = playedIds.get(track.id) ?? null;
      const days = last === null ? null : (now - last) / DAY;
      const staleness = days === null ? 0 : 1 / (1 + days);
      const novelty = last === null ? 1 : 0.3;

      const score = WEIGHTS.artist * affinity + WEIGHTS.staleness * staleness + WEIGHTS.novelty * novelty;
      return { track, score, affinity, staleness, novelty, days, seeded: Boolean(artist && seeded.has(artist)) };
    })
    .sort((a, b) => b.score - a.score || String(a.track.id).localeCompare(String(b.track.id)));

  if (!ranked.length) return { track: null, why: "everything here was played recently", score: 0 };

  const best = ranked[0];
  return { track: best.track, why: explain(best), score: Number(best.score.toFixed(3)) };
}

/** Pure: the sentence shown under the next button. */
export function explain(candidate) {
  const { track, affinity, days } = candidate;
  const parts = [];
  if (track.artist) parts.push(`${track.artist}`);
  if (candidate.seeded && candidate.affinity > 0) parts.push("from your Spotify top artists");
  else if (affinity > 0) parts.push(`you played them ${Math.round(affinity * 10) / 10} of your max this month`);
  else parts.push("new to you");
  if (days === null) parts.push("never played");
  else if (days < 1) parts.push("heard today");
  else parts.push(`not heard in ${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
