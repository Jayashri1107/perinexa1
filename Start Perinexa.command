#!/bin/zsh -l
# Double-click in Finder to start Perinexa (database, server and website) in the Mac's Terminal app.
# Keep this Terminal window open while you use Perinexa; close it (or press Ctrl + C) to stop the app.
cd "$(dirname "$0")" || exit 1
if lsof -iTCP:4000 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  echo "Perinexa is already running. Open http://localhost:5173 in Google Chrome."
  exit 0
fi
echo "Starting Perinexa... then open http://localhost:5173 in Google Chrome."
npm run dev
