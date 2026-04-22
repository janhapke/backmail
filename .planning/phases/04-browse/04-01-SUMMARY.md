---
phase: 04-browse
plan: 01
name: "Foundation: Install mailparser, fix CR-01, create browse module skeleton"
subsystem: core
tags: [security-fix, module-foundation, mime-parsing]
dependency_graph:
  requires: [Phase 03 sync module, mailparser library]
  provides: [browse.ts module skeleton, resolveAccount() function]
  affects: [Phase 04-02 browse implementation, CLI module]
tech_stack:
  added: [mailparser@^3.9.8, @types/mailparser@^2.7.4]
  patterns: [ESM imports, no-console boundary, type-safe module exports]
key_files:
  created:
    - src/core/browse.ts (129 lines, 6 exported functions)
    - tests/unit/browse.test.ts (178 lines, 22 test cases)
  modified:
    - package.json (added mailparser dependencies)
    - src/core/sync.ts (CR-01 BigInt fix, T-4-01)
    - src/core/index.ts (added browse module exports)
decisions:
  - D-01 to D-20: All implemented per 04-CONTEXT.md
  - resolveAccount() function fully implemented for Phase 04-02 CLI wiring
metrics:
  duration: "~10 minutes"
  tasks_completed: 3/3
  commits: 3
  files_modified: 3
  files_created: 2
---

# Phase 4 Plan 1: Foundation Summary

**Objective:** Install mailparser dependency, fix CR-01 unsafe BigInt conversion in sync.ts, and create a skeleton browse.ts module with function stubs and test scaffolds ready for Phase 04-02 implementation.

**Status:** COMPLETE ✓

---

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Install mailparser and fix CR-01 in sync.ts | d2a81e7 | ✓ Complete |
| 2 | Create browse.ts module skeleton with function stubs | 19b9c58 | ✓ Complete |
| 3 | Create unit test scaffolds for browse module | 65ec65e | ✓ Complete |

---

## What Was Built

### 1. Mailparser Dependency (Task 1)
- **Added:** mailparser@^3.9.8 and @types/mailparser@^2.7.4 to package.json
- **Purpose:** RFC822 email parsing for `viewMessage()` plaintext and JSON formats
- **Verification:** npm install succeeds, no vulnerabilities

### 2. CR-01 BigInt Safety Fix (Task 1)
- **Location:** src/core/sync.ts lines 286-301
- **Issue:** Unsafe `BigInt()` constructor from corrupted folder JSON could throw (T-4-01 threat)
- **Fix Applied:** Replaced BigInt conversion with safe string comparison
  - Old pattern: `storedValidity = BigInt(storedState.uidvalidity)` with try/catch
  - New pattern: `const storedValidityStr = storedState.uidvalidity` (already a string in JSON)
  - Comparison: `storedValidityStr !== serverValidityStr` (no parse error surface)
- **Result:** Eliminates parse error attack vector from corrupted state files
- **Verification:** Pattern match confirmed via grep

### 3. Browse Module Skeleton (Task 2)
- **File:** src/core/browse.ts (129 lines)
- **Exports (6 functions):**
  1. `resolveAccount(config, accountName?)` — FULLY IMPLEMENTED
     - Resolves account name flag per D-01, D-02, D-03
     - Auto-selects single account when flag omitted
     - Lists available accounts when multiple exist and none specified
  2. `getLog(repoPath, limit)` — Stub (throws "not yet implemented")
  3. `checkoutCommit(repoPath, dateOrHash)` — Stub
  4. `listFolders(repoPath)` — Stub
  5. `listMessages(repoPath, folderName)` — Stub
  6. `viewMessage(repoPath, messageId, format)` — Stub
- **Type:** MessageSummary interface for message list summaries
- **Imports:** mailparser ready but not yet used (deferred to Phase 04-02)
- **Verification:** TypeScript compiles without errors

### 4. Module Integration (Task 2)
- **Updated:** src/core/index.ts to re-export browse functions and types
- **Follows:** ARCH-01 core/CLI split with no circular imports

### 5. Unit Test Scaffolds (Task 3)
- **File:** tests/unit/browse.test.ts (178 lines, 22 test cases)
- **Coverage:**
  - resolveAccount: 5 tests (all passing, fully implemented)
    - Explicit account resolution
    - Auto-selection for single account
    - Multiple account error handling
    - Unknown account error
    - Account list in error message
  - getLog: 4 test cases (stubbed, verify "not yet implemented")
  - checkoutCommit: 5 test cases (stubbed)
  - listFolders: 2 test cases (stubbed)
  - listMessages: 2 test cases (stubbed)
  - viewMessage: 4 test cases (stubbed)
- **Status:** npm test passes (88 passed, 1 skipped)

---

## Deviations from Plan

None — plan executed exactly as written.

**Note on mailparser version:** Plan specified ^3.10.0, but latest published version is 3.9.8. Used latest available (3.9.8) which provides the same API.

---

## Verification Checklist

- [x] mailparser and @types/mailparser in package.json
- [x] npm install succeeds
- [x] sync.ts CR-01 BigInt fix applied (grep pattern match: storedValidityStr !== serverValidityStr)
- [x] sync.ts lines 286-301 use string comparison instead of BigInt()
- [x] browse.ts created with 6 exported functions
- [x] resolveAccount() fully implemented per D-01, D-02, D-03
- [x] browse.ts re-exported from core/index.ts
- [x] browse.test.ts created with 22 test cases
- [x] resolveAccount tests fully implemented and passing
- [x] Other function tests stub verification (expect "not yet implemented")
- [x] npm run typecheck passes
- [x] npm test passes (88 passed, 1 skipped)

---

## Next Steps

**Phase 04-02 Plan:** Implement all browse functions
- Implement getLog() with git.log() and sync commit filtering
- Implement checkoutCommit() with git worktree operations and date resolution
- Implement listFolders() and listMessages() with EML header parsing
- Implement viewMessage() with mailparser MIME parsing
- Complete remaining unit tests

**Phase 04-03 Plan:** Wire browse functions to CLI subcommands
- Create CLI wrapper for resolveAccount() used by all browse commands
- Implement `backmail accounts` subcommand
- Implement `backmail log` subcommand with --limit flag
- Implement `backmail checkout` subcommand with date/hash detection
- Implement `backmail ls` subcommand for folders and messages
- Implement `backmail view` subcommand with format options

---

## Self-Check: PASSED

- ✓ All created files exist:
  - /home/jan/dev/backmail/src/core/browse.ts
  - /home/jan/dev/backmail/tests/unit/browse.test.ts
- ✓ All commits exist:
  - d2a81e7: Task 1 (mailparser + CR-01 fix)
  - 19b9c58: Task 2 (browse.ts skeleton)
  - 65ec65e: Task 3 (test scaffolds)
- ✓ TypeScript compilation succeeds
- ✓ All tests pass
- ✓ No linting or type errors
