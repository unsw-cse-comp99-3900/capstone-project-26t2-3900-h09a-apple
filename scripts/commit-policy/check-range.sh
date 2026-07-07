#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: check-range.sh <base-sha> <head-sha>" >&2
  exit 2
fi

root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
# shellcheck source=scripts/commit-policy/lib.sh
source "${root}/scripts/commit-policy/lib.sh"

commit_policy_check_range "$1" "$2"
