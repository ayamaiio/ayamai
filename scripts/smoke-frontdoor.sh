#!/usr/bin/env bash
# smoke-frontdoor - everything the front door promises, in one pass.
#
#   bash scripts/smoke-frontdoor.sh [port]
set -u
PORT="${1:-25222}"
BASE="http://127.0.0.1:${PORT}"
FAILED=0

check() {
  local path="$1" want="$2" note="${3:-}"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}${path}")"
  if [ "$code" = "$want" ]; then
    printf '%-22s %s  %s\n' "$path" "$code" "$note"
  else
    printf '%-22s %s  WANTED %s  %s\n' "$path" "$code" "$want" "$note"
    FAILED=$((FAILED + 1))
  fi
}

check "/"                    200 "cockpit"
check "/cockpit/ui/ui.css"   200 "cockpit kit"
check "/cockpit/api/status"  200 "cockpit api"
check "/yoru/"               200 "yoru"
check "/api/healthz"         200 "api"
check "/board/"              200 "board"
check "/arcade/"             200 "arcade"
check "/gb/"                 200 "game boy"

# These depend on a running service; report without failing the run.
for path in /curator/ /storybook/; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}${path}")"
  printf '%-22s %s  (optional)\n' "$path" "$code"
done

# Old links and the phone must still land somewhere real.
for path in /feed /library /manga; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}${path}")"
  printf '%-22s %s  redirect\n' "$path" "$code"
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo "front door ok on ${BASE}"
else
  echo "${FAILED} check(s) failed on ${BASE}"
fi
exit "$FAILED"
