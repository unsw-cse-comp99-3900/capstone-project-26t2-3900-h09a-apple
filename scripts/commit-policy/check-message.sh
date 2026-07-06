#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
# shellcheck source=scripts/commit-policy/lib.sh
source "${root}/scripts/commit-policy/lib.sh"

commit_msg=$(cat)
commit_policy_check_text "$commit_msg" "commit message"
