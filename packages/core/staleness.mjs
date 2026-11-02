// Two different kinds of old, named apart because conflating them confuses people.
//
//   stale      a running process is older than the code it serves - restart it
//   neglected  a project has not been touched in a while - nobody is looking
//
// The words are the interface: the panel, the doctor and any future surface use
// these, so "old" never means two things on one screen.

export const STALE_TOLERANCE = 2000;
export const NEGLECTED_DAYS = 14;

const DAY = 24 * 60 * 60 * 1000;

/** Pure: how long ago, in the shortest true words. */
export function relative(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return "never";
  if (value < 60_000) return "just now";
  const days = Math.floor(value / DAY);
  if (days <= 0) {
    const hours = Math.floor(value / (60 * 60 * 1000));
    return hours <= 0 ? Math.floor(value / 60_000) + " min ago" : hours + (hours === 1 ? " hour ago" : " hours ago");
  }
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : months + " months ago";
}

/** Pure: a process started before the code it serves. */
export function isStale({ startMs, fileMtime, tolerance = STALE_TOLERANCE } = {}) {
  if (!Number.isFinite(startMs) || !Number.isFinite(fileMtime)) return null;
  return startMs < fileMtime - tolerance;
}

/** Pure: the words for a stale service. */
export function describeStale({ stale, id = "a service" } = {}) {
  if (stale !== true) return null;
  return { kind: "stale", label: "stale", text: id + " started before its code changed - restart it" };
}

/** Pure: one project's age and workload, and the sentence a panel prints. */
export function summarise({ id, name = id, now = Date.now(), lastCommit = null, open = 0, lastPublish = null } = {}) {
  const at = Number(lastCommit?.at ?? NaN) * 1000 || Number(lastCommit?.at) || null;
  const days = at ? Math.floor((now - at) / DAY) : null;
  const parts = [];

  parts.push(at ? "last touched " + relative(now - at) : "no commits");
  if (Number.isFinite(open) && open >= 0) parts.push(open === 0 ? "nothing open" : open + " open");
  if (lastPublish?.at) parts.push("released " + relative(now - new Date(lastPublish.at).getTime()));

  return {
    id,
    name,
    at,
    days,
    open: Number.isFinite(open) ? open : null,
    neglected: days !== null && days >= NEGLECTED_DAYS,
    line: parts.join(" \u00b7 "),
  };
}

/** Pure: the words for a neglected project. */
export function describeNeglected(project) {
  if (!project?.neglected) return null;
  return { kind: "neglected", label: "neglected", text: project.name + " has not been touched in " + project.days + " days" };
}
