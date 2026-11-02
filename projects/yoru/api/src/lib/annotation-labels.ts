export class LabelValidationError extends Error {}

export function canonicalHashtag(input: string): string {
  const tag = input.normalize("NFKC").trim().replace(/^#+/, "").trim().replace(/\p{Cf}/gu, "")
    .toLowerCase().replace(/\s+/g, "-");
  if (!tag || tag.length > 80 || !/^[\p{L}\p{N}\p{M}_-]+$/u.test(tag)) {
    throw new LabelValidationError("Use hashtags with letters, numbers, underscores or hyphens (up to 80 characters).");
  }
  return tag;
}

export function canonicalAttributes(input: Record<string, string[]>): Record<string, string[]> {
  // Drizzle inspects object prototypes when serializing JSONB updates.
  // Reserved keys are rejected below instead of using a null-prototype object.
  const output: Record<string, string[]> = {};
  if (Object.keys(input).length > 20) throw new LabelValidationError("Use at most 20 structured attributes.");
  for (const [rawKey, rawValues] of Object.entries(input)) {
    const key = canonicalHashtag(rawKey);
    if (key.length > 40 || Object.hasOwn(output, key) || ["__proto__", "constructor", "prototype"].includes(key)) {
      throw new LabelValidationError("Structured attribute names must be distinct and at most 40 characters.");
    }
    const values = [...new Set(rawValues.map((value) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ")))];
    if (values.length > 12 || values.some((value) => !value || value.length > 80)) {
      throw new LabelValidationError("Each attribute needs up to 12 nonempty values of at most 80 characters.");
    }
    output[key] = values;
  }
  return output;
}

export function canonicalSourceUrl(input?: string | null): string | null {
  if (!input?.trim()) return null;
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new LabelValidationError("Use a valid public HTTPS source URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2000) {
    throw new LabelValidationError("Use a public HTTPS source URL without credentials.");
  }
  // Provenance is not a credential vault. Never retain signed query strings,
  // OAuth codes, fragments (including MEGA keys), or URL-embedded passwords.
  url.search = "";
  url.hash = "";
  return url.href;
}
