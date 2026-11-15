#!/usr/bin/env bash
# Keep a local tail for the issue when a shell step fails.
set -o pipefail
"$@" 2>&1 | tee "$RUNNER_TEMP/check.log"
