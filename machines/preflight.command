#!/bin/sh
# ayamai preflight — what this Mac has, and the one installer it needs.
#
# Runs without node, without Homebrew and without sudo. macOS ships bash 3.2,
# so this is plain POSIX sh on purpose.
set -u

guard="$(uname -s 2>/dev/null || echo unknown)"
if [ "$guard" != "Darwin" ]; then
  echo "this is a macOS script; you are on $guard"
  exit 1
fi

row() { printf '%-11s %s\n' "$1" "$2"; }
have() { command -v "$1" >/dev/null 2>&1; }

VERSION=$(sw_vers -productVersion 2>/dev/null || echo unknown)
BUILD=$(sw_vers -buildVersion 2>/dev/null || echo "?")
MODEL=$(sysctl -n hw.model 2>/dev/null || echo "?")
ARCH=$(uname -m 2>/dev/null || echo "?")
FREE=$(df -h / 2>/dev/null | awk 'NR==2 { print $4 }')

CLT="not installed"
if have xcode-select && xcode-select -p >/dev/null 2>&1; then
  CLT=$(xcode-select -p)
fi

NODE=$(have node && node -v 2>/dev/null || echo "not installed")
PNPM=$(have pnpm && pnpm -v 2>/dev/null || echo "not installed")
GIT=$(have git && git --version 2>/dev/null | sed 's/^git version //' || echo "not installed")
PY=$(have python3 && python3 -V 2>/dev/null | sed 's/^Python //' || echo "not installed")

NET="unreachable"
if have curl && curl -fsI --max-time 5 https://nodejs.org/ >/dev/null 2>&1; then NET="nodejs.org reachable"; fi

echo "ayamai preflight"
echo ""
row "macOS" "$VERSION ($BUILD) · $MODEL · $ARCH"
row "disk" "${FREE:-?} free"
row "xcode" "$CLT"
row "node" "$NODE"
row "pnpm" "$PNPM"
row "git" "$GIT"
row "python3" "$PY"
row "network" "$NET"
echo ""

# --- the matrix ------------------------------------------------------------
# Node's official macOS floor moved: 24 needs 13.5, 22 needs 11.0. Below 10.15
# nothing we ship can run, and the honest answer is "upgrade or use the other
# machine" rather than an installer that will not launch.
major=$(printf '%s' "$VERSION" | cut -d. -f1)
minor=$(printf '%s' "$VERSION" | cut -d. -f2)
case "$major" in ''|*[!0-9]*) major=0 ;; esac
case "$minor" in ''|*[!0-9]*) minor=0 ;; esac
mm=$((major * 100 + minor))

if [ "$mm" -ge 1305 ]; then
  LINE=24; DIR=latest-v24.x; WHY="24 runs on macOS 13.5 and newer"
elif [ "$mm" -ge 1100 ]; then
  LINE=22; DIR=latest-v22.x; WHY="24 needs 13.5+; 22 runs on 11.0 and newer"
elif [ "$mm" -ge 1015 ]; then
  LINE=20; DIR=latest-v20.x; WHY="24 and 22 need newer than this; 20 is the last line that runs here"
else
  echo "verdict"
  echo "  macOS $VERSION is older than 10.15, and no Node release runs on it."
  echo "  ayamai cannot run on this machine until macOS is upgraded."
  echo "  Nodes: 24 -> 13.5+, 22 -> 11.0+, 20 -> 10.15+"
  echo ""
  echo "  Either upgrade macOS (System Settings > General > Software Update), or"
  echo "  run ayamai on the other machine and use this one as a browser."
  exit 0
fi

case "$ARCH" in
  arm64) TARBALL="node-v$LINE.x.y-darwin-arm64.tar.gz" ;;
  *)     TARBALL="node-v$LINE.x.y-darwin-x64.tar.gz" ;;
esac

echo "verdict"
echo "  $WHY."
if [ "$NODE" != "not installed" ]; then
  echo "  node $NODE is already here — if it is 20.11 or newer, skip the install."
fi
echo ""
echo "  install  https://nodejs.org/dist/$DIR/     $TARBALL"
echo "  then     corepack enable && corepack prepare pnpm@10 --activate"
echo "  then     ./machines/macbook.command"
echo ""
echo "  Xcode is not needed: ayamai has no native modules. It only buys python3"
echo "  (for api, curator, storybook) and Homebrew."
