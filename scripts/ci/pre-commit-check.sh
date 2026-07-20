#!/usr/bin/env bash
# Local checks mirroring GitHub CI. Run before commit or push.
# Usage:
#   bash scripts/ci/pre-commit-check.sh          # all pending changes vs origin/main
#   bash scripts/ci/pre-commit-check.sh --staged # staged changes only (git pre-commit hook)
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

mode="all"
if [[ "${1:-}" == "--staged" ]]; then
  mode="staged"
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "usage: pre-commit-check.sh [--staged]" >&2
  exit 0
fi

step() {
  echo ""
  echo "==> $1"
}

any_path_matches() {
  local pattern=$1
  shift
  local path
  for path in "$@"; do
    case "$path" in
      $pattern) return 0 ;;
    esac
  done
  return 1
}

collect_changed_files() {
  if [[ "$mode" == "staged" ]]; then
    git diff --cached --name-only --diff-filter=ACMR
    return
  fi

  if git show-ref --verify --quiet refs/remotes/origin/main; then
    {
      git diff --name-only origin/main
      git diff --name-only --cached
    } | sort -u
    return
  fi

  {
    git diff --name-only HEAD
    git diff --name-only --cached
  } | sort -u
}

run_content_policy() {
  step "content-policy (no Chinese, no em dash U+2014 in added lines)"
  if [[ "$mode" == "staged" ]]; then
    git diff --cached --unified=0 | python3 - <<'PY'
import re
import sys

CJK_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]")
EM_DASH = "\u2014"
violations = []

for line in sys.stdin:
    if not line.startswith("+") or line.startswith("+++"):
        continue
    content = line[1:]
    if EM_DASH in content:
        violations.append(f"em dash (U+2014): {content.strip()[:120]}")
    elif CJK_RE.search(content):
        violations.append(f"Chinese characters: {content.strip()[:120]}")

if violations:
    print("Forbidden content in staged lines:")
    for item in violations[:25]:
        print(f"  - {item}")
    sys.exit(1)

print("Staged lines pass content policy.")
PY
    return
  fi

  if git show-ref --verify --quiet refs/remotes/origin/main; then
    bash scripts/content-policy/check-changed-files.sh origin/main HEAD
    git diff --unified=0 | python3 - <<'PY'
import re
import sys

CJK_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]")
EM_DASH = "\u2014"
violations = []

for line in sys.stdin:
    if not line.startswith("+") or line.startswith("+++"):
        continue
    content = line[1:]
    if EM_DASH in content:
        violations.append(f"em dash (U+2014): {content.strip()[:120]}")
    elif CJK_RE.search(content):
        violations.append(f"Chinese characters: {content.strip()[:120]}")

if violations:
    print("Forbidden content in unstaged lines:")
    for item in violations[:25]:
        print(f"  - {item}")
    sys.exit(1)
PY
    git diff --cached --unified=0 | python3 - <<'PY'
import re
import sys

CJK_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]")
EM_DASH = "\u2014"
violations = []

for line in sys.stdin:
    if not line.startswith("+") or line.startswith("+++"):
        continue
    content = line[1:]
    if EM_DASH in content:
        violations.append(f"em dash (U+2014): {content.strip()[:120]}")
    elif CJK_RE.search(content):
        violations.append(f"Chinese characters: {content.strip()[:120]}")

if violations:
    print("Forbidden content in staged lines:")
    for item in violations[:25]:
        print(f"  - {item}")
    sys.exit(1)
PY
    echo "Unstaged lines pass content policy."
    return
  fi

  echo "origin/main not found; skipping branch content-policy diff."
}

mapfile -t changed_files < <(collect_changed_files || true)

if [[ ${#changed_files[@]} -eq 0 ]]; then
  echo "No changed files to check."
  exit 0
fi

run_content_policy

needs_prettier=0
needs_web=0
needs_api=0
needs_extension=0
needs_desktop=0
needs_migration=0

for path in "${changed_files[@]}"; do
  case "$path" in
    *.md|*.mdx|*.json|*.yaml|*.yml|*.css|*.ts|*.tsx|*.js|*.jsx|*.html)
      needs_prettier=1
      ;;
  esac
  case "$path" in
    apps/web/*|packages/types/*)
      needs_web=1
      ;;
    apps/api/*)
      needs_api=1
      ;;
    apps/extension/*)
      needs_extension=1
      ;;
    apps/desktop/*|packages/desktop-storage/*)
      needs_desktop=1
      ;;
  esac
  case "$path" in
    apps/api/alembic/versions/*)
      needs_migration=1
      ;;
  esac
done

if [[ "$needs_prettier" -eq 1 ]]; then
  step "prettier (pnpm format:check)"
  pnpm format:check
fi

if [[ "$needs_web" -eq 1 ]]; then
  step "web lint"
  pnpm --filter @h09a/web lint
  step "web typecheck (turbo)"
  pnpm exec turbo run typecheck --filter=@h09a/web
  step "web test"
  pnpm --filter @h09a/web test
  step "web build"
  pnpm --filter @h09a/web build
fi

if [[ "$needs_extension" -eq 1 ]]; then
  step "extension lint"
  pnpm --filter @h09a/extension lint
  step "extension typecheck"
  pnpm --filter @h09a/extension typecheck
  step "extension test"
  pnpm --filter @h09a/extension test
  step "extension build"
  pnpm --filter @h09a/extension build
fi

if [[ "$needs_desktop" -eq 1 ]]; then
  step "desktop lint"
  pnpm --filter @h09a/desktop lint
  step "desktop typecheck"
  pnpm --filter @h09a/desktop typecheck
  step "desktop-storage test"
  pnpm --filter @h09a/desktop-storage test
  step "desktop build"
  pnpm --filter @h09a/desktop build
fi

if [[ "$needs_api" -eq 1 ]]; then
  step "api ruff check"
  (
    cd apps/api
    if [[ -f .venv/Scripts/activate ]]; then
      # shellcheck disable=SC1091
      source .venv/Scripts/activate
    elif [[ -f .venv/bin/activate ]]; then
      # shellcheck disable=SC1091
      source .venv/bin/activate
    fi
    ruff check .
    ruff format --check .
  )

  if [[ "$needs_migration" -eq 1 ]]; then
    step "api alembic up-down-up"
    if [[ -z "${DATABASE_URL:-}" ]]; then
      echo "DATABASE_URL not set; skipping alembic migration check." >&2
      echo "Set DATABASE_URL and start pgvector postgres to verify migrations locally." >&2
    else
      (
        cd apps/api
        if [[ -f .venv/Scripts/activate ]]; then
          # shellcheck disable=SC1091
          source .venv/Scripts/activate
        elif [[ -f .venv/bin/activate ]]; then
          # shellcheck disable=SC1091
          source .venv/bin/activate
        fi
        alembic upgrade head
        alembic downgrade base
        alembic upgrade head
      )
    fi
  fi

  step "api pytest"
  (
    cd apps/api
    if [[ -f .venv/Scripts/activate ]]; then
      # shellcheck disable=SC1091
      source .venv/Scripts/activate
    elif [[ -f .venv/bin/activate ]]; then
      # shellcheck disable=SC1091
      source .venv/bin/activate
    fi
    if [[ -z "${DATABASE_URL:-}" ]]; then
      pytest --cov=app --cov-report=term -q
    else
      pytest --cov=app --cov-report=term -q
    fi
  )
fi

echo ""
echo "All pre-commit checks passed."
