// What to run, and the one place that runs it.
//
// The argv is built by a pure function so a test can read it; the spawn is the
// only side effect in the project and it never goes through a shell.
import { spawn } from "node:child_process";
import path from "node:path";

/** Pure: WSL path → the Windows path the host understands. */
export function toWindows(unixPath) {
  return String(unixPath ?? "")
    .replace(/^\/mnt\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`)
    .replace(/\//g, "\\");
}

const started = (url) => ({ command: "cmd.exe", args: ["/c", "start", "", url] });

/**
 * Pure: the command for one library entry, or the reason there is none.
 * `entry` is whatever /api/state handed the page, so this doubles as the
 * server-side validation of a launch request.
 */
export function launchCommand(entry, { romRoot } = {}) {
  if (!entry || typeof entry !== "object") return { error: "no entry" };

  if (entry.kind === "steam") {
    if (!/^\d+$/.test(String(entry.id ?? ""))) return { error: "steam id must be numeric" };
    return started(`steam://run/${entry.id}`);
  }
  if (entry.kind === "epic") {
    if (!String(entry.id ?? "").trim()) return { error: "epic id is required" };
    return started(`com.epicgames.launcher://apps/${encodeURIComponent(entry.id)}?action=launch&silent=true`);
  }
  if (entry.kind === "gog" || entry.kind === "itch") {
    if (!entry.exe) return { error: `${entry.kind} has no executable` };
    return { command: "cmd.exe", args: ["/c", "start", "", toWindows(entry.exe)] };
  }
  if (entry.kind === "folder") {
    if (!entry.folder) return { error: "no folder" };
    if (!romRoot) return { error: "no ROM library configured" };
    const root = path.resolve(romRoot);
    const folder = path.resolve(root, String(entry.folder));
    if (folder !== root && !folder.startsWith(`${root}${path.sep}`)) return { error: "outside the ROM library" };
    return { command: "explorer.exe", args: [toWindows(folder)] };
  }
  if (entry.kind === "emulator") {
    if (!entry.exe) return { error: "emulator has no executable" };
    return { command: "cmd.exe", args: ["/c", "start", "", toWindows(entry.exe)] };
  }
  if (entry.kind === "rom") {
    if (!entry.exe) return { error: "no emulator covers this system" };
    if (!romRoot) return { error: "no ROM library configured" };
    const root = path.resolve(romRoot);
    const file = path.resolve(root, String(entry.rom ?? ""));
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) return { error: "outside the ROM library" };
    return { command: "cmd.exe", args: ["/c", "start", "", toWindows(entry.exe), toWindows(file)] };
  }
  return { error: `unknown kind "${entry.kind}"` };
}

/** Run it, detached: the game outlives the request. */
export function launch(entry, options) {
  const plan = launchCommand(entry, options);
  if (plan.error) return { ok: false, error: plan.error };
  try {
    spawn(plan.command, plan.args, { detached: true, stdio: "ignore" }).unref();
    return { ok: true, ran: [plan.command, ...plan.args].join(" ") };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}
