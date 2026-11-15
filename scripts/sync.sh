#!/usr/bin/env bash
# Copies overlay/ into upstream/ and removes overlay files deleted since the last sync.
# Refuses, naming the path, when an overlay file would replace a file tracked upstream:
# that refusal is the guard for "never modify her files".
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
up="$root/upstream"
ov="$root/overlay"

[ -d "$up/.git" ] || { echo "sync: upstream/ is missing; run scripts/setup-worktree.sh" >&2; exit 1; }
[ -d "$ov" ] || { echo "sync: overlay/ is missing" >&2; exit 1; }

# Kept inside upstream's .git so it never shows as an untracked file there.
manifest="$(git -C "$up" rev-parse --absolute-git-dir)/redesign-mock-overlay.manifest"
touch "$manifest"

current="$(cd "$ov" && find . -type f ! -name .DS_Store | sed 's|^\./||' | LC_ALL=C sort)"

clashes="$(LC_ALL=C comm -12 <(printf '%s\n' "$current") <(git -C "$up" ls-files | LC_ALL=C sort))"
if [ -n "$clashes" ]; then
  echo "sync: refusing; these overlay files exist as tracked files upstream:" >&2
  printf '  %s\n' $clashes >&2
  exit 1
fi

removed=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  if [ -f "$up/$path" ] && ! git -C "$up" ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
    rm -f "$up/$path"
    rmdir -p "$(dirname "$up/$path")" 2>/dev/null || true
    removed=$((removed + 1))
  fi
done < <(LC_ALL=C comm -23 <(LC_ALL=C sort "$manifest") <(printf '%s\n' "$current"))

copied=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  if ! cmp -s "$ov/$path" "$up/$path" 2>/dev/null; then
    mkdir -p "$(dirname "$up/$path")"
    cp "$ov/$path" "$up/$path"
    copied=$((copied + 1))
  fi
done <<< "$current"

printf '%s\n' "$current" > "$manifest"
echo "sync: $copied copied, $removed removed, $(printf '%s\n' "$current" | grep -c . || true) overlay files"
