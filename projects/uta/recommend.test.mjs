import test from "node:test";
import assert from "node:assert/strict";

import { chooseNext, explain, recentPlays } from "./recommend.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const tracks = [
  { id: "file:a", title: "Alpha", artist: "A" },
  { id: "file:b", title: "Beta", artist: "B" },
  { id: "file:c", title: "Gamma", artist: "A" },
];

test("an empty library is an answer, not an error", () => {
  const answer = chooseNext({ tracks: [], plays: [], now: NOW });
  assert.equal(answer.track, null);
  assert.match(answer.why, /nothing in the library/);
});

test("nothing played yet picks deterministically, and says so", () => {
  const first = chooseNext({ tracks, plays: [], now: NOW });
  const second = chooseNext({ tracks, plays: [], now: NOW });
  assert.equal(first.track.id, second.track.id, "same state, same answer");
  assert.match(first.why, /never played/);
});

test("the artist you play most comes back, after a gap", () => {
  const plays = [
    { id: "file:a", artist: "A", at: NOW - 20 * DAY },
    { id: "file:c", artist: "A", at: NOW - 19 * DAY },
    { id: "file:a", artist: "A", at: NOW - 18 * DAY },
    { id: "file:b", artist: "B", at: NOW - 40 * DAY },
  ];
  const answer = chooseNext({ tracks, plays, now: NOW });
  assert.equal(answer.track.artist, "A");
  assert.match(answer.why, /A/);
});

test("the last ten plays are excluded, and so is the last half hour", () => {
  const plays = tracks.map((track, index) => ({ id: track.id, artist: track.artist, at: NOW - index * 60_000 }));
  const answer = chooseNext({ tracks, plays, now: NOW });
  assert.equal(answer.track, null, "everything is recent");
  assert.match(answer.why, /played recently/);
});

test("older plays age out of the taste window", () => {
  const ancient = [{ id: "file:a", artist: "A", at: NOW - 90 * DAY }];
  assert.deepEqual(recentPlays(ancient, NOW), []);
  const answer = chooseNext({ tracks, plays: ancient, now: NOW });
  assert.equal(answer.track.id, "file:a", "out of the window, so it is available again");
});

test("the reason names the artist and the gap", () => {
  const line = explain({ track: { artist: "A" }, affinity: 1, days: 9 });
  assert.match(line, /A/);
  assert.match(line, /not heard in 9 days/);
  assert.match(explain({ track: { artist: null }, affinity: 0, days: null }), /new to you/);
});
