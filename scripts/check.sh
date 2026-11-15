#!/usr/bin/env bash
# The gate: sync, typecheck the web package, build, smoke. Exits non-zero on any failure.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
up="$root/upstream"

bash "$root/scripts/sync.sh"

modified="$(git -C "$up" status --porcelain --untracked-files=no)"
if [ -n "$modified" ]; then
  echo "check: upstream has modified tracked files; the overlay must only add files:" >&2
  echo "$modified" >&2
  exit 1
fi

echo "check: typecheck (apps/web)"
(cd "$up/apps/web" && vp run typecheck) > "$root/.check-typecheck.log" 2>&1 || {
  grep -E "error" -A4 "$root/.check-typecheck.log" | head -80 >&2
  rm -f "$root/.check-typecheck.log"
  echo "check: typecheck failed" >&2
  exit 1
}
rm -f "$root/.check-typecheck.log"

echo "check: build"
bash "$root/scripts/build.sh"

echo "check: smoke"
node "$root/scripts/smoke.mjs" dist

echo "check: passed"
