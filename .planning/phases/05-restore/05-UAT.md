---
status: complete
phase: 05-restore
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-GAP-SUMMARY.md, 05-GAP2-SUMMARY.md]
started: 2026-04-24T10:00:00Z
updated: 2026-04-24T10:00:00Z
---

## Current Test

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running backmail process. Run `backmail --help` or `npx tsx src/cli/index.ts --help` from the project root. The CLI prints its help text (listing all subcommands including `restore`) without any errors or uncaught exceptions.
result: pass

### 2. Restore Subcommand Help
expected: Run `backmail restore --help` (or `npx tsx src/cli/index.ts restore --help`). The output shows the restore subcommand usage including options: `--to <imap-url>` (required), `--account`, `--skip-duplicates`, `--dry-run`, `--verbose`. No config file error is shown — help works without a config.
result: pass

### 3. Missing --to Flag Validation
expected: Run `backmail restore` without the `--to` flag. The CLI exits with a non-zero code and prints an error indicating `--to` is required. No password or internal stack trace is shown.
result: pass

### 4. Restore Dry-Run Mode
expected: Run `backmail restore --dry-run --to imap://user:pass@localhost`. The CLI outputs a summary line prefixed with `[dry-run]` (e.g. `[dry-run] Total: N uploaded, N skipped`) without actually connecting to a target IMAP server to write messages. Exit code 0.
result: pass

### 5. Restore with Skip-Duplicates Default
expected: Run `backmail restore --dry-run --to imap://user:pass@localhost`. The `--skip-duplicates` option defaults to `yes` (enabled). The dry-run output reflects this. Running with `--skip-duplicates=no` changes behavior (output may differ). No error on either flag value.
result: issue
reported: "the skip-duplicates flag does not seem to have any effect on the dry-run. whether the flag is set to 'yes' or 'no' or omitted entirely, it always says '[dry-run] Total: 16 uploaded, 0 skipped'. when I run restore without dry-run, it correctly outputs 'Total: 3 uploaded, 13 skipped'. the dry-run should correctly detect duplicates and report that it would skip them."
severity: major

### 6. Error Message Sanitization
expected: Trigger a connection error by running `backmail restore --to imap://user:secretpassword@nonexistent-host`. The error message printed to stderr does NOT contain `secretpassword`. Instead, the URL password is replaced with `***`. Exit code 1.
result: pass

### 7. Folder Path Stored in Sync State
expected: After a sync has run (or checking existing sync state in the git repo), look at a file under `folders/*.json` in the repo. Each folder JSON contains a `folderPath` field with the original IMAP folder path (e.g. `"folderPath": "INBOX"` or `"folderPath": "Archive/2024"`). This means restore can reconstruct folder names accurately without reversing the filename encoding.
result: pass

### 8. Verbose Output Flag
expected: Run `backmail restore --dry-run --verbose --to imap://user:pass@localhost`. The output includes per-message detail lines in addition to the final summary line. Without `--verbose`, only the summary line is shown.
result: issue
reported: "there are no per-message detail lines, only the final summary"
severity: major

## Summary

total: 8
passed: 6
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "dry-run with --skip-duplicates=yes should detect existing messages on target and report them as skipped, matching live-run behavior"
  status: failed
  reason: "User reported: the skip-duplicates flag does not seem to have any effect on the dry-run. whether the flag is set to 'yes' or 'no' or omitted entirely, it always says '[dry-run] Total: 16 uploaded, 0 skipped'. when I run restore without dry-run, it correctly outputs 'Total: 3 uploaded, 13 skipped'. the dry-run should correctly detect duplicates and report that it would skip them."
  severity: major
  test: 5
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "--verbose flag should produce per-message detail lines during restore (e.g. 'Uploaded: <message-id>' or 'Skipped: <message-id>' for each message processed)"
  status: failed
  reason: "User reported: there are no per-message detail lines, only the final summary"
  severity: major
  test: 8
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
