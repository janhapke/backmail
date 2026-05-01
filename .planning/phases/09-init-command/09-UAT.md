---
status: complete
phase: 09-init-command
source: 09-01-SUMMARY.md, 09-02-SUMMARY.md, 09-03-SUMMARY.md
started: 2026-05-01T00:00:00Z
updated: 2026-05-01T00:01:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state. Run `npm run build` from clean state — should compile without errors. Then run `node dist/cli/index.js --help` — should print help output listing available commands including `init`.
result: pass

### 2. init Command Registration
expected: Running `node dist/cli/index.js init --help` shows the `init` command with all 7 options: `--host`, `--port`, `--username`, `--tls/--no-tls`, `--password`, and `--password-ref`, plus an optional `[path]` argument.
result: pass

### 3. Non-TTY Init Creates Repository Structure
expected: Running `node dist/cli/index.js init /tmp/test-backmail-repo --host imap.example.com --port 993 --username test@example.com --tls --password-ref env:TEST_PASS` (in a non-TTY context, e.g. piped stdin or a script) creates the directory structure: `/tmp/test-backmail-repo/.backmail/`, `.backmail/config.json`, `.backmail/log`, `/tmp/test-backmail-repo/archive/` (a git repo), and `/tmp/test-backmail-repo/worktrees/`.
result: pass

### 4. REPO-04 Guard — Already Exists Error
expected: Running `backmail init` on a directory that already has `.backmail/` exits immediately with an error message containing "Repository already exists" — without prompting for any input and without creating additional files.
result: pass

### 5. Non-TTY Mode — Missing Required Parameter Errors
expected: Running `node dist/cli/index.js init /tmp/some-path` with piped stdin (no TTY) and without providing `--host` (or any other required param) exits with an error message indicating the missing parameter is required — without entering any interactive prompt.
result: pass

### 6. Interactive TTY Mode — Prompts for All Parameters
expected: Running `backmail init` in a real terminal (TTY attached) prompts interactively for: IMAP host, port, username, TLS preference (yes/no), and password. After providing all values, the repository is created in the current directory with the correct structure.
result: pass

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
