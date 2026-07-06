#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

git config core.hooksPath scripts/githooks
echo "Installed git hooks from scripts/githooks (commit-msg rejects Cursor co-author trailers)."
