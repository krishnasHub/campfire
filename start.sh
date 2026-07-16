#!/usr/bin/env bash
cd "$(dirname "$0")"

# 1. Pull the latest code (fast-forward only)
echo "campfire - checking for updates..."
before=$(git rev-parse HEAD 2>/dev/null)
git pull --ff-only 2>&1 || true
after=$(git rev-parse HEAD 2>/dev/null)

# 2. Ensure dependencies (incl. better-sqlite3) on first run or when code changed
if [ "$before" != "$after" ] || [ ! -d node_modules ] || [ ! -d server/node_modules ] || [ ! -d client/node_modules ]; then
  echo "Installing dependencies (incl. better-sqlite3)..."
  npm run install:all
fi

# 3. Open the default browser once the client is up
( sleep 5; (xdg-open http://localhost:5173 2>/dev/null || open http://localhost:5173 2>/dev/null) ) &

# 4. Run server + client; kill the whole process group on exit (no prompt)
trap 'kill 0' EXIT INT TERM
npm run dev
