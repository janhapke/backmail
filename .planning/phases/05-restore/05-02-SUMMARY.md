---
phase: 05-restore
plan: 02
name: "Core restore module implementation with IMAP operations"
date_completed: 2026-04-24
duration_minutes: 15
status: complete
subsystem: restore
tags:
  - implementation
  - core-module
  - imap-operations
  - restore-functionality
dependency_graph:
  requires:
    - 05-01-PLAN (test infrastructure with stubs)
  provides:
    - core-restore-module
    - restore-account-function
    - imap-url-parsing
    - duplicate-checking
    - folder-creation
  affects:
    - 05-03-PLAN.md (CLI wiring and integration tests)
tech_stack:
  added:
    - restore.ts core module with parseImapUrl, isDuplicate, createFolderIfNeeded, restoreAccount
    - ImapFlow IMAP operations (APPEND, SEARCH, CREATE)
    - Node.js URL constructor for safe URL parsing
  patterns:
    - ImapFlow patterns from sync.ts (logger:false, mailbox locks, try/finally)
    - Error accumulation without aborting on per-message failures
    - Dry-run implementation (null client, no writes)
key_files:
  created:
    - src/core/restore.ts (274 lines)
  modified:
    - src/core/index.ts (added Phase 5 exports)
metrics:
  total_tasks: 2
  tasks_completed: 2
  lines_of_code: 274
  unit_tests_passing: 16/16
  requirement_coverage: REST-01, REST-02, REST-03, REST-04
---

# Phase 5 Plan 2: Core Restore Module Implementation Summary

## One-Liner

Implemented core restore module (src/core/restore.ts) with URL parsing, IMAP operations, duplicate checking, and folder creation — all 16 unit tests passing, REST-01 through REST-04 fully implemented.

## Objective

Build the core restore logic: `restoreAccount()` function that reads from a local git checkout and writes messages to a target IMAP server with optional duplicate checking and dry-run support.

## Execution Summary

Both tasks completed successfully. All 16 unit tests pass, validating REST-01 through REST-04 requirements.

### Task 1: Implement Core Restore Module with URL Parsing and IMAP Operations

**File:** `src/core/restore.ts`
**Status:** Complete
**Commit:** 6aa8952

Implemented the complete restore module with:

**Public Interfaces:**
- `RestoreOptions` — Configuration flags (skipDuplicates, dryRun, verbose)
- `RestoreResult` — Result counts (uploaded, skipped, errors)

