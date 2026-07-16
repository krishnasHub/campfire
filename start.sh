#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ ! -d server/node_modules ]; then
  echo "Installing dependencies..."
  npm run install:all
fi
npm run dev
