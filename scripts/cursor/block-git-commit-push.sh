#!/usr/bin/env bash
# Block the Cursor agent from git commit/push or --trailer in this repo.
set -euo pipefail

input=$(cat)
command=$(INPUT="$input" python - <<'PY'
import json, os
print(json.loads(os.environ["INPUT"]).get("command", ""))
PY
)

if echo "$command" | grep -Eiq '(^|[;&|]\s*)git[[:space:]]+commit\b|(^|[;&|]\s*)git[[:space:]]+push\b'; then
  cat <<'EOF'
{"permission":"deny","user_message":"Git commit/push is disabled for the AI agent. Run git yourself in the terminal.","agent_message":"Never run git commit or git push. Provide exact commands for the user to run manually."}
EOF
  exit 0
fi

if echo "$command" | grep -Eiq 'git[[:space:]]+commit\b.*--trailer'; then
  cat <<'EOF'
{"permission":"deny","user_message":"git commit --trailer is disabled for the AI agent (commit policy).","agent_message":"Do not add commit trailers. The user commits manually."}
EOF
  exit 0
fi

echo '{"permission":"allow"}'
exit 0
