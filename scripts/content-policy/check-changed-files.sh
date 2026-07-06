#!/usr/bin/env bash
# Fail if added/changed diff lines contain non-ASCII text (English-only policy).
set -euo pipefail

base_ref=${1:?usage: check-changed-files.sh <base-ref> [head-ref]}
head_ref=${2:-HEAD}

python3 - "${base_ref}" "${head_ref}" <<'PY'
import subprocess
import sys


def is_ascii(text: str) -> bool:
    try:
        text.encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


base_ref, head_ref = sys.argv[1], sys.argv[2]

numstat = subprocess.run(
    ["git", "diff", "--numstat", f"{base_ref}...{head_ref}"],
    check=True,
    capture_output=True,
    text=True,
).stdout

files: list[str] = []
for line in numstat.splitlines():
    parts = line.split("\t")
    if len(parts) != 3:
        continue
    added, deleted, path = parts
    if added == "-" or deleted == "-":
        continue
    files.append(path)

if not files:
    print("No scannable text files changed.")
    sys.exit(0)

violations: list[str] = []

for path in files:
    diff = subprocess.run(
        ["git", "diff", f"{base_ref}...{head_ref}", "--unified=0", "--", path],
        check=True,
        capture_output=True,
        text=True,
    ).stdout

    for line in diff.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        content = line[1:]
        if not is_ascii(content):
            violations.append(f"{path}: {content.strip()[:120]}")

if violations:
    print("Non-English (non-ASCII) text found in changed lines:")
    for item in violations[:25]:
        print(f"  - {item}")
    if len(violations) > 25:
        print(f"  ... and {len(violations) - 25} more")
    sys.exit(1)

print(f"Scanned {len(files)} changed file(s); changed lines are English-only (ASCII).")
PY
