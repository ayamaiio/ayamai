# ayamai install — windows entry point.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 [-Check]
#
# Same contract as install.sh: verify, install, hand over to `ayamai doctor`.
param(
  [switch]$Check
)

$ErrorActionPreference = "Stop"

function Say($text) { Write-Host $text }
function Die($text) { Write-Host "install: $text" -ForegroundColor Red; exit 1 }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die "node not found. Install Node 20 or newer (https://nodejs.org)." }
$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) { Die "node $(& node -v) is too old; ayamai needs 20 or newer." }

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Die "pnpm not found. Install it: corepack enable; corepack prepare pnpm@10 --activate"
}

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $root
if (-not (Test-Path "packages\cli\index.mjs")) { Die "this does not look like an ayamai checkout (packages\cli missing)" }

Say "ayamai install — $root"

if (-not $Check) {
  Say "installing the workspace…"
  pnpm install --frozen-lockfile
}

Say "checking the machine…"
& node "packages\cli\index.mjs" doctor

Say ""
Say "next:"
Say "  node packages\cli\index.mjs up      start the platform and projects"
Say "  node packages\cli\index.mjs open    open http://localhost:25222"
