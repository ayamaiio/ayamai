// Opening the front door at login, on whichever operating system is asking.
//
// Each entry is a step: a display line for --print-actions, a shell command, and
// whether it needs elevation (none of these do).
export const OPEN_LABEL = "local.ayamai.open";
export const OPEN_AGENT_PATH = "Library/LaunchAgents/local.ayamai.open.plist";

export function openAgentPlist({ node, repo, url = "http://ayamai.local/", logs = { out: "/tmp/ayamai-open.log", err: "/tmp/ayamai-open.err" } }) {
  const xml = (text) => String(text).replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${OPEN_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(repo)}/scripts/open-when-ready.mjs</string>
    <string>--url</string>
    <string>${xml(url)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xml(logs.out)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logs.err)}</string>
</dict>
</plist>
`;
}

/** Linux: an XDG autostart entry. */
export function linuxDesktopEntry({ node, repo, url = "http://ayamai.local/" }) {
  return `[Desktop Entry]
Type=Application
Name=ayamai
Comment=Open the front door
Exec="${node}" "${repo}/scripts/open-when-ready.mjs" --url ${url}
X-GNOME-Autostart-enabled=true
Terminal=false
`;
}

/** Windows (written from WSL): a .cmd in the user's Startup folder. */
export function windowsStartupCommand({ url = "http://ayamai.local/", distro = "Ubuntu" } = {}) {
  return `@echo off\r\nrem ayamai - open the front door once it answers\r\nfor /l %%i in (1,1,60) do (\r\n  curl.exe -s -o NUL --max-time 2 ${url}health.json && goto open\r\n  timeout /t 1 >NUL\r\n)\r\n:open\r\nstart "" ${url}\r\n`;
}

/**
 * The steps for this platform. `wsl` decides whether Windows or Linux owns the
 * login item, because the browser lives on the Windows side.
 */
export function openAtLoginSteps({ platform, node, repo, wsl = false, user = "", url = "http://ayamai.local/", startupDir = "" }) {
  if (platform === "darwin") {
    return [
      {
        needsSudo: false,
        display: "register ayamai.local to open at login",
        shell: `mkdir -p "$HOME/Library/LaunchAgents" && cat > "$HOME/${OPEN_AGENT_PATH}" <<'PLIST'\n${openAgentPlist({ node, repo, url })}\nPLIST\nlaunchctl bootout gui/$(id -u)/${OPEN_LABEL} 2>/dev/null; launchctl bootstrap gui/$(id -u) "$HOME/${OPEN_AGENT_PATH}"`,
      },
    ];
  }
  if (platform === "linux" && !wsl) {
    return [
      {
        needsSudo: false,
        display: "register ayamai.local to open at login",
        shell: `mkdir -p "$HOME/.config/autostart" && cat > "$HOME/.config/autostart/ayamai.desktop" <<'DESKTOP'\n${linuxDesktopEntry({ node, repo, url })}\nDESKTOP`,
      },
    ];
  }
  // WSL: the browser is Windows', so the login item is too.
  const target = startupDir || `/mnt/c/Users/${user}/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup`;
  return [
    {
      needsSudo: false,
      display: "register ayamai.local to open at login (Windows Startup)",
      shell: `mkdir -p '${target}' && cat > '${target}/ayamai-open.cmd' <<'CMD'\n${windowsStartupCommand({ url })}\nCMD`,
    },
  ];
}

export function removeAtLoginSteps({ platform, wsl = false, user = "", startupDir = "" }) {
  if (platform === "darwin") {
    return [
      { needsSudo: false, display: "stop opening ayamai.local at login", shell: `launchctl bootout gui/$(id -u)/${OPEN_LABEL} 2>/dev/null; rm -f "$HOME/${OPEN_AGENT_PATH}"` },
    ];
  }
  if (platform === "linux" && !wsl) {
    return [{ needsSudo: false, display: "stop opening ayamai.local at login", shell: `rm -f "$HOME/.config/autostart/ayamai.desktop"` }];
  }
  const target = startupDir || `/mnt/c/Users/${user}/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup`;
  return [{ needsSudo: false, display: "stop opening ayamai.local at login", shell: `rm -f '${target}/ayamai-open.cmd'` }];
}
