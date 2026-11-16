# Shared by deploy.sh and restore.sh on the AWS server (docs/DEPLOY_AWS.md sections 8 and 9): read the database
# address from server/.env and save the whole database with mongodump. Not run on its own.

APP=${APP:-/opt/perinexa/app}
BACKUPS=/opt/perinexa/backups
KEEP_BACKUPS=14

# The database address from server/.env, without loading the rest of the file into the shell.
mongo_uri() {
  local uri
  uri=$(sed -n 's/^MONGO_URI=//p' "$APP/server/.env" | tail -n 1)
  uri=${uri%$'\r'}
  uri=${uri#\"}; uri=${uri%\"}
  uri=${uri#\'}; uri=${uri%\'}
  printf '%s' "$uri"
}

# A private file (mode 600) holding the address for mongodump / mongorestore --config, so the address and its password
# never show on the command line or in the server's process list. Prints the file's name; the caller deletes it.
mongo_conf() {
  local uri conf
  uri=$(mongo_uri)
  if [ -z "$uri" ]; then
    echo "No MONGO_URI in $APP/server/.env." >&2
    return 1
  fi
  conf=$(mktemp) || return 1
  printf "uri: '%s'\n" "${uri//\'/\'\'}" >"$conf" || { rm -f "$conf"; return 1; }
  printf '%s' "$conf"
}

# Saves the database to $BACKUPS/<UTC time>-<label>.archive.gz and prints that file's name. Keeps the newest
# $KEEP_BACKUPS copies. Every step checks itself, because callers use it inside "if", where set -e is off.
backup_database() {
  local label=$1 file conf
  if ! command -v mongodump >/dev/null; then
    echo "mongodump is not installed (MongoDB Database Tools, docs/DEPLOY_AWS.md section 2)." >&2
    return 1
  fi
  install -d -m 700 -o root -g root "$BACKUPS" || return 1
  file="$BACKUPS/$(date -u +%Y%m%d-%H%M%S)-$label.archive.gz"
  conf=$(mongo_conf) || return 1
  if ! mongodump --config="$conf" --archive="$file.part" --gzip --quiet; then
    rm -f "$conf" "$file.part"
    return 1
  fi
  rm -f "$conf"
  if [ ! -s "$file.part" ]; then
    rm -f "$file.part"
    echo "mongodump wrote an empty file." >&2
    return 1
  fi
  chmod 600 "$file.part" && mv "$file.part" "$file" || return 1
  # Only the newest copies are kept, so the disk does not fill up.
  ls -1t "$BACKUPS"/*.archive.gz | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f --
  printf '%s' "$file"
}
