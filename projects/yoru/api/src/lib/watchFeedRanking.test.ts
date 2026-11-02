import assert from "node:assert/strict";
import test from "node:test";
import { rankWatchFeed } from "./watchFeedRanking";

const items = [
  { id: "like", title: "Coast sunset", collection: "Outdoors", mediaType: "image" },
  { id: "related", title: "Coast morning", collection: "Outdoors", mediaType: "image" },
  { id: "other", title: "Studio portrait", collection: "People", mediaType: "video" },
];

test("feed order is stable for a seed and differs across seeds", () => {
  const first = rankWatchFeed(items, [], "session-one", true);
  assert.deepEqual(rankWatchFeed(items, [], "session-one", true), first);
  assert.notDeepEqual(rankWatchFeed(items, [], "session-two", true), first);
  assert.equal(new Set(first).size, items.length);
});

test("pagination slices one unique cycle without repeated items", () => {
  const order = rankWatchFeed(items, [], "paged-session", true);
  const pages = [order.slice(0, 2), order.slice(2, 4)].flat();
  assert.deepEqual(pages, order);
  assert.equal(new Set(pages).size, items.length);
});

test("explicit reactions influence related items more than inferred behavior", () => {
  const signals = [
    { mediaId: "like", reaction: "like", watchedSeconds: 0, completions: 0, replays: 0, quickSkips: 0 },
  ];
  for (let sample = 0; sample < 20; sample += 1) {
    const ranked = rankWatchFeed(items, signals, `reaction-seed-${sample}`, true);
    assert.ok(ranked.indexOf("like") < ranked.indexOf("other"));
  }
  const ranked = rankWatchFeed(items, signals, "reaction-seed", true);
  assert.ok(ranked.indexOf("related") < ranked.indexOf("other"));
});

test("disabled behavior excludes inferred signals but preserves explicit reactions", () => {
  const inferredOnly = [
    { mediaId: "other", reaction: null, watchedSeconds: 180, completions: 3, replays: 3, quickSkips: 0 },
  ];
  assert.deepEqual(
    rankWatchFeed(items, inferredOnly, "disabled-seed", false),
    rankWatchFeed(items, [], "disabled-seed", true),
  );
  const disliked = [
    { mediaId: "like", reaction: "dislike", watchedSeconds: 0, completions: 0, replays: 0, quickSkips: 0 },
  ];
  assert.deepEqual(
    rankWatchFeed(items, disliked, "disabled-seed", false),
    rankWatchFeed(items, disliked, "disabled-seed", true),
  );
});
