#!/usr/bin/env bash
# Fail if added/changed diff lines contain Chinese or em dash (U+2014).
set -euo pipefail

base_ref=${1:?usage: check-changed-files.sh <base-ref> [head-ref]}
head_ref=${2:-HEAD}

python3 - "${base_ref}" "${head_ref}" <<'PY'
import re
import subprocess
import sys

CJK_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]")
EM_DASH = "\u2014"


def find_violation(text: str) -> str | None:
    if EM_DASH in text:
        return "em dash (U+2014)"
    if CJK_RE.search(text):
        return "Chinese characters"
    return None


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
        reason = find_violation(content)
        if reason:
            violations.append(f"{path} ({reason}): {content.strip()[:120]}")

if violations:
    print("Forbidden content found in changed lines (no Chinese, no em dash):")
    for item in violations[:25]:
        print(f"  - {item}")
    if len(violations) > 25:
        print(f"  ... and {len(violations) - 25} more")
    sys.exit(1)

print(f"Scanned {len(files)} changed file(s); changed lines pass content policy.")
PY
