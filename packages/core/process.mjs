// Is the process serving a file older than the file?
//
// A service keeps running the code it started with. After an edit, the file is
// newer than the process until someone restarts it — and nothing used to say so.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

/** Two seconds of grace: a service that starts during a build must not flap. */
export const STALE_TOLERANCE = 2000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Pure: `ps -o lstart=` prints “Mon Nov  2 02:20:39 2026”. Date.parse is not
 * reliable on that shape across platforms, so it is parsed here.
 */
export function parsePsStart(text) {
  const match = String(text ?? "").trim().match(/\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]);
  if (month < 0) return null;
  const [, , day, hh, mm, ss, year] = match;
  const at = new Date(Number(year), month, Number(day), Number(hh), Number(mm), Number(ss));
  return Number.isNaN(at.getTime()) ? null : at.getTime();
}

/** When the process started, or null where we cannot tell (Windows). */
export function processStartTime(pid, { platform = process.platform } = {}) {
  if (!Number.isInteger(pid) || platform === "win32") return null;
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", timeout: 2500 });
    return parsePsStart(out);
  } catch {
    return null;
  }
}

/** Pure: the process predates the code it is serving. */
export function isStale({ startMs, fileMtime, tolerance = STALE_TOLERANCE } = {}) {
  if (!Number.isFinite(startMs) || !Number.isFinite(fileMtime)) return null;
  return startMs < fileMtime - tolerance;
}

/** The newest modification time among the files a service serves. */
export function newestMtime(files = []) {
  let newest = null;
  for (const file of files) {
    try {
      const at = statSync(file).mtimeMs;
      if (newest === null || at > newest) newest = at;
    } catch { /* a missing file is not evidence of freshness */ }
  }
  return newest;
}

/** Pure: the one-line verdict a panel or a doctor check prints. */
export function staleness({ pid, files } = {}, options = {}) {
  const startMs = processStartTime(pid, options);
  const fileMtime = newestMtime(files);
  const stale = isStale({ startMs, fileMtime });
  return { pid: pid ?? null, startMs, fileMtime, stale };
}
