#!/usr/bin/env bash
# Syncs the overlay, builds the mock, and leaves a deployable static site in dist/:
# SPA fallback (vercel.json rewrite and 404.html), no sourcemaps, and build-info.json.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
up="$root/upstream"
out="$root/dist"

bash "$root/scripts/sync.sh"

commit="$(git -C "$up" rev-parse HEAD)"
branch="${MOCK_UPSTREAM_BRANCH:-$(git -C "$up" rev-parse --abbrev-ref HEAD)}"
[ "$branch" = "HEAD" ] && branch="maria/redesign/6-workspace-panes"
committed_at="$(git -C "$up" log -1 --format=%cI)"
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

rm -rf "$out"
(
  cd "$up/apps/web"
  # The mock config forces these empty too; unsetting them here keeps the shell's values
  # (Vercel sets some) away from anything else that reads the environment.
  env -u VITE_HTTP_URL -u VITE_WS_URL -u VITE_HOSTED_APP_CHANNEL -u VITE_HOSTED_APP_URL \
    -u VITE_CLERK_PUBLISHABLE_KEY -u VITE_T3CODE_RELAY_URL -u VERCEL_URL -u VERCEL_ENV \
    -u VERCEL_PROJECT_PRODUCTION_URL \
    MOCK_UPSTREAM_COMMIT="$commit" MOCK_UPSTREAM_BRANCH="$branch" \
    MOCK_UPSTREAM_DATE="$committed_at" MOCK_BUILT_AT="$built_at" \
    MOCK_OUT_DIR="$out" T3CODE_WEB_SOURCEMAP=0 \
    bash -c '
      set -euo pipefail
      # Two passes (see boot chunks in overlay/apps/web/vite/redesignMock.ts): the plan pass finds
      # what a first visit loads, then the real build groups exactly that into a few files.
      plan="node_modules/.redesign-mock/boot-plan.json"
      rm -f "$plan"
      MOCK_BOOT_PLAN_WRITE="$plan" vp build -c vite.mock.config.ts --logLevel warn
      MOCK_BOOT_PLAN="$plan" vp build -c vite.mock.config.ts --emptyOutDir
    '
)

# Path routes (/<environment>/<thread>) load the app shell.
cp "$out/index.html" "$out/404.html"
cat > "$out/vercel.json" <<'JSON'
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    { "source": "/(.*)", "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }] },
    { "source": "/assets/:file([^/]+-[A-Za-z0-9_-]{8}\\.[^/]+)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/(favicon.ico|apple-touch-icon.png|icon-192x192.png|icon-512x512.png|manifest.webmanifest)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=86400" }] },
    { "source": "/", "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }] },
    { "source": "/(index.html|build-info.json)", "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }] }
  ]
}
JSON
cat > "$out/build-info.json" <<JSON
{
  "mockCommit": "${MOCK_REPO_COMMIT:-$(git -C "$root" rev-parse HEAD)}",
  "upstreamRepository": "pingdotgg/t3code",
  "upstreamBranch": "$branch",
  "upstreamCommit": "$commit",
  "upstreamCommittedAt": "$committed_at",
  "builtAt": "$built_at"
}
JSON
find "$out" -name '*.map' -delete
echo "build: dist/ ready ($(du -sh "$out" | cut -f1)) from ${commit:0:8} on $branch"
