#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

mkdir -p .cursor/rules
cp scripts/cursor/hooks.json .cursor/hooks.json
cp scripts/cursor/no-agent-git.mdc .cursor/rules/no-agent-git.mdc
chmod +x scripts/cursor/block-git-commit-push.sh

echo "Installed local Cursor config under .cursor/ (gitignored)."
echo "Hook script stays at scripts/cursor/block-git-commit-push.sh"
