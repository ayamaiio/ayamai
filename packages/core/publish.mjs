// Releases: rare, deliberate, and nothing like a normal push.
//
// The rules are pure so they can be tested without git; scripts/publish.mjs does
// the git plumbing and scripts/hook-pre-push.mjs enforces the rule.
export const ORG = "ayamaiio";
export const PROVIDER = "github.com";

/** Pure: is this remote the cold-storage one? */
export function isOrgRemote(url) {
  const text = String(url ?? "");
  return new RegExp(`(^|[/@:])${ORG}/`, "i").test(text);
}

/** Pure: may this push proceed? Local mirrors always; the org only through publish. */
export function allowPush({ url, env = {} } = {}) {
  if (!isOrgRemote(url)) return { ok: true };
  return env.AYAMAI_PUBLISH === "1"
    ? { ok: true, org: true }
    : { ok: false, error: "ayamaiio is release-only — run: ayamai publish" };
}

/** Pure: the release name for a day and a sequence within it. */
export function releaseTag(date, sequence = 1) {
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
  return `release/${stamp}-${sequence}`;
}

/** Pure: the next free release name for a day, given the tags that exist. */
export function nextReleaseTag(tags, date) {
  const day = releaseTag(date, 0).replace(/-0$/, "");
  let highest = 0;
  for (const tag of tags ?? []) {
    if (!String(tag).startsWith(`${day}-`)) continue;
    const sequence = Number(String(tag).slice(day.length + 1));
    if (Number.isInteger(sequence) && sequence > highest) highest = sequence;
  }
  return releaseTag(date, highest + 1);
}

/** Pure: the version a release would carry — the platform entry's, unchanged for now. */
export function proposedVersion(catalog) {
  const entry = (catalog?.entries ?? []).find((candidate) => candidate.kind === "platform");
  return entry?.version ?? "0.0.0";
}

/** Pure: what the confirmation screen prints. */
export function summary({ name, version, branch, commits = [], files = 0, lastRelease = null }) {
  const lines = [
    `release   ${name}`,
    `version   ${version}`,
    `branch    ${branch}`,
    `changes   ${commits.length} commit(s), ${files} file(s) since ${lastRelease ?? "the beginning"}`,
    "",
  ];
  for (const commit of commits.slice(0, 12)) lines.push(`  ${commit}`);
  if (commits.length > 12) lines.push(`  … and ${commits.length - 12} more`);
  lines.push("", `this squashes them into ONE commit on ${ORG}/ayamai and cuts a release.`);
  return lines.join("\n");
}

/** Pure: a snapshot commit message — the only history the org will see. */
export function commitMessage(name, version) {
  return `release ${name}\n\nversion ${version}\nayamaiio cold storage: one commit per release, not the working history.`;
}
