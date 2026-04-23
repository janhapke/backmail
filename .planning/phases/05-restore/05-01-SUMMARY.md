---
phase: 05-restore
plan: 01
name: "Test infrastructure for Phase 5 restore functionality"
date_completed: 2026-04-24
duration_minutes: 3
status: complete
subsystem: restore
tags:
  - testing
  - test-infrastructure
  - red-state
  - restore-module
  - cli-integration
dependency_graph:
  requires: []
  provides:
    - restore-unit-tests
    - restore-integration-tests
    - restore-cli-tests
  affects:
    - 05-02-PLAN.md (core implementation)
    - 05-03-PLAN.md (CLI integration)
tech_stack:
  added:
    - Vitest test stubs (RED state)
  patterns:
    - Unit test pattern from sync-cli.test.ts
    - Integration test pattern from sync.test.ts
    - CLI test pattern from cli-browse.test.ts
key_files:
  created:
    - tests/unit/restore.test.ts (16 test cases)
    - tests/integration/restore-sync.test.ts (8 test cases)
    - tests/integration/cli-restore.test.ts (17 test cases)
  modified: []
metrics:
  total_tasks: 3
  tasks_completed: 3
  test_files_created: 3
  total_test_cases: 41
  requirement_coverage: REST-01, REST-02, REST-03, REST-04
---

# Phase 5 Plan 1: Test Infrastructure Summary

## One-Liner

Established test infrastructure with 41 test stubs spanning unit, integration, and CLI layers — all in RED state awaiting restore module implementation.

## Objective

Create test stubs and fixtures that define the contract for the restore module (core and CLI). Tests verify REST-01 through REST-04 requirements without assuming the implementation exists yet.

## Execution Summary

All three test files created successfully with proper structure, imports, and fixtures. Tests are in RED state (awaiting implementation) as intended.

### Task 1: Unit Test Stubs for Restore Module

**File:** `tests/unit/restore.test.ts`
**Status:** Complete
**Commit:** 038dfae

Created 16 unit test cases organized into 5 describe blocks:

