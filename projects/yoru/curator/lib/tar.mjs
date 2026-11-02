// Sequential reader for a remote tar file using HTTP range requests.
// Lets the curator pull single images out of a 7.6 GB shard without downloading it.
const BLOCK = 512;

export class RangedTar {
  constructor(url, { fetchImpl = fetch } = {}) {
    this.url = url;
    this.fetchImpl = fetchImpl;
    this.pos = 0;
    this.total = null;
  }

  async size() {
    if (this.total !== null) return this.total;
    const res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(30000), headers: { Range: "bytes=0-0" } });
    if (res.status !== 206) throw new Error(`range not supported (HTTP ${res.status})`);
    const cr = res.headers.get("content-range") || "";
    const m = cr.match(/\/(\d+)$/);
    if (!m) throw new Error(`cannot read total size from "${cr}"`);
    await res.arrayBuffer();
    this.total = Number(m[1]);
    return this.total;
  }

  async readAt(offset, length) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 64*1024*1024) throw new Error("Invalid or oversized image range");
    const end = offset + length - 1;
    const res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(30000), headers: { Range: `bytes=${offset}-${end}` } });
    if (res.status !== 206) throw new Error(`unexpected HTTP ${res.status} for range ${offset}-${end}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length !== length) throw new Error(`short read at ${offset}: got ${buf.length}/${length}`);
    return buf;
  }

  // Returns {name, size, type, dataOffset, nextOffset} or null at end of archive.
  async nextEntry(offset) {
    const total = await this.size();
    if (offset + BLOCK > total) return null;
    const header = await this.readAt(offset, BLOCK);
    if (header.every((b) => b === 0)) return null;

    const name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
    if (!name) return null;
    const sizeField = header.toString("utf8", 124, 136).replace(/\0.*$/, "").trim();
    const size = sizeField ? parseInt(sizeField, 8) : 0;
    if (!Number.isFinite(size) || size < 0) throw new Error(`bad tar entry size for ${name}`);
    const type = String.fromCharCode(header[156] || 48);

    const dataOffset = offset + BLOCK;
    const nextOffset = dataOffset + Math.ceil(size / BLOCK) * BLOCK;
    return { name, size, type, dataOffset, nextOffset };
  }

  async readEntry(entry) {
    return this.readAt(entry.dataOffset, entry.size);
  }
}

export function isImageEntry(name) {
  return /\.(jpe?g|png|webp|gif)$/i.test(name) && !name.endsWith("/");
}

export function postIdFromName(name) {
  const base = name.split("/").pop() || "";
  const m = base.match(/^(\d+)\./);
  return m ? m[1] : null;
}
