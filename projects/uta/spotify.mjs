// Spotify, for the one thing it is good at: it already knows what you like.
//
// The API never gives audio, so this is not playback. It is a seed: your top
// artists and what you played last week become the starting taste before uta has
// a single local play to learn from.
//
// Authorization Code with PKCE, so no client secret is stored on this machine.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SCOPES = ["user-top-read", "user-read-recently-played"];
const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

export const storePath = (data) => path.join(data, "spotify.json");

const b64url = (buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Pure: a verifier and its S256 challenge. */
export function pkce() {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Pure: where the consent screen lives. */
export function authorizeUrl({ clientId, redirectUri, challenge, state }) {
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: SCOPES.join(" "),
  });
  return AUTHORIZE + "?" + query.toString();
}

/** Pure: an ordered list of names becomes weights from 1 down to 0.2. */
export function seedFromArtists(names) {
  const counts = new Map();
  for (const name of names) {
    const key = String(name ?? "").trim();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 50);
  const top = ordered[0]?.[1] ?? 1;
  const artists = {};
  for (const [name, count] of ordered) artists[name] = Math.max(0.2, count / top);
  return { artists, count: ordered.length };
}

export function fromTopTracks(payload) {
  return seedFromArtists((payload?.items ?? []).map((track) => track?.artists?.[0]?.name).filter(Boolean));
}

export function fromRecentlyPlayed(payload) {
  return seedFromArtists((payload?.items ?? []).map((item) => item?.track?.artists?.[0]?.name).filter(Boolean));
}

/** Pure: two seeds, merged. */
export function mergeSeeds(...seeds) {
  const artists = {};
  for (const seed of seeds) {
    for (const [name, weight] of Object.entries(seed?.artists ?? {})) {
      artists[name] = Math.max(artists[name] ?? 0, Number(weight) || 0);
    }
  }
  return { artists, count: Object.keys(artists).length };
}

export function readStore(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

export function writeStore(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + process.pid + ".tmp";
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, file);
}

/** Pure: what the page should say about the connection. */
export function describe(store, { clientId } = {}) {
  if (!clientId) return { state: "unconfigured", line: "no Spotify app yet - set UTA_SPOTIFY_CLIENT_ID" };
  if (!store?.refreshToken) return { state: "disconnected", line: "not connected" };
  const artists = Object.keys(store.seed?.artists ?? {}).length;
  return { state: "connected", line: "connected - " + artists + " artists seeding the deck" };
}

const form = (body) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body).toString(),
});

/** Exchange the code once, for a refresh token. */
export async function completeConnect({ clientId, clientSecret, code, verifier, redirectUri, fetchImpl = fetch }) {
  const body = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  };
  if (clientSecret) body.client_secret = clientSecret;
  const response = await fetchImpl(TOKEN, form(body));
  if (!response.ok) throw new Error("token exchange failed: " + response.status);
  return response.json();
}

export async function refreshToken({ clientId, clientSecret, refreshToken: token, fetchImpl = fetch }) {
  const body = { grant_type: "refresh_token", refresh_token: token, client_id: clientId };
  if (clientSecret) body.client_secret = clientSecret;
  const response = await fetchImpl(TOKEN, form(body));
  if (!response.ok) throw new Error("refresh failed: " + response.status);
  return response.json();
}

/** The seed: top artists, weighted by rank, plus what you played lately. */
export async function fetchSeed(accessToken, fetchImpl = fetch) {
  const auth = { headers: { authorization: "Bearer " + accessToken } };
  const [top, recent] = await Promise.all([
    fetchImpl(API + "/me/top/artists?limit=50&time_range=medium_term", auth).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetchImpl(API + "/me/player/recently-played?limit=50", auth).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const fromTop = { artists: {} };
  for (const [index, artist] of (top?.items ?? []).entries()) {
    if (artist?.name) fromTop.artists[artist.name] = Math.max(0.2, 1 - index / 60);
  }
  return mergeSeeds(fromTop, fromRecentlyPlayed(recent ?? {}));
}
