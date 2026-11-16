#!/usr/bin/env bash
# Puts the database back as it was in a copy saved by deploy.sh (docs/DEPLOY_AWS.md section 9). Run on the server:
#   sudo ls -lt /opt/perinexa/backups                                       the saved copies, newest first
#   sudo /opt/perinexa/app/deploy/restore.sh /opt/perinexa/backups/<file>.archive.gz
#
# It first saves the database as it is now (so a wrong restore can be undone the same way), stops the app, replaces
# every collection that is in the copy, and starts the app again. Records made after the copy was saved are lost.
set -euo pipefail

APP=/opt/perinexa/app
HEALTH=http://127.0.0.1:4000/api/health
# shellcheck source=db-backup-lib.sh
. "$(dirname "$(readlink -f "$0")")/db-backup-lib.sh"

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo."; exit 1; fi
archive=${1:-}
if [ -z "$archive" ] || [ ! -s "$archive" ]; then
  echo "Give the saved copy to put back, e.g.: sudo $0 $BACKUPS/<file>.archive.gz"
  echo "Saved copies, newest first:"
  ls -1t "$BACKUPS"/*.archive.gz 2>/dev/null | head -n 5 || true
  exit 1
fi
if ! command -v mongorestore >/dev/null; then
  echo "mongorestore is not installed (MongoDB Database Tools, docs/DEPLOY_AWS.md section 2)."
  exit 1
fi

echo "This puts the database back as it was in:"
echo "  $archive  (saved $(date -r "$archive" '+%d %b %Y %H:%M %Z'))"
echo "Everything entered after that time is lost. The site is offline for a few minutes."
read -r -p 'Type "restore" to go on: ' answer
if [ "$answer" != "restore" ]; then echo "Nothing changed."; exit 1; fi

echo "Saving the database as it is now..."
if ! now=$(backup_database "before-restore"); then
  echo "FAILED to save the database as it is now. Nothing changed."
  exit 1
fi
echo "Saved: $now"

conf=$(mongo_conf)
trap 'rm -f "$conf"' EXIT
systemctl stop perinexa
echo "Putting the copy back..."
if ! mongorestore --config="$conf" --archive="$archive" --gzip --drop --quiet; then
  echo "FAILED while putting the copy back; the app stays stopped. The database as it was just now: $now"
  echo "  (sudo $0 $now puts that back)"
  exit 1
fi
systemctl start perinexa
for _ in $(seq 1 30); do
  if curl -fs "$HEALTH" >/dev/null; then
    echo "OK: the database is back as it was in $archive, and the site is online."
    exit 0
  fi
  sleep 2
done
echo "The copy is back, but the site is not healthy: journalctl -u perinexa -n 100"
exit 1
