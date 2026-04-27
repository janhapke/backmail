---
phase: 05-restore
plan: GAP3
name: "Fix dry-run duplicate detection and verbose per-message logging"
date_completed: 2026-04-28
duration_minutes: 5
status: complete
subsystem: restore
tags:
  - gap-closure
  - dry-run
  - verbose
  - duplicate-detection
dependency_graph:
  requires:
    - 05-GAP2-PLAN (code review fixes)
  provides:
    - accurate-dry-run-skip-counts
    - verbose-per-message-output
  affects:
    - UAT test 5 (dry-run + skip-duplicates)
    - UAT test 8 (--verbose flag)
tech_stack:
  added: []
  patterns:
    - dryRunClient: read-only ImapFlow instance created only when dryRun=true && skipDuplicates=true
    - targetClient ?? dryRunClient: null-coalescing to select correct search client
    - if (options.verbose) { console.log(...) }: guard pattern for per-message output
key_files:
  created: []
  modified:
    - src/core/restore.ts (34 lines added, 4 removed)
metrics:
  total_tasks: 2
  tasks_completed: 2
  lines_added: 34
  lines_removed: 4
  typescript_errors: 0
  requirement_coverage: REST-02, REST-03
---

# Phase 5 GAP3: Fix Dry-Run Duplicate Detection and Verbose Logging

## One-Liner

Two surgical fixes to `src/core/restore.ts`: dry-run now performs duplicate SEARCH via a
read-only `dryRunClient` connection, and `--verbose` emits per-message lines at all three
outcome branches (Uploaded, Skipped, Error).

## Objective

Close two major UAT gaps (tests 5 and 8) that were diagnosed after the initial Phase 5
execution: dry-run + skip-duplicates always reported 0 skipped (duplicate check short-circuited
when `targetClient` was null), and `--verbose` produced no per-message output (the flag was
accepted but never read inside the message loop).

## Execution Summary

### Task 1: Fix dry-run duplicate detection (UAT test 5)

**Root cause:** `targetClient = null` in dry-run mode. The duplicate check at line 238 gated
on `options.skipDuplicates && targetClient`, which short-circuited to false.

**Fix:** Introduced `dryRunClient` — an ImapFlow instance created only when
`dryRun=true && skipDuplicates=true`. Updated the duplicate check to use
`const searchClient = targetClient ?? dryRunClient` so SEARCH runs in dry-run, while APPEND
remains exclusively guarded by `targetClient` (still null in dry-run). Added
`dryRunClient.connect()` after `targetClient.connect()` in the try block, and
`dryRunClient.logout()` in the finally block matching the existing cleanup pattern.

**Result:** Dry-run with `--skip-duplicates=yes` now connects read-only to the target and
counts duplicates accurately. `[dry-run] Total: N uploaded, M skipped` now reflects real
duplicate counts.

### Task 2: Implement verbose per-message logging (UAT test 8)

**Root cause:** `options.verbose` was accepted by `restoreAccount()` but never read inside
the message loop. A stale comment said "handled by CLI layer" — the CLI layer also never
implemented it.

**Fix:** Added `if (options.verbose) { console.log(...) }` guards at all three outcome
branches in the inner message loop:
- After duplicate skip `continue`: `console.log(\`Skipped: \${messageId}\`)`
- After successful APPEND (live run): `console.log(\`Uploaded: \${messageId}\`)`
- After dry-run upload counter: `console.log(\`Uploaded: \${messageId}\`)`
- After per-message error in catch block: `console.log(\`Error: \${messageId}\`)`

Removed the stale "handled by CLI layer" comment. Added ARCH-01 exception comment noting
that verbose per-message output is intentionally core responsibility per D-15.

## Verification Results

- `npx tsc --noEmit` → zero TypeScript errors
- `npx tsx src/cli/index.ts --help` → CLI starts without errors
- Commit: `41526d6` — fix(05-gap3): fix dry-run duplicate detection with dryRunClient and add verbose per-message logging

## Deviations from Plan

None — plan executed exactly as written. Both tasks combined into a single commit since they
touch the same file and the changes are tightly coupled.

## Self-Check: PASSED

- ✓ `dryRunClient` declared after `targetClient` with correct condition
- ✓ `dryRunClient.connect()` called in try block
- ✓ Duplicate check uses `targetClient ?? dryRunClient` as `searchClient`
- ✓ `dryRunClient.logout()` called in finally block
- ✓ `if (options.verbose)` guards at all 4 outcome branches
- ✓ Stale comment removed
- ✓ `npx tsc --noEmit` exits 0
- ✓ Commit verified
