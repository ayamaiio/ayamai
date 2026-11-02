import type { PostAnnotation, PostAnnotationInput } from "@workspace/api-client-react";

export const MAX_TAGS = 40;
export const MAX_TAG_LEN = 80;
export const MAX_ATTR_KEYS = 20;
export const MAX_ATTR_VALUES = 12;
export const MAX_NOTES = 5000;

/** Client mirror of the server canonical form: NFKC, lowercase, no leading #, whitespace -> hyphen. */
export function canonicalTag(raw: string) {
  return raw.normalize("NFKC").toLowerCase().trim().replace(/^#+/, "").trim().replace(/\p{Cf}/gu, "").replace(/\s+/g, "-");
}

export function addTags(current: string[], text: string) {
  const out = [...current];
  for (const part of text.split(/[,\n]/)) {
    const tag = canonicalTag(part);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

export type AttrRow = { key: string; name: string; values: string };

export type AnnotationDraft = {
  tags: string[];
  attrs: AttrRow[];
  notes: string;
  reviewStatus: PostAnnotation["reviewStatus"];
  confidence: PostAnnotation["confidence"];
  sourceUrl: string;
};

let rowSeq = 0;
export const newRow = (name = "", values = ""): AttrRow => ({ key: `row-${++rowSeq}`, name, values });

export function draftFrom(a: PostAnnotation | undefined): AnnotationDraft {
  return {
    tags: a?.tags ?? [],
    attrs: Object.entries(a?.attributes ?? {}).map(([k, v]) => newRow(k, v.join(", "))),
    notes: a?.notes ?? "",
    reviewStatus: a?.reviewStatus ?? "draft",
    confidence: a?.confidence ?? "unsure",
    sourceUrl: a?.sourceUrl ?? "",
  };
}

const attrName = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "-");
const splitValues = (s: string) => Array.from(new Set(s.split(",").map((v) => v.trim()).filter(Boolean)));

/** Returns per-row error messages keyed by row key, plus a general error. */
export function validateDraft(d: AnnotationDraft) {
  const rows: Record<string, string> = {};
  const seen = new Set<string>();
  let general = "";
  const filled = d.attrs.filter((r) => r.name.trim() || r.values.trim());
  for (const r of filled) {
    const name = attrName(r.name);
    if (!name) rows[r.key] = "Give this attribute a name.";
    else if (name.length > 40 || !/^[\p{L}\p{N}\p{M}_-]+$/u.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) rows[r.key] = "Use a nonreserved name with letters, numbers, - or _ (max 40).";
    else if (seen.has(name)) rows[r.key] = "Duplicate attribute name.";
    else if (splitValues(r.values).length === 0) rows[r.key] = "Add at least one value.";
    else if (splitValues(r.values).length > MAX_ATTR_VALUES) rows[r.key] = `At most ${MAX_ATTR_VALUES} values.`;
    else if (splitValues(r.values).some((v) => v.length > MAX_TAG_LEN)) rows[r.key] = `Values max ${MAX_TAG_LEN} characters.`;
    seen.add(name);
  }
  if (filled.length > MAX_ATTR_KEYS) general = `At most ${MAX_ATTR_KEYS} attributes.`;
  if (d.notes.length > MAX_NOTES) general = `Notes max ${MAX_NOTES} characters.`;
  if (d.tags.length > MAX_TAGS) general = `At most ${MAX_TAGS} hashtags. Remove extra tags to save.`;
  if (d.tags.some((tag) => tag.length > MAX_TAG_LEN || !/^[\p{L}\p{N}\p{M}_-]+$/u.test(tag))) general = `Hashtags need letters, numbers, - or _ (max ${MAX_TAG_LEN}).`;
  const url = d.sourceUrl.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || url.length > 2000) general = "Source must be an HTTPS link without credentials (max 2000).";
    } catch { general = "Source must be a valid public HTTPS link."; }
  }
  return { rows, general, ok: !general && Object.keys(rows).length === 0 };
}

export function toInput(d: AnnotationDraft, expectedRevision: number): PostAnnotationInput {
  const attributes: Record<string, string[]> = {};
  for (const r of d.attrs) {
    const name = attrName(r.name);
    if (name) attributes[name] = splitValues(r.values);
  }
  const url = d.sourceUrl.trim();
  return { expectedRevision, tags: d.tags, attributes, notes: d.notes, reviewStatus: d.reviewStatus, confidence: d.confidence, sourceUrl: url ? url : null };
}

export const sameDraft = (a: AnnotationDraft, b: AnnotationDraft) => JSON.stringify(toInput(a, 0)) === JSON.stringify(toInput(b, 0));
