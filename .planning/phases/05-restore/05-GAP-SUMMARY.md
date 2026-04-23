---
phase: 05-restore
plan: GAP
type: execute
completed: true
completed_at: "2026-04-24T00:45:00Z"
subsystem: restore
tags:
  - gap-closure
  - TypeScript-compilation
  - test-implementation
  - CLI-refactor
dependency_graph:
  requires:
    - "05-01-PLAN (Core restore module implementation)"
  provides:
    - "Working TypeScript build with no compilation errors"
    - "Real test implementations (not stubs) across unit/integration/CLI layers"
    - "Accessible CLI restore subcommand without config dependency"
  affects:
    - "Phase 5 verification: all must-haves now achievable"
    - "REST-01 through REST-04 requirements fully testable"
tech_stack:
  added:
    - "Export mechanism for helper functions (parseImapUrl, isDuplicate, createFolderIfNeeded)"
    - "Deferred config loading in CLI (getConfig helper)"
  patterns:
    - "Type narrowing for union types (results !== false && results.length)"
    - "Mailbox lock management with try/finally blocks"
    - "Per-command config loading at action handler level"
key_files:
  created: []
  modified:
    - "src/core/restore.ts (2 lines: type narrowing + append signature)"
    - "tests/unit/restore.test.ts (122 lines: 17 real unit tests)"
    - "tests/integration/restore-sync.test.ts (195 lines: 8 real integration tests)"
    - "tests/integration/cli-restore.test.ts (265 lines: 16+ CLI tests)"
    - "src/cli/index.ts (CLI config loading refactoring)"
decisions:
  - "Export parseImapUrl, isDuplicate, createFolderIfNeeded for unit testing (testability requirement)"
  - "Use getConfig() helper at action handler level to defer config loading (accessibility requirement)"
  - "Guard against false return from ImapFlow.search() with type narrowing (type safety requirement)"
  - "Implement all test bodies as real logic, not trivial stubs (verification requirement)"
metrics:
  duration: "~7 minutes"
  completed_date: "2026-04-24"
  tasks: 4
  files_modified: 5
  commits: 4
  lines_added: ~590
  lines_removed: ~90
---

# Phase 5 Plan GAP: Close Verification Gaps - COMPLETE

## Summary

Gap-closure plan executed successfully. All three critical gaps identified in Phase 5 verification have been resolved:

1. **TypeScript Compilation Errors** — FIXED
   - Line 98 in isDuplicate(): Fixed type narrowing — `return results !== false && results.length > 0`
   - Line 245 in restoreAccount(): Fixed append() signature — `append(folderPath, content, [])`
   - Build now succeeds with zero TypeScript errors

2. **Stub Test Infrastructure** — FIXED
   - 17 unit tests: Replaced stubs with real parseImapUrl/isDuplicate/createFolderIfNeeded implementations
   - 8 integration tests: Replaced stubs with real restoreAccount() calls against minimal-imap fixtures
   - 16+ CLI tests: Replaced stubs with real backmail CLI spawn tests
   - All tests now have real test logic (not `expect(true).toBe(true)` placeholders)

3. **CLI Config Loading** — FIXED
   - Moved config loading from top-level to individual subcommand action handlers
   - `backmail restore --help` now works without a valid config file
   - All subcommands (sync, log, checkout, ls, view, accounts, restore) defer config loading

## Verification Status

### Must-Haves

- [x] TypeScript compilation succeeds: `npm run build` exits 0
- [x] Unit test suite transitions from stub placeholders to real test implementations
- [x] Integration test suite provides real test logic (not `expect(true).toBe(true)` stubs)
- [x] CLI restore subcommand is accessible via `backmail restore --help` without config file error

### Key Artifacts Verified

**src/core/restore.ts**
- ✓ Line 98: `return results !== false && results.length > 0` (type narrowing)
- ✓ Line 245: `await targetClient.append(folderPath, content, [])` (correct signature)
- ✓ Helper functions exported: `parseImapUrl`, `isDuplicate`, `createFolderIfNeeded`

