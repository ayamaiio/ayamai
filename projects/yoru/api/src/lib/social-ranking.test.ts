import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { rankSocialPosts, preferenceStrength, ratingStrength, type RankedPost, type Preference } from "./social-ranking";
import { rankWatchFeed } from "./watchFeedRanking";

const now = Date.UTC(2026, 9, 29);
const candidates: RankedPost[] = Array.from({ length: 120 }, (_, i) => ({
  id: `post-${i}`, tags: [`topic-${i % 8}`, i % 2 ? "drawing" : "photo"],
  creator: `profile-${i % 20}`, mediaType: i % 3 ? "image" : "video",
  createdAt: new Date(now - (i % 20) * 86400000), durationSeconds: 30,
}));
const preference = (id: string, reaction: string | null): Preference => ({
  mediaId: id, reaction, watchedSeconds: 0, completions: 0, replays: 0, quickSkips: 0, updatedAt: new Date(now),
});
const signals = [preference("post-0", "like"), preference("post-8", "like"), preference("post-16", "like"), preference("post-1", "dislike")];
const opts = { candidates, history: candidates, signals, collaborative: new Map<string, number>(), popularity: new Map<string, { positive: number; support: number }>(), behavior: true, now };
test("hybrid order is deterministic, unique, seed-diverse, and excludes explicit negatives", () => {
  const a = rankSocialPosts({ ...opts, seed: "a" });
  assert.deepEqual(a, rankSocialPosts({ ...opts, seed: "a" }));
  assert.equal(a.length, candidates.length - 1); assert.equal(new Set(a).size, a.length);
  assert.ok(!a.includes("post-1")); assert.notDeepEqual(a, rankSocialPosts({ ...opts, seed: "b" }));
});
test("screen-aware duration preference is soft, directional and includes unknown lengths", () => {
  const items = [30, 60, 180, 600, 1800, null].map((durationSeconds, i) => ({
    ...candidates[i], id: `duration-${i}`, tags: [], creator: null, mediaType: "video", durationSeconds,
  }));
  let mobile = 0, desktop = 0;
  for (let seed = 0; seed < 60; seed++) {
    const input = { ...opts, candidates: items, history: [], signals: [], seed: String(seed) };
    const short = rankSocialPosts({ ...input, lengthPreference: "short" });
    const long = rankSocialPosts({ ...input, lengthPreference: "long" });
    assert.equal(short.length, items.length); assert.equal(long.length, items.length);
    const topDuration = (ids: string[]) => ids.slice(0, 2).reduce((n, id) =>
      n + (items.find((p) => p.id === id)!.durationSeconds ?? 180), 0);
    mobile += topDuration(short); desktop += topDuration(long);
    assert.deepEqual(long, rankSocialPosts({ ...input, lengthPreference: "long" }));
  }
  assert.ok(desktop > mobile * 2, `desktop=${desktop}, mobile=${mobile}`);
});
test("duration normalization, opt-out and decay bound implicit feedback below explicit feedback", () => {
  const short = { ...preference("x", null), watchedSeconds: 30 };
  assert.equal(preferenceStrength(short, 30, true, now), preferenceStrength({ ...short, watchedSeconds: 300 }, 300, true, now));
  assert.equal(preferenceStrength(short, 30, false, now), 0);
  assert.ok(preferenceStrength({ ...short, completions: 1000, replays: 1000 }, 30, true, now) < preferenceStrength(preference("x", "like"), 30, true, now));
  assert.ok(preferenceStrength({ ...preference("x", "like"), updatedAt: new Date(now - 120 * 86400000) }, 30, true, now) < 2);
});
test("small popularity samples have no influence and no-consent cold start has a valid diverse fallback", () => {
  const cold = { ...opts, signals: [], seed: "cold" };
  assert.deepEqual(rankSocialPosts(cold), rankSocialPosts({ ...cold, popularity: new Map([["post-0", { support: 4, positive: 4 }]]) }));
  const top = rankSocialPosts(cold).slice(0, 20).map((id) => candidates.find((p) => p.id === id)!);
  assert.ok(new Set(top.map((p) => p.creator)).size >= 5);
  assert.ok(new Set(top.map((p) => p.mediaType)).size === 2);
});
test("personal ratings learn from history without watches, remain bounded and respect explicit dislikes", () => {
  const history = [{ ...candidates[0], id: "rated-history", creator: null, tags: ["topic-0"] }];
  const input = { ...opts, history, signals: [], behavior: false, seed: "ratings" };
  const rating = { mediaId: "rated-history", rating: 5, updatedAt: new Date(now) };
  assert.equal(ratingStrength(rating, now), 2);
  assert.equal(ratingStrength({ ...rating, rating: 1 }, now), -2);
  assert.equal(ratingStrength({ ...rating, rating: 3 }, now), 0);
  assert.equal(ratingStrength({ ...rating, updatedAt: new Date(now - 60 * 86400000) }, now), 1);
  const cold = rankSocialPosts(input);
  assert.deepEqual(cold, rankSocialPosts({ ...input, ratings: [{ ...rating, rating: 3 }] }));
  const positive = rankSocialPosts({ ...input, ratings: [rating] });
  const negative = rankSocialPosts({ ...input, ratings: [{ ...rating, rating: 1 }] });
  const meanPosition = (ids: string[]) => ids.reduce((n, id, i) =>
    n + (candidates.find((p) => p.id === id)!.tags.includes("topic-0") ? i : 0), 0);
  assert.ok(meanPosition(positive) < meanPosition(cold));
  assert.ok(meanPosition(cold) < meanPosition(negative));
  assert.deepEqual(positive, rankSocialPosts({ ...input, ratings: [rating] }));
  assert.ok(!rankSocialPosts({ ...input, signals: [preference("post-0", "dislike")],
    ratings: [{ ...rating, mediaId: "post-0" }] }).includes("post-0"));
});
test("follows improve named-creator discovery without anonymous matching or creator/length lock-in", () => {
  const input = { ...opts, signals: [], seed: "follows", behavior: false };
  const followedCreators = new Set(["profile-0"]);
  const cold = rankSocialPosts(input), warm = rankSocialPosts({ ...input, followedCreators });
  const positions = (ids: string[]) => candidates.filter((p) => p.creator === "profile-0")
    .reduce((n, p) => n + ids.indexOf(p.id), 0);
  assert.ok(positions(warm) < positions(cold));
  assert.deepEqual(warm, rankSocialPosts({ ...input, followedCreators }));
  const anonymous = candidates.map((p) => ({ ...p, creator: null }));
  assert.deepEqual(rankSocialPosts({ ...input, candidates: anonymous }),
    rankSocialPosts({ ...input, candidates: anonymous, followedCreators }));
  // Strong repeated ratings saturate rather than displacing all discovery.
  const ratings = candidates.filter((p) => p.creator === "profile-0")
    .map((p) => ({ mediaId: p.id, rating: 5, updatedAt: new Date(now) }));
  const top = rankSocialPosts({ ...input, followedCreators, ratings, lengthPreference: "long" }).slice(0, 20);
  assert.ok(new Set(top.map((id) => candidates.find((p) => p.id === id)!.creator)).size >= 5);
  const durations = [null, 10, 3600].map((durationSeconds, i) => ({
    ...candidates[i], id: `follow-duration-${i}`, tags: [], creator: "profile-0", mediaType: "video", durationSeconds,
  }));
  assert.deepEqual(rankSocialPosts({ ...input, candidates: durations }),
    rankSocialPosts({ ...input, candidates: durations, followedCreators }));
  assert.deepEqual(new Set(warm), new Set(cold), "follows never restrict candidate membership");
});
test("offline synthetic benchmark reports relevance, negative rate, diversity, coverage, cold start and latency versus baseline", (t) => {
  const summarize = (orders: string[][]) => {
    const top = orders.map((o) => o.slice(0, 10));
    return {
      precisionAt10: top.flat().filter((id) => candidates.find((p) => p.id === id)!.tags.includes("topic-0")).length / (top.length * 10),
      explicitNegativeRate: top.flat().filter((id) => id === "post-1").length / (top.length * 10),
      meanCreatorsAt10: top.reduce((n, ids) => n + new Set(ids.map((id) => candidates.find((p) => p.id === id)!.creator)).size, 0) / top.length,
      coverageAt10: new Set(top.flat()).size / candidates.length,
    };
  };
  const hybrid: string[][] = [], baseline: string[][] = [], cold: string[][] = [];
  const latencies: number[] = [];
  for (let i = 0; i < 50; i++) {
    const seed = `evaluation-${i}`;
    baseline.push(rankWatchFeed(candidates.map((p) => ({ id: p.id, title: p.tags.join(" "), collection: null, mediaType: p.mediaType })), signals, seed, true));
    const start = performance.now();
    hybrid.push(rankSocialPosts({ ...opts, seed })); latencies.push(performance.now() - start);
    cold.push(rankSocialPosts({ ...opts, signals: [], seed }));
  }
  const result = { fixture: "120 benign synthetic posts, 8 topics, 20 creators; topic-0 held-out preference; 50 seeds; no production quality claim",
    baseline: summarize(baseline), hybrid: summarize(hybrid), coldStart: summarize(cold),
    hybridRankP95Ms120Candidates: latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] };
  t.diagnostic(JSON.stringify(result));
  assert.ok(result.hybrid.precisionAt10 >= result.baseline.precisionAt10);
  assert.equal(result.hybrid.explicitNegativeRate, 0);
});
