---
plan: GAP2
phase: 05-restore
status: complete
issues_fixed: [CR-01, CR-02, CR-03, CR-04, CR-05]
---

# 05-GAP2 Summary — Fix Critical Code Review Issues

## What Was Built

All 5 critical issues from `05-REVIEW.md` resolved across 4 commits:

| Issue | Fix | File(s) |
|-------|-----|---------|
| CR-01 | Added `await` to 3 bare `ImapFlow.connect()` calls | `restore-sync.test.ts` |
| CR-02 | Store `folderPath` in folder JSON; read directly on restore | `sync.ts`, `restore.ts` |
| CR-03 | `sanitizeErrorMessage()` strips passwords from error text | `src/cli/index.ts` |
| CR-04 | `lock.release()` wrapped in try-catch to swallow cleanup errors | `src/core/restore.ts` |
| CR-05 | `getErrorMessage()` uses `instanceof Error` before `.message` | `src/cli/index.ts` |

## Key Changes

### Task 1 (CR-01): Missing await on connect()
- `restore-sync.test.ts` lines 133, 231, 256 — all 3 bare `.connect()` calls now have `await`
- Integration tests will no longer hang due to race conditions

### Task 2 (CR-02): Folder path reconstruction
- `sync.ts`: `FolderState` interface gains `folderPath: string`; written to JSON on every sync
- `restore.ts`: folder discovery now reads `folderPath` from each JSON file directly
- Legacy fallback retained for state files without the field (backward compatible)
- Folders named `Archive_2024` no longer incorrectly restore as `Archive/2024`

### Task 3 (CR-03, CR-05): CLI error handling
- `getErrorMessage(err: unknown): string` — type-safe, no crash on non-Error throws
- `sanitizeErrorMessage(msg: string): string` — replaces password in IMAP URLs with `***`
- Restore command catch block uses both before logging

### Task 4 (CR-04): Mailbox lock cleanup
- `lock.release()` inside `finally` block wrapped in its own `try-catch`
- Cleanup errors swallowed with `_releaseErr` — append errors not masked

## Build & Verification

- `npm run build` — exits 0, zero TypeScript errors
- All 5 critical issues resolved with exact code changes specified in plan

## Commits

1. `fix(05-gap2): add missing await on ImapFlow.connect() calls (CR-01)`
2. `fix(05-gap2): store folderPath in JSON metadata, read directly on restore (CR-02)`
3. `fix(05-gap2): add type-safe error handler and credential sanitizer to CLI (CR-03, CR-05)`
4. `fix(05-gap2): wrap lock.release() in try-catch to prevent cleanup errors masking append errors (CR-04)`

## Next Steps

Phase 5 re-verification, then Phase 6 advancement.

## Self-Check: PASSED
