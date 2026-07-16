#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ ! -d node_modules ] || [ ! -d server/node_modules ] || [ ! -d client/node_modules ]; then
  echo "Installing dependencies..."
  npm run install:all
fi
npm run dev
