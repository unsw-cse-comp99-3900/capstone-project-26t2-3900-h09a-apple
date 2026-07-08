# Commit policy

This repo rejects **AI agent attribution** in git commit messages on pull requests.

## What we block

CI (`commit-policy` check) and optional local hooks scan commit bodies for known
AI tool trailers, including:

| Tool / agent           | Example pattern                                                                   |
| ---------------------- | --------------------------------------------------------------------------------- |
| Cursor                 | `Co-authored-by: Cursor`, `cursoragent@cursor.com`                                |
| GitHub Copilot         | `Co-authored-by: GitHub Copilot`, `copilot@github.com`                            |
| OpenAI Codex / ChatGPT | `Co-authored-by: ... Codex`, `OpenAI`, `ChatGPT`                                  |
| Claude / Anthropic     | `Co-authored-by: ... Claude`, `Anthropic`                                         |
| Other coding agents    | Devin, Aider, Gemini, Codeium, Tabnine (see `scripts/commit-policy/patterns.txt`) |

Patterns live in one file: `scripts/commit-policy/patterns.txt`. Edit that file
and the same rules apply in CI and local hooks.

## What we do **not** block

- Using an IDE with inline AI suggestions **without** adding AI co-author trailers.
- Human pair programming, unless you enable strict mode (below).
- PR descriptions, comments, or code style - only **commit message bodies** in the PR.

## Enforcement layers

| Layer                                  | Scope             | Blocks                                         |
| -------------------------------------- | ----------------- | ---------------------------------------------- |
| **CI `commit-policy`**                 | Every PR          | Forbidden trailers in commits on the branch    |
| **Local `commit-msg` hook**            | Your machine      | Same patterns before `git commit` completes    |
| **Cursor `beforeShellExecution` hook** | Cursor agent only | Agent running `git commit` / `git push`        |
| **Cursor rule**                        | Cursor agent only | Reminds agent not to commit or add AI trailers |

Cursor hooks **do not** stop Codex CLI, Copilot in another editor, or you typing
`git commit` manually. **CI is the team-wide gate.**

## Setup (recommended)

After clone:

```bash
./scripts/install-githooks.sh
./scripts/install-cursor-hooks.sh   # optional; writes gitignored .cursor/ locally
```

Templates for Cursor live under `scripts/cursor/` (committed). The `.cursor/`
directory is **gitignored** so IDE config stays on each developer's machine.

## Strict mode (optional)

To reject **any** `Co-authored-by:` line (including human pair commits):

```bash
export COMMIT_POLICY_STRICT=1
git commit ...
```

Not enabled in CI by default.

## If CI fails

1. Find the bad commit: `git log origin/main..HEAD --format=fuller`
2. Remove the trailer (`git rebase -i`, `git commit --amend`, or new clean commits).
3. Force-push the branch if needed.

## Branch protection

After H09AAPPLE-60, add `commit-policy` and `content-policy` to required checks alongside
`web`, `api`, `extension`, `pr-title`, and `visual-evidence`.

## PR title rules

Enforced by the `pr-title` check:

- Include a Jira key anywhere in the title, e.g. `H09AAPPLE-60`
- Follow Conventional Commits (`type: subject` or `[H09AAPPLE-60] type: subject`)

## Content policy (`content-policy`)

The `content-policy` check blocks only:

- **Chinese characters** (CJK unified ideographs)
- **Em dash** (Unicode U+2014, the long dash from Word) - use `--` or `-` instead

Other Unicode punctuation (arrows, smart quotes, ellipsis, en dash, etc.) is allowed.

Scope:

- PR **title** and **body**
- **Added/changed lines** in any changed text file (code, `docs/`, `README.md`, `.github/`, etc.)

It scans the **diff** only (not unchanged lines). Binary files are skipped. Typical
runtime: a few seconds plus checkout.
