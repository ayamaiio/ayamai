import test from "node:test";
import assert from "node:assert/strict";

import { authorizeUrl, describe, mergeSeeds, pkce, seedFromArtists, SCOPES } from "./spotify.mjs";
import { chooseNext } from "./recommend.mjs";

test("the consent URL asks for exactly two scopes and a PKCE challenge", () => {
  const url = new URL(authorizeUrl({ clientId: "abc", redirectUri: "http://127.0.0.1:25222/uta/api/spotify/callback", challenge: "xyz", state: "s1" }));
  assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "xyz");
  assert.equal(url.searchParams.get("scope"), SCOPES.join(" "));
  assert.ok(!url.searchParams.get("scope").includes("streaming"), "no playback scope");
});

test("a verifier and challenge are different, and the challenge is a hash", () => {
  const { verifier, challenge } = pkce();
  assert.ok(verifier.length >= 43);
  assert.notEqual(verifier, challenge);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
});

test("top artists weight by rank, and merge keeps the stronger taste", () => {
  const seed = seedFromArtists(["A", "A", "B", "C", "C"]);
  assert.equal(seed.artists.A, 1);
  assert.ok(seed.artists.B < seed.artists.A);
  assert.equal(seed.count, 3);

  const merged = mergeSeeds(seed, { artists: { B: 0.9 } });
  assert.equal(merged.artists.B, 0.9, "the stronger weight wins");
});

test("the page says what to do with no app and no connection", () => {
  assert.match(describe(null, {}).line, /UTA_SPOTIFY_CLIENT_ID/);
  assert.equal(describe(null, { clientId: "abc" }).state, "disconnected");
  assert.equal(describe({ refreshToken: "t", seed: { artists: { A: 1 } } }, { clientId: "abc" }).state, "connected");
});

test("a seeded artist wins over a track nobody has played", () => {
  const tracks = [
    { id: "file:a", title: "A", artist: "Known" },
    { id: "file:b", title: "B", artist: "Unknown" },
  ];
  const seeded = chooseNext({ tracks, plays: [], seed: { artists: { Known: 1 } }, now: Date.UTC(2026, 10, 2) });
  assert.equal(seeded.track.artist, "Known");
  assert.match(seeded.why, /Spotify/);
});
