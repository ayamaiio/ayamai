#!/usr/bin/env bash
# One-time installation on the inspected Ubuntu Lightsail server as ubuntu.
set -Eeuo pipefail
base=/opt/ayamai
test ! -e "$base/current"
test ! -e /var/www/ayamai-pre-cicd
test ! -e /etc/systemd/system/ayamai.service.d/release.conf
test -z "$(git -C /home/ubuntu/ayamai status --porcelain)"
sudo install -d -o ubuntu -g ubuntu -m 755 "$base" "$base/releases"
baseline="$base/releases/baseline-$(git -C /home/ubuntu/ayamai rev-parse HEAD)"
mkdir "$baseline"
# Preserve the entire backend including its original dependency graph.
cp -a /home/ubuntu/ayamai "$baseline/source"
ln -s source/artifacts/api-server "$baseline/backend"
cp -a /var/www/ayamai "$baseline/frontend"
git -C /home/ubuntu/ayamai rev-parse HEAD > "$baseline/REVISION"
cp "$baseline/REVISION" "$baseline/frontend/REVISION"
chmod -R a+rX "$baseline/frontend"
ln -s "$baseline" "$base/current"
sudo mkdir -p /etc/systemd/system/ayamai.service.d
sudo tee /etc/systemd/system/ayamai.service.d/release.conf >/dev/null <<'UNIT'
[Service]
WorkingDirectory=/opt/ayamai/current/backend
ExecStart=
ExecStart=/snap/node/current/bin/node --env-file=/home/ubuntu/ayamai.env --enable-source-maps dist/index.mjs
UNIT
restore() {
  trap - ERR INT TERM
  sudo rm -f /etc/systemd/system/ayamai.service.d/release.conf
  if test -d /var/www/ayamai-pre-cicd; then
    sudo rm -f /var/www/ayamai
    sudo mv /var/www/ayamai-pre-cicd /var/www/ayamai
  fi
  sudo systemctl daemon-reload
  sudo systemctl restart ayamai
  exit 1
}
trap restore ERR INT TERM
sudo mv /var/www/ayamai /var/www/ayamai-pre-cicd
sudo ln -s "$base/current/frontend" /var/www/ayamai
sudo systemctl daemon-reload
sudo systemctl restart ayamai
curl --fail --retry 15 --retry-delay 2 --retry-connrefused http://127.0.0.1:8080/api/healthz
curl -fsS https://aws.ayamai.io/library | grep -q '<div id="root"'
test "$(curl -fsS https://aws.ayamai.io/REVISION)" = "$(cat "$baseline/REVISION")"
trap - ERR INT TERM
echo 'Release layout installed; original checkout, frontend backup, and runtime secrets preserved.'
