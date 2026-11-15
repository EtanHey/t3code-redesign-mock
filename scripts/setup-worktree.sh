#!/usr/bin/env bash
# Gives a fresh worktree its own upstream/ checkout of Maria's tip, with dependencies installed.
# Clones the main checkout's upstream/ (an APFS copy, near-instant) when one exists; otherwise
# clones from GitHub.
set -euo pipefail

UPSTREAM_REPO="https://github.com/pingdotgg/t3code.git"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-maria/redesign/6-workspace-panes}"

here="$(git rev-parse --show-toplevel)"
main_checkout="$(git worktree list --porcelain | awk '/^worktree /{print substr($0,10); exit}')"
cd "$here"

if [ -d upstream/.git ]; then
  echo "setup-worktree: upstream/ already present"
elif [ "$main_checkout" != "$here" ] && [ -d "$main_checkout/upstream/.git" ]; then
  echo "setup-worktree: cloning $main_checkout/upstream"
  cp -cR "$main_checkout/upstream" upstream 2>/dev/null || cp -R "$main_checkout/upstream" upstream
else
  echo "setup-worktree: cloning $UPSTREAM_BRANCH from GitHub"
  git clone --quiet --depth 1 --branch "$UPSTREAM_BRANCH" "$UPSTREAM_REPO" upstream
fi

# Fast when the store is warm; repairs anything a copied node_modules got wrong.
(cd upstream && vp i >/dev/null 2>&1) || { echo "setup-worktree: vp i failed" >&2; exit 1; }
echo "setup-worktree: ready at $(cd upstream && git rev-parse --short HEAD)"
