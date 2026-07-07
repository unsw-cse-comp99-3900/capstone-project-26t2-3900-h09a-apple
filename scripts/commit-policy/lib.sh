#!/usr/bin/env bash
# Shared commit-message policy checks.
set -euo pipefail

POLICY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PATTERNS_FILE="${POLICY_DIR}/patterns.txt"

commit_policy_check_text() {
  local text=$1
  local label=${2:-commit message}

  if [[ ! -f "$PATTERNS_FILE" ]]; then
    echo "commit-policy: missing ${PATTERNS_FILE}" >&2
    return 1
  fi

  if printf '%s' "$text" | grep -Ei -f <(grep -Ev '^[[:space:]]*(#|$)' "$PATTERNS_FILE"); then
    echo "Rejected ${label}: forbidden AI co-author / agent trailer detected." >&2
    echo "See docs/commit-policy.md" >&2
    return 1
  fi

  if [[ "${COMMIT_POLICY_STRICT:-}" == "1" ]]; then
    if printf '%s' "$text" | grep -Eiq '^Co-authored-by:'; then
      echo "Rejected ${label}: COMMIT_POLICY_STRICT=1 disallows all Co-authored-by trailers." >&2
      return 1
    fi
  fi

  return 0
}

commit_policy_check_range() {
  local base_sha=$1
  local head_sha=$2
  local combined

  combined=$(git log --format=%B "${base_sha}..${head_sha}")
  commit_policy_check_text "$combined" "commits in ${base_sha}..${head_sha}"
}