**tests/unit/restore.test.ts**
- ✓ 17 tests implemented with real assertions
- ✓ REST-01: parseImapUrl tests (7 tests) — URL parsing, default ports, error cases
- ✓ REST-02: isDuplicate tests (3 tests) — duplicate checking, lock management, error handling
- ✓ REST-03/04: createFolderIfNeeded tests (4 tests) — folder creation, error handling
- ✓ Error handling tests (3 tests) — result shape validation

**tests/integration/restore-sync.test.ts**
- ✓ 8 integration tests with real restoreAccount() calls
- ✓ REST-01: Message upload from checkout to target (verified on IMAP server)
- ✓ REST-02: Duplicate checking with skip-duplicates flag (yes/no options)
- ✓ REST-03: Dry-run mode (output without writing to target)
- ✓ REST-04: Folder structure preserved on target before message append
- ✓ Error handling: Per-message APPEND error continuation

**tests/integration/cli-restore.test.ts**
- ✓ 16+ CLI tests with real backmail CLI subprocess spawning
- ✓ Validation: --to required, URL parsing, optional positional argument
- ✓ Options: --skip-duplicates, --dry-run, --verbose, --account
- ✓ Output: Summary lines, totals, dry-run prefix
- ✓ Error handling: Exit codes, password not leaked in errors

**src/cli/index.ts**
- ✓ Config loading refactored to action handlers
- ✓ getConfig() helper for error handling
- ✓ All subcommands updated: sync, log, checkout, ls, view, accounts, restore
- ✓ Subcommand --help works without config file

## Deviations from Plan

None. All plan requirements were implemented exactly as specified:

- ✓ Task 1: TypeScript errors fixed with exact line-specific changes
- ✓ Task 2: Unit test bodies implemented with exact test specifications
- ✓ Task 3: Integration test bodies implemented with exact test patterns
- ✓ Task 4: CLI test bodies + config loading refactor completed as specified

## Test Execution Results

**Unit Tests (17/17 passing)**
```
Test Files  1 passed (1)
     Tests  17 passed (17)
   Duration  343ms
```

**Build Status**
```
npm run build → exits 0 (no TypeScript errors)
```

**CLI Accessibility**
```
npx tsx src/cli/index.ts restore --help → prints help text without config error
```

## Known Stubs

None remaining. All test stubs have been replaced with real implementations.

## Threat Flags

None new. Mitigations for identified threats (T-5-01, T-5-02, T-5-03, T-5-04) are now implemented:

- T-5-01 (isDuplicate type error): Fixed with type narrowing
- T-5-02 (append() signature): Fixed with correct third argument
- T-5-03 (password in errors): Protected by error message sanitization in CLI layer (already present)
- T-5-04 (config blocks CLI): Fixed by deferring config loading to action handlers

## Implementation Notes

### Type Safety Improvement

The two TypeScript fixes ensure ImapFlow types are properly handled:
- `client.search()` returns `number[] | false`, guarded before accessing `.length`
- `client.append()` signature requires `flags?: string[]` as third positional, not as object property

### Test Architecture

Tests follow project patterns:
- Unit tests use Vitest's `vi.fn()` for mocking ImapFlow
- Integration tests use real ImapFlow connections to minimal-imap fixtures
- CLI tests spawn the actual backmail CLI binary as subprocess

### CLI Accessibility Pattern

Config loading moved from CLI startup to subcommand execution:
- Allows help generation without config dependency
- Maintains error reporting when config is actually needed
- Pattern: `const config = getConfig()` at start of action handler

## Path Forward

Phase 5 verification gaps are now closed:
- Build succeeds with no TypeScript errors
- Test suite is real and comprehensive (40+ tests)
- CLI restore subcommand is fully accessible
- All REST-01 through REST-04 requirements are now verifiable

Ready for Phase 5 re-verification and Phase 6 advancement.

---

**Completed:** 2026-04-24T00:45:00Z  
**Executor:** Claude Sonnet 4.5  
**Plan:** 05-GAP-PLAN.md  
**Commits:** 4 (one per task)
