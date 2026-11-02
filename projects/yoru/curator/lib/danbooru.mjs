// Danbooru metadata lookup with an on-disk cache.
// The 2023 dataset ships images only, so tags/rating come from the public API.
import fs from "node:fs";
import path from "node:path";

const API = "https://danbooru.donmai.us/posts";
const UA = "ayamai-danbooru-curator/1.0 (local personal tool)";

export class MetaCache {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          this.map.set(String(row.id), row);
        } catch {}
      }
    }
    this.fd = fs.openSync(file, "a");
  }

  get(id) {
    return this.map.get(String(id)) || null;
  }

  put(row) {
    this.map.set(String(row.id), row);
    fs.writeSync(this.fd, JSON.stringify(row) + "\n");
  }
}

export async function fetchMeta(id, cache, { timeoutMs = 8000 } = {}) {
  const hit = cache?.get(id);
  if (hit) return hit;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/${id}.json`, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (res.status === 404) {
      const row = { id: String(id), missing: true };
      cache?.put(row);
      return row;
    }
    if (!res.ok) return { id: String(id), unavailable: `HTTP ${res.status}` };
    const p = await res.json();
    const row = {
      id: String(id),
      rating: p.rating || null,
      score: p.score ?? null,
      tags: {
        general: p.tag_string_general ? p.tag_string_general.split(" ").filter(Boolean) : [],
        character: p.tag_string_character ? p.tag_string_character.split(" ").filter(Boolean) : [],
        artist: p.tag_string_artist ? p.tag_string_artist.split(" ").filter(Boolean) : [],
        copyright: p.tag_string_copyright ? p.tag_string_copyright.split(" ").filter(Boolean) : [],
      },
      source: p.source || null,
      created_at: p.created_at || null,
    };
    cache?.put(row);
    return row;
  } catch (err) {
    return { id: String(id), unavailable: err.name === "AbortError" ? "timeout" : String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

export function tagsOf(meta) {
  if (!meta?.tags) return [];
  return [
    ...meta.tags.copyright,
    ...meta.tags.character,
    ...meta.tags.artist,
    ...meta.tags.general,
  ];
}
