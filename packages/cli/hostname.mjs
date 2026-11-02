// Putting the name on the machine — and taking it off again.
//
// One line in the hosts file is all `ayamai.local` needs; the privileged part is
// writing it. Everything here is pure except `apply` and `remove`, which shell
// out to one elevated command and are printed verbatim by --print-actions.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export const MARKER = "# ayamai";
export const DEFAULT_HOSTNAME = "ayamai.local";

/** Are we inside WSL? Then the browser and its hosts file belong to Windows. */
export function isWsl() {
  try { return /microsoft/i.test(readFileSync("/proc/version", "utf8")); } catch { return false; }
}

/** The hosts file the *browser* uses — Windows' when we are in WSL. */
export function browserHostsFile(platform = process.platform, env = process.env) {
  if (isWsl()) return "/mnt/c/Windows/System32/drivers/etc/hosts";
  return hostFilePath(platform, env);
}

export function hostFilePath(platform = process.platform, env = process.env) {
  if (platform === "win32") return path.win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "drivers", "etc", "hosts");
  return "/etc/hosts";
}

/** Pure: is the entry already there? Tolerates tabs, CRLF and trailing spaces. */
export function hasEntry(text, hostname = DEFAULT_HOSTNAME) {
  return String(text ?? "")
    .split(/\r?\n/)
    .some((line) => {
      const clean = line.replace(/#.*$/, "").trim();
      const parts = clean.split(/\s+/).filter(Boolean);
      return parts.length >= 2 && parts[0] === "127.0.0.1" && parts.slice(1).includes(hostname);
    });
}

/** Pure: append the entry, preserving the file's newline style. Idempotent. */
export function addEntry(text, hostname = DEFAULT_HOSTNAME) {
  const source = String(text ?? "");
  if (hasEntry(source, hostname)) return source;
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const body = source.endsWith(eol) || source === "" ? source : source + eol;
  return `${body}127.0.0.1 ${hostname} ${MARKER}${eol}`;
}

/** Pure: remove only the lines we wrote. */
export function removeEntry(text, hostname = DEFAULT_HOSTNAME) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => !(line.includes(MARKER) && line.includes(hostname)))
    .join("\n");
}

/** What we would run, per platform. Printed by --print-actions; executed by apply(). */
/**
 * WSL: one UAC prompt that writes the Windows hosts file and forwards port 80 to
 * the door. Windows listens; WSL's localhost forwarding carries it home.
 */
export function wslPlan(hostname = DEFAULT_HOSTNAME, doorPort = 25222) {
  const line = `127.0.0.1 ${hostname} # ayamai`;
  const script = [
    `$hosts = 'C:\\Windows\\System32\\drivers\\etc\\hosts'`,
    `$entry = '${line}'`,
    `if (-not (Select-String -Path $hosts -Pattern '${hostname}' -Quiet)) { Add-Content -Path $hosts -Value $entry }`,
    `netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=80 2>$null | Out-Null`,
    `netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=80 connectaddress=127.0.0.1 connectport=${doorPort}`,
  ].join("; ");
  return {
    display: `Add "${line}" to the Windows hosts file and forward TCP 80 → 127.0.0.1:${doorPort}`,
    elevated: ["powershell.exe", ["-NoProfile", "-Command",
      `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',"${script}"`]],
  };
}

export function plan(platform, hostname = DEFAULT_HOSTNAME, file = hostFilePath(platform)) {
  const line = `127.0.0.1 ${hostname} ${MARKER}`;
  if (platform === "win32") {
    return {
      file,
      display: `Add "${line}" to ${file} (elevated)`,
      elevated: [
        "powershell.exe", ["-NoProfile", "-Command",
          `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command',` +
          `"Add-Content -Path '${file}' -Value '${line}'"`],
      ],
    };
  }
  return {
    file,
    display: `Add "${line}" to ${file} (sudo)`,
    elevated: ["sudo", ["sh", "-c", `printf '%s\\n' '${line}' >> '${file}'`]],
  };
}

export function removePlan(platform, hostname = DEFAULT_HOSTNAME, file = hostFilePath(platform)) {
  if (platform === "win32") {
    return ["powershell.exe", ["-NoProfile", "-Command",
      `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command',` +
      `"(Get-Content '${file}') | Where-Object { $_ -notmatch '${hostname}.*${MARKER}' } | Set-Content '${file}'"`]];
  }
  return ["sudo", ["sh", "-c", `sed -i '/${hostname}.*${MARKER}/d' '${file}'`]];
}

export function read(platform = process.platform, file = hostFilePath(platform)) {
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}

function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 120_000 }, (error) => resolve(!error));
  });
}

/** Ask for elevation once. Returns false when the user declines. */
export async function apply(platform = process.platform, hostname = DEFAULT_HOSTNAME) {
  const file = hostFilePath(platform);
  if (hasEntry(read(platform, file), hostname)) return { ok: true, already: true };
  const step = plan(platform, hostname, file);
  const ok = await run(step.elevated[0], step.elevated[1]);
  return { ok, already: false };
}

export async function remove(platform = process.platform, hostname = DEFAULT_HOSTNAME) {
  const file = hostFilePath(platform);
  if (!hasEntry(read(platform, file), hostname)) return { ok: true, already: true };
  const [command, args] = removePlan(platform, hostname, file);
  return { ok: await run(command, args), already: false };
}