**Helper Functions:**
- `parseImapUrl()` — Parses `imap://user:pass@host:port` or `imaps://...` URLs using Node.js URL constructor
  - Validates protocol (imap:// or imaps://)
  - Extracts and validates credentials (username, password)
  - Determines TLS setting and port (defaults: 143 for imap, 993 for imaps)
  - Handles percent-encoded credentials safely
  - Throws descriptive errors for missing/invalid inputs
  
- `isDuplicate()` — Checks if a message already exists in target folder
  - Uses ImapFlow.search() with Message-ID header criterion
  - Acquires and releases mailbox lock properly (try/finally)
  - Returns boolean indicating duplicate status
  
- `createFolderIfNeeded()` — Creates missing folders on target server
  - Calls ImapFlow.mailboxCreate() for each folder
  - Gracefully ignores "already exists" errors
  - Re-throws permission/connectivity errors

**Main Function:**
- `restoreAccount()` — Orchestrates the entire restore process
  - Resolves checkout path (via checkoutCommit() if date/commit provided)
  - Parses target URL and creates ImapFlow connection
  - Creates all folders on target server before upload
  - For each message:
    - Optional duplicate check (SEARCH by Message-ID) when skipDuplicates=true
    - Reads message from local .eml file (with proper Message-ID sanitization)
    - APPENDs message to target folder (with mailbox lock)
    - Accumulates errors without aborting (continues on per-message failures)
  - Dry-run mode: skips connection and writes, outputs same format as live
  - Returns result { uploaded, skipped, errors }

**Implementation Details:**
- Follows sync.ts patterns exactly: logger:false, mailbox lock/finally, error accumulation
- Implements all D-01 through D-19 decisions from 05-CONTEXT.md
- Covers all REST-01 through REST-04 requirements
- ARCH-01 compliant: no console.*, no process.exit, no CLI imports
- T-3-03 enforced: ImapFlow constructor always has logger:false
- T-5-01 satisfied: URL parsing uses Node.js URL constructor (safe)
- T-5-02 addressed: URL parsing doesn't leak credentials (CLI layer handles error sanitization)
- All 6 pitfalls avoided:
  1. Default ports (143/993) handled correctly
  2. Mailbox locks always released in finally blocks
  3. Dry-run is advisory (duplicate check skipped for simplicity per D-12)
  4. Credentials never printed in error messages (deferred to CLI)
  5. Folder "already exists" errors handled gracefully
  6. Message-ID sanitized using imported function

### Task 2: Export Restore Types and Functions from Core Index

**File:** `src/core/index.ts`
**Status:** Complete
**Commit:** c388c99

Added Phase 5 exports following Phase 3/4 pattern:
```typescript
// Phase 5: Restore module public API
export type { RestoreResult, RestoreOptions } from './restore.js'
export { restoreAccount } from './restore.js'
```

**Verification:**
- Exports use .js extension (nodenext moduleResolution per ARCH-01)
- Only public types and functions exported (RestoreResult, RestoreOptions, restoreAccount)
- No circular imports (restore.ts only imports AccountConfig type from index.ts)
- Matches Phase 3/4 export patterns exactly

## Test Results

### Unit Tests (16/16 PASSING)

All unit tests transition from RED (05-01-PLAN) to GREEN (05-02-PLAN):

**REST-01: Basic Message Restore (7 tests)**
- ✓ parseImapUrl() validates imap:// URLs with username and password
- ✓ parseImapUrl() validates imaps:// URLs
- ✓ parseImapUrl() uses default port 143 for imap:// when port absent
- ✓ parseImapUrl() uses default port 993 for imaps:// when port absent
- ✓ parseImapUrl() throws when URL has no password
- ✓ parseImapUrl() throws when protocol is not imap:// or imaps://
- ✓ parseImapUrl() decodes percent-encoded credentials

**REST-02: Duplicate Checking (3 tests)**
- ✓ isDuplicate() checks for existing Message-ID in target folder
- ✓ isDuplicate() returns false when Message-ID not found
- ✓ isDuplicate() releases mailbox lock even if search fails

**REST-03: Dry-Run Flag Handling (2 tests)**
- ✓ When dryRun=true, restoreAccount() does not connect for writes
- ✓ When dryRun=false, restoreAccount() connects and performs APPEND

**REST-04: Folder Creation (2 tests)**
- ✓ createFolderIfNeeded() calls ImapFlow.mailboxCreate() for each folder
- ✓ createFolderIfNeeded() ignores "already exists" errors

**Error Handling and Accumulation (2 tests)**
- ✓ On per-message APPEND failure, restoreAccount() continues and accumulates error count
- ✓ restoreAccount() returns { uploaded, skipped, errors } result

### Build Verification

- ✓ TypeScript parses without errors
- ✓ No circular import errors
- ✓ All imports resolve correctly
- ✓ Module exports are correct

## Acceptance Criteria Status

| Criterion | Status | Evidence |
|-----------|--------|----------|
| src/core/restore.ts exists and is valid TypeScript | ✓ | File created, npm test passes |
| parseImapUrl() validates imap:// and imaps:// URLs with credentials | ✓ | 7 unit tests pass |
| parseImapUrl() extracts host, port, username, password, secure flag | ✓ | Default port logic verified |
| isDuplicate() calls ImapFlow.search() with message-id header | ✓ | 3 unit tests pass |
| isDuplicate() always releases mailbox lock in finally | ✓ | Code review + test coverage |
| createFolderIfNeeded() calls mailboxCreate() and ignores "already exists" | ✓ | 2 unit tests pass |
| restoreAccount() accepts correct parameters | ✓ | Function signature matches spec |
| restoreAccount() returns RestoreResult with { uploaded, skipped, errors } | ✓ | 2 unit tests verify shape |
| Unit tests transition from RED to GREEN | ✓ | 16/16 tests passing |
| Exports added to src/core/index.ts | ✓ | 2 exports verified |
| No circular imports or TypeScript errors | ✓ | npm test clean |

## Known Limitations

1. **Folder path reversal is approximate:** The reverse of `folderPathToFilename()` (replacing `_` with `/`) is simple and works for typical IMAP folder names. For perfect 1:1 restoration with special characters, consider storing the original folder path in `folders/*.json` metadata (future improvement, out of scope for this plan).

2. **Dry-run duplicate counts may differ from live run:** Per D-12 (design decision), dry-run skips both SEARCH and APPEND operations. This means if the target already has messages, dry-run will report different counts than a live run. This is intentional (dry-run is advisory, not exact) and documented in decisions.

## Deviations from Plan

None - plan executed exactly as written.

All code matches the implementation template provided in the plan. All helper functions implement the specified patterns from RESEARCH.md. All threat mitigations are in place. All decisions D-01 through D-19 are implemented.

## Verification Results

### File Structure
- ✓ `src/core/restore.ts` (274 lines) — exceeds minimum implementation
- ✓ `src/core/index.ts` — exports added

### Requirements Coverage
| Requirement | Status | Evidence |
|------------|--------|----------|
| REST-01 | ✓ Implemented | restoreAccount() uploads messages via APPEND |
| REST-02 | ✓ Implemented | isDuplicate() uses SEARCH before APPEND |
| REST-03 | ✓ Implemented | dryRun=true skips connection and writes |
| REST-04 | ✓ Implemented | createFolderIfNeeded() called for all folders |

### Test Coverage
- Unit tests: 16/16 passing (RED→GREEN transition)
- Integration tests: Deferred to 05-03-PLAN (CLI layer)
- CLI tests: Deferred to 05-03-PLAN (subcommand wiring)

## Next Steps

**05-03-PLAN.md:** CLI restore subcommand implementation
- Wire `restore [<date|commit>] --to <imap-url>` subcommand in src/cli/index.ts
- Implement output formatting per D-14, D-15, D-16
- Handle error messages per Pitfall 4 (password sanitization)
- Implement --skip-duplicates, --dry-run, --verbose, --account options
- Transition CLI and integration tests from RED to GREEN state

## Self-Check: PASSED

All files exist and commits verified:
- ✓ `src/core/restore.ts` created and committed (6aa8952)
- ✓ `src/core/index.ts` modified and committed (c388c99)
- ✓ `npm test -- tests/unit/restore.test.ts` — 16/16 passing
- ✓ No TypeScript errors
- ✓ No circular imports
- ✓ Exports verified in index.ts
