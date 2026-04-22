---
phase: 04-browse
plan: 02
name: "Implementation: Full browse module functionality"
subsystem: core
tags: [browse-implementation, git-operations, mime-parsing, message-listing]
dependency_graph:
  requires: [Phase 04-01 foundation, simple-git, mailparser, sync module]
  provides: [complete browse.ts module, unit tests, integration tests]
  affects: [Phase 04-03 CLI wiring]
tech_stack:
  added: []
  patterns: [ESM imports, async error handling, git worktree operations, RFC822 parsing]
key_files:
  created:
    - tests/integration/browse.test.ts (236 lines, 15 integration tests)
  modified:
    - src/core/browse.ts (376 lines, fully implemented)
    - tests/unit/browse.test.ts (457 lines, 23 comprehensive tests)
    - vitest.config.ts (added integration test path)
decisions:
  - All decisions from 04-CONTEXT.md implemented (D-01 through D-20)
  - Used mailparser's simpleParser() for MIME parsing (plaintext, json formats)
  - Fast 4KB header-only read for listMessages to avoid full-body parsing
  - simple-git raw() API for git worktree operations (no typed API in 3.x)
  - Date-based checkout via git log with --after/--before date boundaries
metrics:
  duration: "~15 minutes"
  tasks_completed: 6/6
  commits: 3
  files_modified: 4
  unit_tests: 23
  integration_tests: 15
---

# Phase 4 Plan 2: Browse Implementation Summary

**Objective:** Implement all core browse functions (getLog, checkoutCommit, listFolders, listMessages, viewMessage) with comprehensive unit and integration tests.

**Status:** COMPLETE ✓

---

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1-3 | Implement getLog, checkoutCommit, listFolders, listMessages, viewMessage | 2a294ad | ✓ Complete |
| 4 | Re-export browse functions (already done by 04-01) | — | ✓ Complete |
| 5 | Write comprehensive unit tests | 89a4106 | ✓ Complete |
| 6 | Write integration tests | 7966940 | ✓ Complete |

---

## What Was Built

### 1. Full Browse Implementation (Task 1-3, Commit 2a294ad)

**File:** `src/core/browse.ts` (376 lines)

Implemented 6 exported functions + 4 helper functions:

#### Public Functions:
1. **getLog(repoPath, limit)** — Retrieve sync commit history
   - Calls `git.log()` with optional `maxCount` parameter
   - Filters results to sync format only: `/^\d{4}-\d{2}-\d{2}(\s\[partial\])?:\s+\+\d+\s+added\s+\/\s+-\d+\s+removed$/`
   - Returns array of commit message strings (newest first)
   - Supports `'unlimited'` for all commits

2. **checkoutCommit(repoPath, dateOrHash)** — Create git worktree snapshot
   - Detects date string (YYYY-MM-DD) vs commit hash via regex
   - For dates: resolves to last commit on that day using `git log --after/--before`
   - Creates `.worktrees/<name>` directory using `git worktree add`
   - Overwrites existing worktrees (removes then recreates)
   - Ensures `.worktrees/` in `.gitignore`
   - Returns `{path, sha}` with absolute path and 7-char short SHA

3. **listFolders(repoPath)** — List all folders
   - Reads `folders/` directory
   - Strips `.json` extension from filenames
   - Returns sorted array
   - Returns `[]` if folders directory doesn't exist

4. **listMessages(repoPath, folderName)** — List messages in folder
   - Converts folder name via `folderPathToFilename()`
   - Reads `folders/<filename>.json` for message list
   - Calls `readEmlHeaders()` for each message (4KB fast read)
   - Returns `MessageSummary[]` with messageId, date, from, subject
   - Handles missing EML files defensively (uses empty defaults)

5. **viewMessage(repoPath, messageId, format)** — View message in format
   - Sanitizes messageId via `sanitizeMessageId()` (T-4-02 threat mitigation)
   - Supports 3 formats:
     - `'eml'`: Raw RFC822 file as string
     - `'plaintext'`: Extract text/plain via mailparser (default)
     - `'json'`: Headers map + MIME parts array
   - Throws clear error if text/plain missing
   - Handles multipart and attachments

#### Helper Functions:
1. **isDateString(arg)** — Detect if string matches YYYY-MM-DD
2. **resolveDate(repoPath, dateStr)** — Query git log for commits on date
3. **ensureWorktreesIgnored(repoPath)** — Append `.worktrees/` to `.gitignore` if absent
4. **readEmlHeaders(emlPath)** — Fast RFC822 header extraction (4KB read)
   - Unfolds RFC 2822 continuation lines
   - Parses headers as lowercase key-value pairs
   - Returns `Record<string, string>`

### 2. Unit Tests (Task 5, Commit 89a4106)

**File:** `tests/unit/browse.test.ts` (457 lines, 23 tests)

Comprehensive unit test coverage:

**resolveAccount tests (5):**
- Explicit account resolution
- Auto-selection for single account
- Error handling for multiple accounts
- Unknown account error
- Account list in error message

**getLog tests (5):**
- Empty array for no sync commits
- Filtering to sync format only
- Respecting maxCount limit
- Handling unlimited mode
- Recognizing partial commits