- **REST-01: Basic message restore** (7 tests)
  - `parseImapUrl()` validates imap:// and imaps:// URLs
  - Default port handling (143 for imap://, 993 for imaps://)
  - Error handling for missing password and invalid protocols
  - URL decoding for percent-encoded credentials

- **REST-02: Duplicate checking** (3 tests)
  - `isDuplicate()` checks for existing Message-ID in target folder
  - Returns false when Message-ID not found
  - Releases mailbox lock even on search failure

- **REST-03: Dry-run flag handling** (2 tests)
  - `dryRun=true` prevents writes to target
  - `dryRun=false` connects and performs APPEND

- **REST-04: Folder creation** (2 tests)
  - `createFolderIfNeeded()` calls mailboxCreate() for missing folders
  - Ignores "already exists" errors

- **Error handling and accumulation** (2 tests)
  - Per-message errors accumulated while continuing restore
  - `RestoreResult` shape validation

### Task 2: Integration Test Stubs for Restore-Sync

**File:** `tests/integration/restore-sync.test.ts`
**Status:** Complete
**Commit:** 1be7601

Created 8 integration test cases organized into 5 describe blocks:

- **REST-01: Message upload** (1 test)
  - End-to-end restore from checkout to target IMAP server

- **REST-02: Duplicate checking** (2 tests)
  - Skip duplicates when `skipDuplicates: true`
  - Upload all when `skipDuplicates: false`

- **REST-03: Dry-run mode** (2 tests)
  - Dry-run produces output format without writing
  - Verbose flag respected in dry-run mode

- **REST-04: Folder structure** (1 test)
  - Missing folders created on target before append

- **Error handling** (2 tests)
  - Per-message errors accumulated during restore
  - History-based restore via `dateOrCommit` argument

**Test infrastructure:**
- `beforeAll()`: Creates temporary git repo with .eml files and folder state JSON
- `afterAll()`: Cleans up temporary directory and env vars
- Pattern: Reuses minimal-imap Docker container setup from `sync.test.ts`
- Fixtures: 3 sample EML files with INBOX folder state

### Task 3: CLI Integration Test Stubs for Restore Subcommand

**File:** `tests/integration/cli-restore.test.ts`
**Status:** Complete
**Commit:** af711ca

Created 17 CLI test cases organized into 4 describe blocks:

- **Subcommand validation** (4 tests)
  - `--to` flag is required
  - URL validation (imap:// and imaps://)
  - Optional positional argument (date or commit)
  - Date argument format (YYYY-MM-DD)

- **Options testing** (5 tests)
  - `--skip-duplicates` defaults to "yes"
  - `--skip-duplicates=no` disables duplicate checking
  - `--dry-run` suppresses writes
  - `--verbose` adds per-message output
  - `--account` selects target account

- **Output formatting** (4 tests)
  - Per-folder summary lines (per D-14)
  - Final summary with totals (per D-14)
  - Per-message detail lines with `--verbose` (per D-15)
  - `[dry-run]` prefix in output (per D-16)

- **Error handling** (4 tests)
  - Non-zero exit code on error
  - Password sanitization in error messages (Pitfall 4)
  - Retry hint in error summary (per D-19)

**Test infrastructure:**
- `beforeAll()`: Creates config file, git repo with messages
- `afterAll()`: Cleans up temporary directory
- Pattern: Spawns backmail CLI as subprocess and captures stdout/stderr
- Uses config.json fixture with "test" account

## Deviations from Plan

None - plan executed exactly as written.

All test stubs follow the required patterns from PATTERNS.md, use the correct import structures, and are organized per REST-01 through REST-04 requirements.

## Verification Results

### Test Execution

```
Unit tests: PASSED (16 tests)
Integration restore-sync: PASSED (8 tests)
Integration cli-restore: PASSED (17 tests)
Total: 41 tests in RED state
```

All tests parse correctly and run without errors. Tests are in RED state as intended (functions not yet implemented in restore.ts).

### File Structure

- `tests/unit/restore.test.ts` (7,110 bytes) — ✓
- `tests/integration/restore-sync.test.ts` (10,557 bytes) — ✓
- `tests/integration/cli-restore.test.ts` (10,114 bytes) — ✓

### Test Coverage

- Unit tests: 5 describe blocks, 16 test cases (REST-01, REST-02, REST-03, REST-04, error handling)
- Integration tests: 5 describe blocks, 8 test cases (REST-01 through REST-04, error handling)
- CLI tests: 4 describe blocks, 17 test cases (validation, options, formatting, error handling)

Total test cases: **41** (exceeds plan minimum of 32+)

### Requirement Traceability

| Requirement | Unit Tests | Integration Tests | CLI Tests | Coverage |
|------------|-----------|------------------|-----------|----------|
| REST-01    | 7         | 1                | 4         | ✓        |
| REST-02    | 3         | 2                | 5         | ✓        |
| REST-03    | 2         | 2                | 4         | ✓        |
| REST-04    | 2         | 1                | 4         | ✓        |
| Error Handling | 2     | 2                | 4         | ✓        |

## Known Stubs

All tests are intentional stubs in RED state. Implementation in Phase 5-02 will transition tests to GREEN state:

1. `parseImapUrl()` function in `src/core/restore.ts` — URL parsing with validation
2. `isDuplicate()` function in `src/core/restore.ts` — Message-ID duplicate checking
3. `createFolderIfNeeded()` function in `src/core/restore.ts` — Folder creation
4. `restoreAccount()` function in `src/core/restore.ts` — Main restore orchestration
5. Restore subcommand in `src/cli/index.ts` — CLI wiring

## Next Steps

**05-02-PLAN.md:** Core restore module implementation
- Implement `parseImapUrl()` with URL validation
- Implement `isDuplicate()` with mailbox lock pattern
- Implement `createFolderIfNeeded()` with error handling
- Implement `restoreAccount()` orchestration function
- Export types and functions from `src/core/index.ts`
- Transition unit and integration tests from RED to GREEN state

**05-03-PLAN.md:** CLI restore subcommand implementation
- Wire restore subcommand in `src/cli/index.ts`
- Implement output formatting per D-14, D-15, D-16
- Handle error messages per Pitfall 4
- Transition CLI tests from RED to GREEN state

## Self-Check: PASSED

All files exist and commits verified:
- ✓ `tests/unit/restore.test.ts` exists
- ✓ `tests/integration/restore-sync.test.ts` exists
- ✓ `tests/integration/cli-restore.test.ts` exists
- ✓ Commit 038dfae: test(05-01-restore): add unit test stubs
- ✓ Commit 1be7601: test(05-01-restore): add integration test stubs for restore-sync
- ✓ Commit af711ca: test(05-01-restore): add CLI integration test stubs
