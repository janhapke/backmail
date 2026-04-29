---
phase: 08-command-migration
plan: "01"
subsystem: core
tags:
  - cleanup
  - dead-code-removal
  - legacy-types
dependency_graph:
  requires: []
  provides:
    - clean-browse-module-no-legacy-types
  affects:
    - src/core/browse.ts
    - src/core/index.ts
    - tests/unit/browse.test.ts
tech_stack:
  added: []
  patterns:
    - Dead code deletion (no logic changes)
key_files:
  modified:
    - src/core/browse.ts
    - src/core/index.ts
    - tests/unit/browse.test.ts
decisions:
  - "Confirmed integration test failures are pre-existing (Docker/IMAP not running in CI) — not caused by these changes"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-29T21:34:40Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 8 Plan 01: Remove Legacy Account Types and resolveAccount Summary

**One-liner:** Deleted LegacyAccountConfig, LegacyBackmailConfig, and resolveAccount from browse.ts, removed the re-export from core/index.ts, and scrubbed the five-case test describe block from browse.test.ts.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Delete legacy types and resolveAccount from browse.ts | 43d5e47 | src/core/browse.ts |
| 2 | Remove resolveAccount re-export from core/index.ts and scrub browse.test.ts | 1192661 | src/core/index.ts, tests/unit/browse.test.ts |

## What Was Done

**Task 1** removed three items from `src/core/browse.ts` that Phase 7 kept under a "Kept for Phase 8 removal" comment:
- `LegacyAccountConfig` interface (48 lines total including both interfaces and function)
- `LegacyBackmailConfig` interface
- `resolveAccount` function

The `MessageSummary` interface, all browse functions (`getLog`, `checkoutCommit`, `listFolders`, `listMessages`, `viewMessage`), and all helper functions remain intact.

**Task 2** made two coordinated changes:
1. In `src/core/index.ts` — removed `resolveAccount` from the named re-export list in the Phase 4 Browse module block. `getPasswordByRef` (D-08) was verified still present.
2. In `tests/unit/browse.test.ts` — replaced stale type imports (`BackmailConfig`, `AccountConfig`) with just `MessageSummary`, removed `resolveAccount` named import, and deleted the entire 62-line `describe('resolveAccount', ...)` block with its five test cases.

## Verification Results

- `npm run build` exits 0 with 0 TypeScript errors
- `npx vitest run tests/unit/` — 9 test files, 119 tests passed, 1 skipped (120 total)
- `grep -rn "resolveAccount|LegacyAccountConfig|LegacyBackmailConfig" src/` — no matches
- `getPasswordByRef` confirmed still exported from `src/core/index.ts`
- All browse functions (`getLog`, `checkoutCommit`, `listFolders`, `listMessages`, `viewMessage`) confirmed still exported

## Deviations from Plan

None — plan executed exactly as written.

The integration test suite has 18 pre-existing failures (imap-connect, restore-sync, cli-browse, cli-restore) caused by Docker/IMAP service unavailability — confirmed by testing against a clean baseline. These failures are not caused by any changes in this plan.

## Threat Flags

None — this plan is pure deletion of dead code with no new attack surface introduced.

## Known Stubs

None — no placeholder values or unimplemented features in modified files.

## Self-Check: PASSED

- [x] `src/core/browse.ts` — exists, no legacy types
- [x] `src/core/index.ts` — exists, no resolveAccount export
- [x] `tests/unit/browse.test.ts` — exists, no resolveAccount describe block
- [x] Commit 43d5e47 — exists (Task 1)
- [x] Commit 1192661 — exists (Task 2)
