#!/usr/bin/env bash
# Build a marker-friendly zip: tracked tree + prebuilt extension dist (no Node required).
# Usage (from repo root):
#   bash scripts/package-submission.sh
# Optional: place SECRETS.txt in the repo root first; it will be appended if present
# and is never committed (see .gitignore).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${SUBMISSION_ZIP:-$ROOT/../worktrace-submission.zip}"
rm -f "$OUT"

echo "Building extension dist..."
corepack pnpm --filter @h09a/extension build

echo "Archiving HEAD to $OUT ..."
git archive --format=zip --output="$OUT" HEAD

echo "Appending apps/extension/dist ..."
(
  cd "$ROOT"
  # Paths inside the zip should be apps/extension/dist/...
  if command -v zip >/dev/null 2>&1; then
    zip -r "$OUT" apps/extension/dist -x "*.map"
  else
    echo "zip CLI not found; install zip or append dist manually" >&2
    exit 1
  fi
)

if [[ -f "$ROOT/SECRETS.txt" ]]; then
  echo "Appending SECRETS.txt (do not commit this file) ..."
  (
    cd "$ROOT"
    zip "$OUT" SECRETS.txt
  )
fi

echo "Done: $OUT"
echo "Verify: unzip -l \"$OUT\" | grep -E 'apps/extension/dist/manifest.json|DEPLOYMENT_GUIDE|.env.example'"
