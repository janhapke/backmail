---
phase: 08-command-migration
plan: "02"
subsystem: cli
tags: [cli, commander, account-registry, cleanup, typescript]
dependency_graph:
  requires: []
  provides: [clean-cli-entry-point]
  affects: [src/cli/index.ts]
tech_stack:
  added: []
  patterns: [thin-cli-wrapper, commander-subcommands]
key_files:
  created: []
  modified:
    - src/cli/index.ts
decisions:
  - Remove getConfig() helper entirely rather than preserve it since no caller remains
  - Remove accounts subcommand in Task 1 (not Task 2) because it called the deleted getConfig() — ordering adjusted to avoid broken intermediate state
metrics:
  duration: ~10 minutes
  completed: "2026-04-29"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 08 Plan 02: CLI Account-Registry Cleanup Summary

Removed all account-registry remnants from `src/cli/index.ts`: the `getConfig()` helper, the `accounts` subcommand, the `resolveAccount` dead import, `--account <name>` option from every command, and `--all` from the `sync` command.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Remove resolveAccount import and getConfig helper | 7f9dfd9 | src/cli/index.ts |
| 2 | Remove accounts command, --account options, --all on sync, dead opts types | ca19f7c | src/cli/index.ts |

## Outcome

`src/cli/index.ts` now registers only options that actually do something. The `--help` output contains no mention of `--account`, `--all`, or the `accounts` subcommand. TypeScript build exits 0 with 0 errors.

**Options present after cleanup:**
- Global: `--workdir`
- sync: `--exclude-folder`, `--only-folder`, `--verbose`
- log: `--limit`
- view: `--format`
- restore: `--to`, `--skip-duplicates`, `--dry-run`, `--verbose`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Accounts subcommand removed in Task 1 (not Task 2)**
- **Found during:** Task 1
- **Issue:** After deleting `getConfig()`, the `accounts` subcommand block called the now-deleted function, causing a TypeScript compilation error. Leaving the file in this broken state between commits would violate the atomic-commit principle.
- **Fix:** Moved the `accounts` subcommand deletion from Task 2 to Task 1 — both are part of the same plan, no behavioral change.
- **Files modified:** src/cli/index.ts
- **Commit:** 7f9dfd9

**2. [Rule 2 - Missing correctness] Updated log command description text**
- **Found during:** Final verification
- **Issue:** `log` command description read "Show git commit history for account" — the word "account" in a help grep could mislead users into thinking an account option exists. Also stale language for the single-repo model.
- **Fix:** Changed description to "Show git commit history"
- **Files modified:** src/cli/index.ts
- **Note:** This change landed in an amended commit (from the parallel 08-01 agent) due to git staging overlap; functionally correct on disk.

## Known Stubs

None. All commands wire to real core functions.

## Threat Flags

None. This plan only removes CLI option registrations — no new network endpoints, auth paths, or schema changes introduced.

## Self-Check

Files exist:
- [x] src/cli/index.ts — present and correct

Commits exist:
- [x] 7f9dfd9 — Task 1 (resolveAccount import and getConfig helper removed)
- [x] ca19f7c — Task 2 (--account options, --all, accounts command removed)

## Self-Check: PASSED
