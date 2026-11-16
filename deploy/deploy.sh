#!/usr/bin/env bash
# Puts the latest main online on the AWS server, and goes back to the version before if the new one is not healthy
# within a minute (docs/DEPLOY_AWS.md). Run on the server, after CI on GitHub is green:
#   sudo /opt/perinexa/app/deploy/deploy.sh
#
# Before anything changes it saves the whole database to /opt/perinexa/backups (mongodump, the newest 14 kept). If the
# save fails, nothing is deployed. The startup steps of a new version may change existing records, and going back to
# the version before does not undo that – the saved copy does (deploy/restore.sh, docs/DEPLOY_AWS.md section 9).
#   sudo /opt/perinexa/app/deploy/deploy.sh --no-backup     deploy without saving the database first (not advised)
set -euo pipefail

APP=/opt/perinexa/app
HEALTH=http://127.0.0.1:4000/api/health
# shellcheck source=db-backup-lib.sh
. "$(dirname "$(readlink -f "$0")")/db-backup-lib.sh"

as_app() { runuser -u perinexa -- "$@"; }
# Joined with && on purpose: it is called inside "if", where set -e is off, so a failed npm ci or build must stop it
# here – otherwise the server restarts on a half-built website and the health check still says OK.
build_and_start() {
  as_app npm ci --no-audit --no-fund &&
    as_app npm run build &&
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
skip_backup=false
case "${1:-}" in
  "") ;;
  --no-backup) skip_backup=true ;;
  *) echo "Unknown option: $1 (the only one is --no-backup)"; exit 1 ;;
esac
cd "$APP"
if [ -n "$(as_app git status --porcelain --untracked-files=no)" ]; then
  echo "Files were changed by hand on this server (git status). Nothing deployed."
  exit 1
fi

saved=""
if $skip_backup; then
  echo "WARNING: --no-backup – the database is not saved before this deploy."
else
  echo "Saving the database before the deploy..."
  if ! saved=$(backup_database "before-$(as_app git rev-parse --short HEAD)"); then
    echo "FAILED to save the database. Nothing deployed (to deploy anyway: --no-backup)."
    exit 1
  fi
  echo "Saved: $saved ($(du -h "$saved" | cut -f1))"
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
if [ -n "$saved" ]; then
  echo "The new version's startup steps may already have changed records. The database as it was before this deploy:"
  echo "  $saved   (to put it back: sudo $APP/deploy/restore.sh $saved)"
fi
exit 1
