---
phase: 06-credential-infrastructure
fixed_at: 2026-04-29T00:00:00Z
review_path: .planning/phases/06-credential-infrastructure/06-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-04-29
**Source review:** .planning/phases/06-credential-infrastructure/06-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (WR-01, WR-02; Info findings excluded by fix_scope=critical_warning)
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-01: Empty-string password silently discarded — falls through to wrong fallback

**Files modified:** `src/core/config.ts`
**Commit:** af46dd8
**Applied fix:** Replaced `if (resolvedPassword)` with `if (resolvedPassword !== null)` on line 106. This ensures empty-string passwords are treated as resolved credentials rather than silently discarded, making `null` the explicit sentinel for "not found".

### WR-02: Broad `catch` in keyring block silently absorbs all errors including programmer bugs

**Files modified:** `src/core/config.ts`
**Commit:** af46dd8
**Applied fix:** Replaced the empty `catch` block with a narrowed `catch (err)` that only suppresses expected keyring-unavailability errors (messages matching `/keyring|dbus|gnome-keyring|secret service/i` or containing `'No such interface'`). All other exceptions are re-thrown so programming bugs and unexpected failures are visible rather than silently masked.

Note: The existing test `getPasswordByRef — keyring throws, BACKMAIL_PASSWORD fallback` uses the error message `'DBus unavailable'` which matches the regex (case-insensitive `dbus`), so that test continues to pass with the narrowed catch.

---

_Fixed: 2026-04-29_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
