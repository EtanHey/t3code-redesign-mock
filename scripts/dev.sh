#!/usr/bin/env bash
# Syncs the overlay and runs the mock dev server (default port 5833), re-syncing on overlay changes.
# Stop it with Ctrl-C in its terminal (the interrupt reaches vp and its children; the watcher
# is stopped on exit).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
bash "$root/scripts/sync.sh"

node "$root/scripts/lib/watch-sync.mjs" &
watcher=$!
trap 'kill "$watcher" 2>/dev/null || true' EXIT INT TERM

echo "dev: pid $$, watcher pid $watcher"
cd "$root/upstream/apps/web"
env -u VITE_HTTP_URL -u VITE_WS_URL -u VITE_HOSTED_APP_CHANNEL -u VITE_HOSTED_APP_URL \
  -u VITE_CLERK_PUBLISHABLE_KEY -u VITE_T3CODE_RELAY_URL -u T3CODE_PORT \
  PORT="${PORT:-5833}" vp dev -c vite.mock.config.ts
