#!/usr/bin/env node
// Store uta's local settings: the Spotify client id, nothing else.
//
//   node scripts/uta-config.mjs spotify <clientId> [clientSecret]
//   node scripts/uta-config.mjs show
//
// Written to {data}/uta/config.json, mode 0600. Not in the repository, not in a
// release, not in the shell history of a manifest.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DATA = path.join(process.env.AYAMAI_DATA ?? path.join(process.env.HOME ?? ".", ".local/share/ayamai"), "uta");
const FILE = path.join(DATA, "config.json");

const read = () => { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; } };

const [what, ...rest] = process.argv.slice(2);

if (what === "show" || !what) {
  const config = read();
  console.log("file      " + FILE);
  console.log("client id " + (config.spotifyClientId ? config.spotifyClientId.slice(0, 6) + "…" : "(unset)"));
  console.log("secret    " + (config.spotifyClientSecret ? "set" : "(unset, PKCE does not need one)"));
  console.log("redirect  " + (config.spotifyRedirect ?? "http://127.0.0.1:25222/uta/api/spotify/callback"));
  process.exit(0);
}

if (what !== "spotify") {
  console.error("usage: uta-config.mjs spotify <clientId> [clientSecret]  |  show");
  process.exit(2);
}

const [clientId, clientSecret] = rest;
if (!clientId) {
  console.error("a client id is required");
  process.exit(2);
}

mkdirSync(DATA, { recursive: true });
const config = { ...read(), spotifyClientId: clientId.trim() };
if (clientSecret) config.spotifyClientSecret = clientSecret.trim();
writeFileSync(FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log("wrote " + FILE);
console.log("restart uta so it picks this up: pkill -f projects/uta/server.mjs, then ayamai up uta");
