// Decision log, per-collection like storage, and resume cursors.
import fs from "node:fs";
import path from "node:path";

export class Store {
  constructor(dir, { legacyCollection } = {}) {
    this.dir = dir;
    this.legacyCollection = legacyCollection ?? null;
    this.likesRoot = path.join(dir, "likes");
    fs.mkdirSync(this.likesRoot, { recursive: true });
    this.stateFile = path.join(dir, "state.jsonl");
    this.fd = fs.openSync(this.stateFile, "a");
    this.rows = [];
    if (fs.existsSync(this.stateFile)) {
      for (const line of fs.readFileSync(this.stateFile, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          // Rows written before collections existed belong to the legacy source.
          if (!row.collection) row.collection = this.legacyCollection;
          this.rows.push(row);
        } catch {}
      }
    }
    this.decided = new Set(this.rows.map((r) => this.key(r.collection, r.id)));
  }

  key(collection, id) {
    return `${collection ?? this.legacyCollection}::${id}`;
  }

  isDecided(collection, id) {
    return this.decided.has(this.key(collection, id));
  }

  last() {
    return this.rows.length ? this.rows[this.rows.length - 1] : null;
  }

  likeDir(collection) {
    return path.join(this.likesRoot, collection);
  }

  record(row) {
    this.rows.push(row);
    this.decided.add(this.key(row.collection, row.id));
    fs.writeSync(this.fd, JSON.stringify(row) + "\n");
    fs.fsyncSync(this.fd);
  }

  like({ collection, id, ext, buf, meta, cursor, entry, dataset, shard }) {
    const dir = this.likeDir(collection);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${id}.${ext}`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
    const sidecar = {
      id: String(id),
      collection,
      added_at: new Date().toISOString(),
      source: { dataset, collection, shard, entry, entry_size: entry.size, data_offset: entry.dataOffset },
      danbooru: meta || null,
      tags: meta?.tags ? [...meta.tags.copyright, ...meta.tags.character, ...meta.tags.artist, ...meta.tags.general] : [],
      rating: meta?.rating ?? null,
      score: meta?.score ?? null,
    };
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(sidecar, null, 2));
  }

  // Kept images across every collection, newest last. Legacy flat files included.
  keeps(collection) {
    const out = [];
    const scan = (dir, fallbackCollection) => {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { return; }
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          const sidecar = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
          sidecar.collection = sidecar.collection ?? fallbackCollection;
          out.push(sidecar);
        } catch {}
      }
    };
    if (collection) {
      scan(this.likeDir(collection), collection);
      if (collection === this.legacyCollection) scan(this.likesRoot, this.legacyCollection);
    } else {
      for (const entry of fs.readdirSync(this.likesRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) scan(path.join(this.likesRoot, entry.name), entry.name);
      }
      scan(this.likesRoot, this.legacyCollection);
    }
    return out;
  }

  keepFile(collection, id) {
    const dirs = [this.likeDir(collection)];
    if (collection === this.legacyCollection) dirs.push(this.likesRoot);
    for (const dir of dirs) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      const match = names.find((name) => name.startsWith(`${id}.`) && !name.endsWith(".json"));
      if (match) return path.join(dir, match);
    }
    return null;
  }

  undo() {
    const row = this.rows.pop();
    if (!row) return null;
    this.decided.delete(this.key(row.collection, row.id));
    const keep = this.rows.slice();
    fs.writeFileSync(this.stateFile, keep.map((r) => JSON.stringify(r)).join("\n") + (keep.length ? "\n" : ""));
    if (row.verdict === "like") {
      const dir = this.likeDir(row.collection);
      try {
        for (const name of fs.readdirSync(dir)) {
          if (name === `${row.id}.json` || name.startsWith(`${row.id}.`)) {
            fs.rmSync(path.join(dir, name), { force: true });
          }
        }
      } catch {}
    }
    return row;
  }
}
