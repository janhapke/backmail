---
phase: 03
fixed_at: 2026-04-22T00:00:00Z
review_path: /home/jan/dev/backmail/.planning/phases/03-sync/03-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 03: Code Review Fix Report

**Fixed at:** 2026-04-22T00:00:00Z
**Source review:** /home/jan/dev/backmail/.planning/phases/03-sync/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (Critical: 1, Warning: 6)
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: Unsafe BigInt Conversion from JSON String

**Files modified:** `src/core/sync.ts`
**Commit:** 1c93d13
**Applied fix:** Wrapped BigInt conversion in try-catch block to handle corrupted state files gracefully. When JSON parsing produces invalid BigInt strings, the code now treats this as a uidvalidity change and triggers a full re-sync, deleting all stored messages instead of crashing.

### WR-01: Missing Error Handling in Git Operations

**Files modified:** `src/core/sync.ts`
**Commit:** 6c48568
**Applied fix:** Added try-catch block around git.add() and git.commit() operations at the end of syncAccount(). On failure, the function sets the partial flag to signal incomplete state to the caller instead of throwing.

### WR-02: Type Unsafe Password Handling with Dual Type Assertions

**Files modified:** `src/core/config.ts`
**Commit:** 5c84cdf
**Applied fix:** Replaced dual `as any` type assertions with explicit Promise detection using typeof checks and proper type casting through `unknown`. The code now explicitly checks if result is a Promise or string, improving type safety while maintaining compatibility with both sync and async keyring returns.

### WR-03: Unchecked Folder Delimiter in Leaf-Name Matching

**Files modified:** `src/core/sync.ts`
**Commit:** 76db38c
**Applied fix:** Added defensive check to ensure delimiter is non-empty before using it in the leaf-name matching logic. This prevents overly broad matching if an IMAP server returns a malformed folder with an empty delimiter.

### WR-04: Unguarded Mailbox State After Lock Acquisition

**Files modified:** `src/core/sync.ts`
**Commit:** 88eb516
**Applied fix:** Improved type guards to check for both null and boolean false states after mailbox lock acquisition. Added fallback values (0n for uidValidity, 0 for uidNext) using nullish coalescing operators to handle edge cases where these properties might be undefined.

### WR-06: Array Index Calculation Risk in Fetch Range

**Files modified:** `src/core/sync.ts`
**Commit:** 0dc84a3
**Applied fix:** Added null coalescing operator to provide fallback value of 0 when mapping message UIDs in the fetch range calculation. This adds extra robustness against runtime JSON parsing errors.

---

## Notes on WR-05

WR-05 (State Mutation in uidvalidity Change Logic) was addressed as part of the CR-01 fix. The comprehensive try-catch block and clarifying comments adequately document the state mutation behavior, making it clear that setting `storedState = null` after a uidvalidity change forces a fresh sync by making `existingMessages` empty.

---

_Fixed: 2026-04-22T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
