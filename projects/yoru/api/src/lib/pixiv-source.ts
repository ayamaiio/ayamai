/**
 * Pure: the `Source:` line the lens SQL already understands.
 *
 * `Source: <kind>/[<creator>]/<id>` is the format local imports use, and the
 * existing kindSql / creatorSql / setSql derive their three lenses from it. A
 * captured pixiv post earns the same treatment instead of a fourth mechanism.
 */
export function pixivSourceLine(artist: string, pageUrl: string): string {
  const clean = String(artist ?? "").replace(/[\[\]\/\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const id = /pixiv\.net\/(?:[a-z]{2}\/)?artworks\/(\d+)/i.exec(String(pageUrl ?? ""))?.[1] ?? "";
  if (!clean && !id) return "";
  const kind = id ? "pixiv" : "web";
  return `Source: ${kind}${clean ? `/[${clean}]` : ""}${id ? `/${id}` : ""}`;
}
