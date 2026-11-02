#!/usr/bin/env sh
# ayamai install — unix entry point.
#
#   curl -fsSL https://github.com/ayamaiio/ayamai/releases/latest/download/install.sh | sh
#   ./scripts/install.sh [--check]      from a checkout
#
# It deliberately does little: find or fetch the source, verify the machine has
# what ayamai needs, install the workspace, then hand over to `ayamai doctor`.
set -eu

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

say() { printf '%s\n' "$*"; }
die() { printf 'install: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node not found. Install Node 20 or newer (https://nodejs.org)."
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 20 ] || die "node $(node -v) is too old; ayamai needs 20 or newer."

command -v pnpm >/dev/null 2>&1 || die "pnpm not found. Install it: corepack enable && corepack prepare pnpm@10 --activate"

REPO_SLUG="${AYAMAI_REPO_SLUG:-ayamaiio/ayamai}"
DATA="${AYAMAI_DATA:-$HOME/.local/share/ayamai}"
SRC="$DATA/src"

# Are we inside a checkout? Then use it.
if [ -f "./packages/cli/index.mjs" ]; then
  ROOT=$(pwd)
else
  ROOT="$SRC"
  say "ayamai install — fetching $REPO_SLUG"
  mkdir -p "$DATA"
  URL="https://github.com/$REPO_SLUG/releases/latest/download/ayamai-latest.tar.gz"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$URL" -o "$DATA/ayamai.tar.gz" || die "could not download $URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$DATA/ayamai.tar.gz" "$URL" || die "could not download $URL"
  else
    die "need curl or wget to download ayamai"
  fi
  rm -rf "$ROOT"
  mkdir -p "$ROOT"
  tar -xzf "$DATA/ayamai.tar.gz" -C "$ROOT" || die "could not unpack the release"
fi

cd "$ROOT"
[ -f "packages/cli/index.mjs" ] || die "the download does not look like ayamai (packages/cli missing)"
say "source: $ROOT"

if [ "$CHECK_ONLY" -eq 0 ]; then
  say "installing the workspace…"
  pnpm install --frozen-lockfile
fi

say "checking the machine…"
node packages/cli/index.mjs doctor

# macOS needs one privileged step to own the name and port 80.
if [ "$(uname -s)" = "Darwin" ] && [ "$CHECK_ONLY" -eq 0 ]; then
  say ""
  say "putting ayamai.local on this machine (asks for your password once)…"
  node packages/cli/index.mjs install || true
fi

say ""
say "next:"
say "  node packages/cli/index.mjs up      start the platform and projects"
say "  node packages/cli/index.mjs open    open http://localhost:25222"
