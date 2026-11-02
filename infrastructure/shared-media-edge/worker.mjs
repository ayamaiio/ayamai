// Cloudflare module Worker. Private R2 binding only; no public bucket or redirects.
// Deliberately no cache API: each GET/HEAD, including every Range, reauthorizes.
const safeHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
function failure(status, extra = {}) {
  return new Response(null, { status, headers: { ...safeHeaders, ...extra } });
}

export function byteRange(value, size) {
  if (value === null) return null;
  if (value.length > 80 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(value) || size === 0) throw new Error("Invalid range");
  const [first, last] = value.slice(6).split("-");
  let start, end;
  if (first === "") {
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new Error("Invalid suffix");
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(first); end = last === "" ? size - 1 : Number(last);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw new Error("Invalid range");
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}

// fetcher injection is solely for deterministic local contract tests/benchmarks.
export async function handleMedia(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (!["GET", "HEAD"].includes(request.method)) return failure(405, { Allow: "GET, HEAD" });
  const match = /^\/streams\/([0-9a-f-]{36})$/i.exec(url.pathname);
  const ticket = url.searchParams.get("ticket");
  if (!match || !ticket || ticket.length > 2048 || url.searchParams.getAll("ticket").length !== 1 ||
      [...url.searchParams.keys()].some(key => key !== "ticket")) return failure(404);
  try {
    const api = new URL(env.AUTH_API_ORIGIN);
    if (api.protocol !== "https:" || api.pathname !== "/" || api.username || api.password || api.search || api.hash ||
        !env.EDGE_SERVICE_SECRET || env.EDGE_SERVICE_SECRET.length < 32 || !env.MEDIA) return failure(503);
    const auth = await fetcher(`${api.origin}/api/edge/media-authorize`, {
      method: "POST",
      headers: { "X-Edge-Authorization": `Bearer ${env.EDGE_SERVICE_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: match[1], ticket }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
    });
    if (!auth.ok) {
      if (auth.status === 404) return failure(404);
      // Fixed retry hint; never forward an arbitrary upstream header/body.
      return failure(auth.status === 429 ? 429 : 503, { "Retry-After": "1" });
    }
    const grant = await auth.json();
    if (typeof grant.objectKey !== "string" || !grant.objectKey || typeof grant.contentType !== "string" ||
        !/^(image|video)\/[a-z0-9.+-]+$/i.test(grant.contentType)) return failure(503);
    const object = await env.MEDIA.head(grant.objectKey);
    if (!object) return failure(404);
    if (!Number.isSafeInteger(object.size) || object.size < 0) return failure(503);
    let range;
    try { range = byteRange(request.headers.get("Range"), object.size); }
    catch { return failure(416, { "Content-Range": `bytes */${object.size}`, "Accept-Ranges": "bytes" }); }
    const headers = {
      ...safeHeaders,
      "Accept-Ranges": "bytes",
      "Content-Type": grant.contentType,
      "Content-Disposition": 'inline; filename="media"',
      "Content-Length": String(range ? range.length : object.size),
    };
    if (range) headers["Content-Range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`;
    if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
    // R2 supports offset/length ranges. Never buffer a full object in Worker memory.
    const body = await env.MEDIA.get(grant.objectKey, range ? { range } : undefined);
    if (!body) return failure(404);
    if (!body.body) return failure(503);
    return new Response(body.body, { status: range ? 206 : 200, headers });
  } catch {
    // Do not expose provider errors, keys, credentials, or grant bodies.
    return failure(503);
  }
}

export default { fetch: (request, env) => handleMedia(request, env) };