**listFolders tests (3):**
- Lists all folders from folders/*.json
- Returns empty array when folders dir missing
- Strips .json extension

**listMessages tests (3):**
- Parses headers and returns MessageSummary
- Handles missing EML files defensively
- Throws for non-existent folder

**viewMessage tests (6):**
- Returns raw EML for eml format
- Extracts text/plain for plaintext
- Uses plaintext as default format
- Returns JSON headers+parts
- Throws error for plaintext when no text/plain part
- Sanitizes message-id before path lookup

**Test Infrastructure:**
- Uses real git repos with sample data
- Creates temporary directories with cleanup
- Proper use of `sanitizeMessageId()` for filenames
- Tests both happy paths and error cases

### 3. Integration Tests (Task 6, Commit 7966940)

**File:** `tests/integration/browse.test.ts` (236 lines, 15 tests)

End-to-end tests with real git repos and file system:

**Setup (beforeAll):**
- Creates temporary git repo
- Initializes with 3 sample sync commits (Jan 1-3)
- Creates folder state JSON with 2 messages
- Writes 2 sample EML files with realistic headers
- Sets up git committer date for realistic timestamps

**getLog integration (5 tests):**
- Retrieves actual git commits from repo
- Limits to N commits
- Filters to sync format only
- Handles unlimited correctly
- Includes partial commits

**listFolders integration (2 tests):**
- Lists folders from folders/*.json
- Strips .json extension correctly

**listMessages integration (2 tests):**
- Lists messages with parsed headers
- Throws for non-existent folder

**viewMessage integration (4 tests):**
- Retrieves raw EML
- Extracts plaintext (default)
- Extracts plaintext explicitly
- Returns JSON with headers and parts

**checkoutCommit integration (2 tests):**
- Creates .worktrees directory with git worktree
- Ensures .worktrees/ in .gitignore

### 4. Configuration Updates

**File:** `vitest.config.ts`
- Added `tests/integration/**/*.test.ts` to test include pattern
- Allows integration tests to run alongside unit tests

---

## Verification

### All Tests Pass
```
Test Files  2 passed (2)
Tests  38 passed (38)
```

- 23 unit tests: all pass
- 15 integration tests: all pass

### TypeScript Compilation
```
npm run typecheck → Success (no errors)
```

### Implementation Checklist
- [x] getLog() implemented with git.log() filtering
- [x] checkoutCommit() creates git worktrees with date/hash resolution
- [x] listFolders() reads folders/*.json files
- [x] listMessages() parses EML headers efficiently (4KB read)
- [x] viewMessage() supports eml/plaintext/json formats
- [x] mailparser integration for MIME parsing
- [x] Proper error handling throughout
- [x] ARCH-01 boundary maintained (no console/exit)
- [x] T-4-02 threat mitigation (sanitizeMessageId before path lookup)
- [x] All functions exported from src/core/index.ts
- [x] Comprehensive unit tests (23)
- [x] Integration tests with real repos (15)

---

## Deviations from Plan

None — plan executed exactly as written.

All decisions from 04-CONTEXT.md implemented:
- D-01/D-02: resolveAccount() account resolution
- D-04/D-05: getLog() with sync commit filtering
- D-06 through D-10: checkoutCommit() worktree operations and date resolution
- D-11 through D-13: listFolders() and listMessages() with folder/message listing
- D-15 through D-19: viewMessage() with format support
- D-20: CR-01 BigInt safety (handled in Plan 04-01, not needed here)

---

## Security & Threat Model

### T-4-02 Path Traversal Mitigation
- `viewMessage()` sanitizes messageId via `sanitizeMessageId()` before constructing EML path
- Prevents `../../etc/passwd` style attacks

### T-4-04 Folder Name Handling
- `listMessages()` converts folder names via `folderPathToFilename()`
- Same sanitization as Phase 3 sync module

### T-4-05 Worktree Operations
- `checkoutCommit()` uses simple-git.raw() which validates git refs
- Malformed refs error before worktree creation
- Worktree removal uses --force to ensure cleanup

### T-4-06 Information Disclosure
- `readEmlHeaders()` reads only 4KB (headers section)
- Doesn't expose full file content for large attachments

---

## Next Steps

**Phase 04-03 Plan:** Wire browse functions to CLI subcommands
- Create thin CLI wrappers for core functions
- Implement `backmail accounts` subcommand
- Implement `backmail log` with --limit flag
- Implement `backmail checkout` with date/hash support
- Implement `backmail ls` for folders and messages
- Implement `backmail view` with format options

---

## Self-Check: PASSED

- ✓ All created files exist:
  - /home/jan/dev/backmail/tests/integration/browse.test.ts
- ✓ All modified files exist and are correct:
  - /home/jan/dev/backmail/src/core/browse.ts (376 lines)
  - /home/jan/dev/backmail/tests/unit/browse.test.ts (457 lines)
  - /home/jan/dev/backmail/vitest.config.ts
- ✓ All commits exist:
  - 2a294ad: Task 1-3 (browse implementation)
  - 89a4106: Task 5 (unit tests)
  - 7966940: Task 6 (integration tests)
- ✓ TypeScript compilation succeeds
- ✓ All tests pass: 38/38 (23 unit + 15 integration)
- ✓ No linting or type errors
