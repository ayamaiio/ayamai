// The library: files we own, and references we saved. No dependencies.
//
// A track is one of two kinds, and the distinction is the whole design:
//   owned      an audio file on disk — we can play it, seek in it, count it
//   reference  a Spotify/YouTube link — metadata and taste only; playback is theirs
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const AUDIO_EXT = new Set([".mp3", ".m4a", ".flac", ".ogg", ".wav"]);
export const VAULT = process.env.AYAMAI_VAULT ?? "/mnt/y/ayamai";
export const MUSIC_DIR = process.env.UTA_LIBRARY ?? path.join(VAULT, "music");

const shortHash = (text) => createHash("sha1").update(text).digest("hex").slice(0, 16);
export const fileId = (relPath) => `file:${shortHash(relPath)}`;
export const linkId = (service, externalId) => `link:${service}:${externalId}`;

/** Pure: the text of one ID3v2 text frame, or null. */
function textFrame(buffer, offset, size, version) {
  if (size < 2) return null;
  const encoding = buffer[offset];
  let body = buffer.subarray(offset + 1, offset + size);
  // v2.4 sizes are syncsafe; v2.3 uses a plain integer. Both are already read
  // by the caller; this only decodes the text.
  let text;
  if (encoding === 0) text = body.toString("latin1");
  else if (encoding === 1) text = body.toString("utf16le").replace(/^\uFEFF/, "");
  else if (encoding === 2) text = body.swap16().toString("utf16le");
  else text = body.toString("utf8");
  text = text.replace(/\0+$/g, "").trim();
  if (!text) return null;
  // v2.3 keeps a leading byte order mark inside the text; drop it if it survived
  return text.replace(/^\uFEFF/, "") || null;
}

/** Pure: ID3v2.3/2.4 tags from the head of an mp3, or null when there is none. */
export function readId3(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return null;
  if (buffer.toString("latin1", 0, 3) !== "ID3") return null;
  const version = buffer[3];
  if (version < 3 || version > 4) return null;

  const size = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
  const end = Math.min(buffer.length, 10 + size);
  const tags = {};
  let offset = 10;

  while (offset + 10 <= end) {
    const id = buffer.toString("latin1", offset, offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding, or something we cannot parse
    const raw = buffer.readUInt32BE(offset + 4);
    const frameSize = version === 4
      ? ((raw >> 24) & 0x7f) << 21 | ((raw >> 16) & 0x7f) << 14 | ((raw >> 8) & 0x7f) << 7 | (raw & 0x7f)
      : raw;
    const start = offset + 10;
    if (frameSize <= 0 || start + frameSize > end) break;

    if (id === "TIT2") tags.title = textFrame(buffer, start, frameSize, version);
    else if (id === "TPE1") tags.artist = textFrame(buffer, start, frameSize, version);
    else if (id === "TALB") tags.album = textFrame(buffer, start, frameSize, version);
    else if (id === "TYER" || id === "TDRC") tags.year = (textFrame(buffer, start, frameSize, version) || "").slice(0, 4) || null;

    offset = start + frameSize;
  }

  const clean = Object.fromEntries(Object.entries(tags).filter(([, value]) => value));
  return Object.keys(clean).length ? clean : null;
}

/** Pure: “Artist - Title” from a filename, when tags are missing. */
export function fromFilename(relPath) {
  const base = path.basename(relPath, path.extname(relPath));
  const split = base.split(" - ");
  if (split.length >= 2) return { artist: split[0].trim(), title: split.slice(1).join(" - ").trim() };
  return { artist: null, title: base.trim() };
}

/** One file → one track. Never throws: a file we cannot read is a track without tags. */
export function describeFile(root, relPath) {
  const absolute = path.join(root, relPath);
  let buffer = null;
  let size = 0;
  try {
    size = statSync(absolute).size;
    const handle = readFileSync(absolute, { flag: "r" }).subarray(0, 256 * 1024);
    buffer = handle;
  } catch { buffer = null; }

  const tags = buffer ? readId3(buffer) : null;
  const fallback = fromFilename(relPath);
  return {
    id: fileId(relPath),
    kind: "owned",
    path: relPath,
    title: tags?.title ?? fallback.title,
    artist: tags?.artist ?? fallback.artist,
    album: tags?.album ?? null,
    year: tags?.year ?? null,
    tags: tags ? "id3" : "filename",
    size,
  };
}

/** Walk the music directory. Missing directory is an empty library, not an error. */
export function scanLibrary(root = MUSIC_DIR) {
  const tracks = [];
  const exists = existsSync(root);
  const walk = (dir, prefix = "") => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(path.join(dir, entry.name), rel); continue; }
      if (!AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      tracks.push(describeFile(root, rel));
    }
  };
  if (exists) walk(root);
  return { dir: root, exists, tracks };
}

/** Pure: which service a link belongs to, and its id. */
export function detectLink(url) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return { service: "link", externalId: shortHash(String(url)) }; }
  const host = parsed.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    if (id) return { service: "youtube", externalId: id };
  }
  if (host.endsWith("youtube.com")) {
    const v = parsed.searchParams.get("v");
    if (v) return { service: "youtube", externalId: v };
    const shorts = parsed.pathname.match(/^\/(?:shorts|embed)\/([\w-]{6,})/);
    if (shorts) return { service: "youtube", externalId: shorts[1] };
  }
  if (host === "open.spotify.com") {
    const track = parsed.pathname.match(/^\/(?:intl-[a-z-]+\/)?track\/([\w]{10,})/);
    if (track) return { service: "spotify", externalId: track[1] };
  }
  return { service: "link", externalId: shortHash(String(url)) };
}

export function oembedUrl(service, url) {
  if (service === "youtube") return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  if (service === "spotify") return `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
  return null;
}

/** Pure: oEmbed JSON → the shape we store. Missing fields stay null. */
export function fromOembed(payload) {
  return {
    title: payload?.title ?? null,
    artist: payload?.author_name ?? null,
    thumb: payload?.thumbnail_url ?? null,
  };
}
