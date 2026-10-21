#!/usr/bin/env bash
# Puts the latest main online on the AWS server, and goes back to the version before if the new one is not healthy
# within a minute (docs/DEPLOY_AWS.md). Run on the server, after CI on GitHub is green:
#   sudo /opt/perinexa/app/deploy/deploy.sh
set -euo pipefail

APP=/opt/perinexa/app
HEALTH=http://127.0.0.1:4000/api/health

as_app() { runuser -u perinexa -- "$@"; }
build_and_start() {
  as_app npm ci --no-audit --no-fund
  as_app npm run build
  systemctl restart perinexa
}
healthy() {
  for _ in $(seq 1 30); do
    curl -fs "$HEALTH" >/dev/null && return 0
    sleep 2
  done
  return 1
}

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo."; exit 1; fi
cd "$APP"
if [ -n "$(as_app git status --porcelain --untracked-files=no)" ]; then
  echo "Files were changed by hand on this server (git status). Nothing deployed."
  exit 1
fi

before=$(as_app git rev-parse HEAD)
as_app git fetch -q origin main
as_app git reset -q --hard origin/main
echo "Deploying: $(as_app git log -1 --format='%h %s')"

if build_and_start && healthy; then
  echo "OK: online and healthy."
  exit 0
fi

echo "FAILED: going back to $before"
as_app git reset -q --hard "$before"
if build_and_start && healthy; then
  echo "Back on the version before. See why the new one failed: journalctl -u perinexa -n 100"
else
  echo "The version before is not healthy either: journalctl -u perinexa -n 100"
fi
exit 1
