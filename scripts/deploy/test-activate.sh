#!/usr/bin/env bash
# Exercise real activation logic with isolated files and mocked service/network.
set -euo pipefail
script=$(realpath "$(dirname "$0")/activate.sh")
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
revision=1111111111111111111111111111111111111111
export revision
mkdir "$scratch/bin"
cat > "$scratch/bin/sudo" <<'MOCK'
#!/bin/bash
echo "$*" >> "$AYAMAI_RELEASE_ROOT/service.log"
MOCK
cat > "$scratch/bin/curl" <<'MOCK'
#!/bin/bash
if [[ $* == *REVISION* ]]; then
  if [[ ${FAIL_PUBLIC:-0} == 1 ]]; then echo wrong-revision; else echo "$revision"; fi
elif [[ $* == *library* ]]; then
  echo '<div id="root"></div>'
else
  echo '{"status":"ok"}'
fi
MOCK
chmod +x "$scratch/bin/"*
export PATH="$scratch/bin:$PATH"
for mode in success public-failure incomplete; do
  export AYAMAI_RELEASE_ROOT="$scratch/$mode/root"
  mkdir -p "$AYAMAI_RELEASE_ROOT/releases/prior" "$scratch/$mode/work/unpack/backend/dist" "$scratch/$mode/work/unpack/frontend"
  ln -s "$AYAMAI_RELEASE_ROOT/releases/prior" "$AYAMAI_RELEASE_ROOT/current"
  cd "$scratch/$mode/work"
  printf '%s\n' "$revision" > unpack/REVISION
  touch unpack/backend/dist/index.mjs
  echo '// backend' > unpack/backend/dist/index.mjs
  echo '<div id="root"></div>' > unpack/frontend/index.html
  export FAIL_PUBLIC=0
  if [[ $mode == public-failure ]]; then export FAIL_PUBLIC=1; fi
  if [[ $mode == incomplete ]]; then rm unpack/backend/dist/index.mjs; fi
  if bash "$script" "$revision-123-1" "$revision"; then
    test "$mode" = success
    test "$(readlink -f "$AYAMAI_RELEASE_ROOT/current")" = "$AYAMAI_RELEASE_ROOT/releases/$revision-123-1"
    test "$(readlink -f "$AYAMAI_RELEASE_ROOT/previous")" = "$AYAMAI_RELEASE_ROOT/releases/prior"
  else
    test "$mode" != success
    test "$(readlink -f "$AYAMAI_RELEASE_ROOT/current")" = "$AYAMAI_RELEASE_ROOT/releases/prior"
  fi
done
echo 'PASS: activation, paired rollback on public failure, incomplete release rejection'
