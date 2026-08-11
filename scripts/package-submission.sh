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

append_paths() {
  # Append paths into an existing zip. Prefer zip CLI; fall back to Python.
  if command -v zip >/dev/null 2>&1; then
    zip -r "$OUT" "$@" -x "*.map"
    return
  fi

  python - "$OUT" "$@" <<'PY'
import sys
import zipfile
from pathlib import Path

out = Path(sys.argv[1])
roots = [Path(p) for p in sys.argv[2:]]

with zipfile.ZipFile(out, mode="a", compression=zipfile.ZIP_DEFLATED) as zf:
    existing = set(zf.namelist())
    for root in roots:
        root = root.resolve()
        if root.is_file():
            arc = root.name
            if arc.endswith(".map"):
                continue
            if arc not in existing:
                zf.write(root, arcname=arc)
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix == ".map":
                continue
            # Keep repo-relative paths when under cwd
            try:
                arc = path.relative_to(Path.cwd()).as_posix()
            except ValueError:
                arc = path.name
            if arc in existing:
                continue
            zf.write(path, arcname=arc)
print(f"Appended via Python zipfile: {', '.join(sys.argv[2:])}")
PY
}

echo "Appending apps/extension/dist ..."
append_paths apps/extension/dist

if [[ -f "$ROOT/SECRETS.txt" ]]; then
  echo "Appending SECRETS.txt (do not commit this file) ..."
  append_paths SECRETS.txt
fi

echo "Done: $OUT"
echo "Verify: unzip -l \"$OUT\" | grep -E 'apps/extension/dist/manifest.json|DEPLOYMENT_GUIDE|.env.example'"
# Portable listing when unzip is missing
python - "$OUT" <<'PY'
import sys
import zipfile
from pathlib import Path

out = Path(sys.argv[1])
with zipfile.ZipFile(out) as zf:
    names = zf.namelist()
checks = [
    "apps/extension/dist/manifest.json",
    "DEPLOYMENT_GUIDE.md",
    ".env.example",
]
print(f"zip size_mb={out.stat().st_size / (1024*1024):.2f} entries={len(names)}")
for c in checks:
    print(("OK  " if c in names else "MISS"), c)
bad = [n for n in names if "node_modules/" in n or ".venv/" in n]
print("node_modules_or_venv_entries=", len(bad))
PY
