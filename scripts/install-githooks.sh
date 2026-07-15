#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

git config core.hooksPath scripts/githooks
chmod +x scripts/githooks/pre-commit scripts/githooks/commit-msg scripts/ci/pre-commit-check.sh
echo "Installed git hooks from scripts/githooks."
echo "  pre-commit: CI-mirror checks on staged files (scripts/ci/pre-commit-check.sh --staged)"
echo "  commit-msg: rejects AI co-author trailers"
