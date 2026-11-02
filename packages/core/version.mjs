// One dated version for the whole ecosystem.
//
// YYYY.MM.DD, UTC. If the same day is released twice the patch is .1, .2 — a
// second release on a Tuesday is normal, not an error.
export function calver(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
}

const PATTERN = /^(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/;

/** Pure: the next version for a day, given what is already taken. */
export function nextVersion(current, date = new Date()) {
  const today = calver(date);
  const currentText = String(current ?? "");
  if (currentText === today) return `${today}.1`;
  const match = PATTERN.exec(currentText);
  if (match && currentText.startsWith(today)) return `${today}.${Number(match[4] ?? 0) + 1}`;
  return today;
}

/** Pure: a release tag is a version. `release/2026.11.02-8` → `2026.11.02.8`. */
export function versionForTag(tag) {
  const match = /^release\/(\d{4}\.\d{2}\.\d{2})-(\d+)$/.exec(String(tag ?? ""));
  return match ? `${match[1]}.${match[2]}` : null;
}

export function parseVersion(text) {
  const match = PATTERN.exec(String(text ?? ""));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), patch: match[4] ? Number(match[4]) : null };
}

/** Pure: every version a tree declares, from the catalog and the manifests. */
export function versionsOf({ catalog = {}, manifests = [] } = {}) {
  const found = [];
  for (const entry of catalog.entries ?? []) found.push({ id: entry.id, version: entry.version, file: "catalog.json" });
  for (const manifest of manifests) found.push({ id: manifest.id, version: manifest.version, file: manifest.file });
  return found;
}

/** Pure: do they all agree? */
export function agree(versions) {
  const distinct = [...new Set(versions.map((entry) => String(entry.version ?? "")))];
  if (distinct.length === 1 && distinct[0]) return { ok: true, version: distinct[0] };
  return { ok: false, versions: distinct, mismatch: versions.filter((entry) => String(entry.version) !== distinct[0]) };
}
