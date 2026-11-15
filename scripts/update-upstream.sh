#!/usr/bin/env bash
# Moves upstream/ to the newest tip of Maria's branch and reinstalls dependencies, in one step.
# upstream/ is disposable: tracked files are reset to her tip; overlay copies (untracked) are left
# for sync.sh to manage. Prints old and new SHAs. Set UPSTREAM_BRANCH to follow another branch.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
up="$root/upstream"
branch="${UPSTREAM_BRANCH:-maria/redesign/6-workspace-panes}"

[ -d "$up/.git" ] || bash "$root/scripts/setup-worktree.sh"

before="$(git -C "$up" rev-parse --short HEAD)"
git -C "$up" fetch --quiet --depth 1 origin "$branch"
git -C "$up" checkout --quiet -B "$branch" FETCH_HEAD
git -C "$up" reset --quiet --hard FETCH_HEAD
after="$(git -C "$up" rev-parse --short HEAD)"

(cd "$up" && vp i >/dev/null 2>&1) || { echo "update-upstream: vp i failed" >&2; exit 1; }
echo "update-upstream: $before -> $after ($(git -C "$up" log -1 --format='%cI %s'))"
