import { openAtLoginSteps } from "./open-at-login.mjs";

// macOS: one LaunchDaemon for port 80, one LaunchAgent to keep the platform up.
//
// Both are rendered from the same facts — the absolute node path, the repo, the
// ports — so `--print-actions` shows byte-for-byte what will be installed.
export const DAEMON_LABEL = "local.ayamai.door";
export const AGENT_LABEL = "local.ayamai.platform";
export const DAEMON_PATH = "/Library/LaunchDaemons/local.ayamai.door.plist";

function xml(text) {
  return String(text).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
}

function plist({ label, program, args, keepAlive = true, env = {}, logs }) {
  const argLines = [program, ...args].map((arg) => `    <string>${xml(arg)}</string>`).join("\n");
  const envLines = Object.entries(env).length
    ? `  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`).join("\n")}
  </dict>
`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argLines}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <${keepAlive ? "true" : "false"}/>
${envLines}  <key>StandardOutPath</key>
  <string>${xml(logs.out)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logs.err)}</string>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`;
}

/** Port 80 → the door. Root, at boot, before anyone logs in. */
export function daemonPlist({ node, repo, listen = 80, door = 25222, logs = { out: "/var/log/ayamai-door.log", err: "/var/log/ayamai-door.err" } }) {
  return plist({
    label: DAEMON_LABEL,
    program: node,
    args: [`${repo}/scripts/forward.mjs`, String(listen), String(door)],
    logs,
  });
}

/** The platform itself: gateway, gehirn, seiri, kata, supervised as one. */
export function agentPlist({ node, repo, logs = { out: "/tmp/ayamai-platform.log", err: "/tmp/ayamai-platform.err" } }) {
  return plist({
    label: AGENT_LABEL,
    program: node,
    args: [`${repo}/scripts/platform-up.mjs`],
    env: { AYAMAI_HOME: repo, PATH: `/usr/local/bin:/opt/homebrew/bin:${node.replace(/\/bin\/node$/, "")}/bin:/usr/bin:/bin` },
    logs,
  });
}

/**
 * The exact shell steps, in order. Printed by --print-actions, executed by
 * `ayamai install`. Everything after the first line needs sudo once.
 */
export function installSteps({ node, repo, user, uid, listen = 80, door = 25222, openAtLogin = true }) {
  const steps = [
    { needsSudo: true, display: `write 127.0.0.1 ayamai.local into /etc/hosts`, shell: `grep -q '[[:space:]]ayamai.local' /etc/hosts || printf '%s\\n' '127.0.0.1 ayamai.local # ayamai' >> /etc/hosts` },
    { needsSudo: true, display: `install the port ${listen} → ${door} LaunchDaemon`, shell: `mkdir -p /Library/LaunchDaemons && cat > ${DAEMON_PATH} <<'PLIST'\n${daemonPlist({ node, repo, listen, door })}\nPLIST\nchown root:wheel ${DAEMON_PATH} && chmod 644 ${DAEMON_PATH}` },
    { needsSudo: true, display: `load the daemon`, shell: `launchctl bootout system/${DAEMON_LABEL} 2>/dev/null; launchctl bootstrap system ${DAEMON_PATH}` },
    { needsSudo: false, display: `install the platform LaunchAgent for ${user}`, shell: `mkdir -p "$HOME/Library/LaunchAgents" && cat > "$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist" <<'PLIST'\n${agentPlist({ node, repo })}\nPLIST` },
    { needsSudo: false, display: `load the agent`, shell: `launchctl bootout gui/${uid}/${AGENT_LABEL} 2>/dev/null; launchctl bootstrap gui/${uid} "$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"` },
  ];
  if (openAtLogin) steps.push(...openAtLoginSteps({ platform: "darwin", node, repo }));
  return steps;
}

export function uninstallSteps({ uid }) {
  return [
    { needsSudo: true, display: `unload and remove the daemon`, shell: `launchctl bootout system/${DAEMON_LABEL} 2>/dev/null; rm -f ${DAEMON_PATH}` },
    { needsSudo: false, display: `unload and remove the agent`, shell: `launchctl bootout gui/${uid}/${AGENT_LABEL} 2>/dev/null; rm -f "$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"` },
    { needsSudo: true, display: `remove the hosts entry`, shell: `sed -i '' '/ayamai.local.*# ayamai/d' /etc/hosts` },
  ];
}
