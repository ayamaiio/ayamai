#!/usr/bin/env bash
# Called as ubuntu only after checksum verification. No migration commands here.
set -Eeuo pipefail
release_id=${1:?release id required}
revision=${2:?revision required}
[[ $release_id =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]]
[[ $revision =~ ^[a-f0-9]{40}$ ]]
base=${AYAMAI_RELEASE_ROOT:-/opt/ayamai}
exec 9>"$base/deploy.lock"
flock -w 300 9
previous=$(readlink -f "$base/current")
target="$base/releases/$release_id"
test ! -e "$target"
test "$(cat unpack/REVISION)" = "$revision"
test -s unpack/backend/dist/index.mjs
test -s unpack/frontend/index.html
cp unpack/REVISION unpack/frontend/REVISION
mv unpack "$target"
chmod -R a+rX "$target/frontend"
switch() {
  ln -s "$1" "$base/current.next"
  mv -Tf "$base/current.next" "$base/current"
}
configure_service() {
  printf '%s\n' \
    '[Service]' \
    'WorkingDirectory=/opt/ayamai/current/backend' \
    'ExecStart=' \
    'ExecStart=/snap/node/current/bin/node --env-file=/home/ubuntu/ayamai.env --enable-source-maps dist/index.mjs' \
    | sudo tee /etc/systemd/system/ayamai.service.d/release.conf >/dev/null
  sudo systemctl daemon-reload
}
rollback() {
  trap - ERR INT TERM
  echo 'Deployment failed; restoring previous backend and frontend.' >&2
  switch "$previous"
  configure_service
  sudo systemctl restart ayamai
  curl --fail --retry 10 --retry-delay 2 --retry-connrefused http://127.0.0.1:8080/api/healthz
  exit 1
}
trap rollback ERR INT TERM
switch "$target"
configure_service
sudo systemctl restart ayamai
healthy=false
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:8080/api/healthz | grep -q '"status":"ok"'; then healthy=true; break; fi
  sleep 2
done
test "$healthy" = true
test "$(curl -fsS https://aws.ayamai.io/REVISION)" = "$revision"
curl -fsS https://aws.ayamai.io/api/healthz | grep -q '"status":"ok"'
curl -fsS https://aws.ayamai.io/library | grep -q '<div id="root"'
trap - ERR INT TERM
ln -sfn "$previous" "$base/previous"
echo "Activated $release_id; prior release retained at $previous"
