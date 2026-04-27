---
phase: 05-restore
reviewed: 2026-04-28T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/core/restore.ts
  - src/core/index.ts
  - src/cli/index.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-04-28
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Reviewed the post-GAP2 state of the Phase 5 restore implementation. The prior critical issues (CR-01 through CR-05) have all been addressed: `lock.release()` is wrapped in a try-catch (CR-04), `getErrorMessage` and `sanitizeErrorMessage` helpers are present in the CLI (CR-03, CR-05), `folderPath` is stored in JSON metadata and read directly (CR-02).

The `dryRunClient` connection lifecycle is correct: created only when `dryRun && skipDuplicates`, connected at lines 193–195, used for SEARCH at line 253, and unconditionally logged out in `finally` at lines 315–317. The `sanitizeErrorMessage` regex handles the common case correctly.

Four warnings remain, plus three info items. No critical issues.

---

## Warnings

### WR-01: Missing `messages` field in folder state JSON aborts entire restore

**File:** `src/core/restore.ts:248`

**Issue:** `folderState.messages` is declared as `Array<...>` in the TypeScript type annotation (line 235), but `JSON.parse` returns `unknown` at runtime. If a state file is structurally valid JSON but lacks the `messages` key (e.g., `{}`), then `folderState.messages` is `undefined` at runtime, and `for (const msg of folderState.messages)` throws `TypeError: undefined is not iterable`.

This error propagates outward past the inner message loop (line 248) and past the per-folder JSON-parse try-catch (lines 236–241, which only catches read/parse failures). It then reaches the outer `try` block at line 187, which has no `catch` clause — only a `finally` for cleanup. The TypeError escapes `restoreAccount()`, is caught by the CLI at line 268, and terminates the entire restore with `process.exit(1)`. All remaining folders are abandoned.

The fix is to validate `messages` inside the existing per-folder try-catch so a malformed file is treated as a skippable error rather than a fatal one.

**Fix:**
```typescript
// Replace lines 236-241 with:
try {
  const parsed = JSON.parse(await fs.readFile(folderJsonPath, 'utf-8'))
  if (!Array.isArray(parsed.messages)) {
    result.errors++
    continue
  }
  folderState = parsed as typeof folderState
} catch {
  result.errors++
  continue
}
```

---

### WR-02: `createFolderIfNeeded` uses `(err as Error).message` unsafely

**File:** `src/core/restore.ts:121`

**Issue:** The `catch (err)` block casts `err` to `Error` and reads `.message`. If `ImapFlow` throws a non-Error value (a string, a plain object, or similar), `errMsg` becomes `undefined`. The subsequent `errMsg.includes(...)` call then throws `TypeError: Cannot read properties of undefined (reading 'includes')`.

This TypeError propagates out of `createFolderIfNeeded`'s `catch` block (an error inside a `catch` block is not re-caught by the same `catch`). The caller at line 223 catches it and increments `result.errors++`. The practical consequence: an "already exists" response from the server that arrives as a non-Error is treated as a folder creation failure instead of a recoverable no-op.

The CLI layer already has a `getErrorMessage(err: unknown)` helper (lines 33–38) that handles this correctly. The same pattern should be used here.

**Fix:**
```typescript
// Line 121 — change from:
const errMsg = (err as Error).message
// to:
const errMsg = err instanceof Error ? err.message : String(err)
```

---

### WR-03: `sanitizeErrorMessage` regex fails to redact passwords containing a colon

**File:** `src/cli/index.ts:41`

**Issue:** The regex `/(:)([^@:]+)@/g` uses `[^@:]` to match the password segment, which stops scanning at the first colon. If a URL is provided with a colon-containing password that has not been percent-encoded — for example, `imap://user:p:ass@host` — the regex matches `:ass@` (the segment after the second colon) and replaces only that, leaving the output as `imap://user:p:***@host`. The first segment `p` of the password is disclosed.

While the `URL` constructor percent-encodes colons in passwords (so a correctly parsed URL would not leak this way), the raw user-supplied string `opts.to` is what appears in error messages thrown by `parseImapUrl` (line 49 of restore.ts) and by `ImapFlow` connection failures. `sanitizeErrorMessage` is applied to those raw strings.

**Fix:** Use a greedy match anchored to the IMAP scheme and authority to consume everything between the first `:` (after the username) and the `@`:
```typescript
function sanitizeErrorMessage(msg: string): string {
  // Match imap(s)://user:PASSWORD@host — greedy on password to handle embedded colons
  return msg.replace(/(imaps?:\/\/[^:@\s]+:)[^@\s]+@/g, '$1***@')
}
```

This anchors the replacement to the IMAP protocol prefix, avoiding false positives on other colons in the message.

---

### WR-04: Folder creation errors are silently swallowed even in verbose mode

**File:** `src/core/restore.ts:222-227`

**Issue:** When `createFolderIfNeeded` throws (line 221), `result.errors++` is incremented but no diagnostic information is produced regardless of `options.verbose`. Every other error site in the function emits a `console.log` line when verbose is active (lines 260, 279, 294, 301). The inconsistency means folder creation failures are invisible: the user sees `errors: N` in the summary but cannot determine whether the errors came from folder creation or message upload, or which folders were affected.

**Fix:**
```typescript
try {
  await createFolderIfNeeded(targetClient, folderPath)
} catch (err) {
  result.errors++
  if (options.verbose) {
    console.log(`Error creating folder: ${folderPath}`)
  }
}
```

---

## Info

### IN-01: Module-level ARCH-01 comment contradicts actual console usage

**File:** `src/core/restore.ts:2`

**Issue:** The module header at line 2 states `// ARCH-01: no exit calls, no console.*, no CLI imports`. The file contains four `console.log()` calls at lines 260, 279, 294, and 301. The intent is documented inline at line 259 as a deliberate ARCH-01 exception for verbose per-message output (D-15), but the module-level comment makes the exception invisible to someone reading just the header. A future maintainer may either: (a) remove the console calls thinking they violate the stated rule, or (b) add unrestricted `console.*` calls believing the rule allows it.

**Fix:** Update the module header to accurately describe the exception scope:
```typescript
// ARCH-01 applies with one exception: console.log is permitted inside
// `if (options.verbose)` blocks for per-message diagnostic output (D-15).
// No other console.* usage is permitted in this module.
```

---

### IN-02: `parseImapUrl` embeds the raw URL (including password) in Error objects it constructs

**File:** `src/core/restore.ts:49`

**Issue:** `throw new Error('Invalid URL: ' + urlStr)` creates an Error whose `.message` contains the raw user-supplied URL string, including any embedded password. Within this codebase the error is correctly sanitized at the CLI catch (line 270 of cli/index.ts). However, `parseImapUrl` is a named export, and the Error object — with the password in `.message` — is created in the core layer before sanitization. Any error-tracking integration (e.g., Sentry), structured logger, or test framework that captures Error objects at the throw site would record the plaintext password.

**Fix:** Omit the raw URL from the error message:
```typescript
// Line 49 — change from:
throw new Error(`Invalid URL: ${urlStr}`)
// to:
throw new Error('Invalid IMAP URL: must use imap:// or imaps:// scheme with host, user, and password')
```

---

### IN-03: Retry hint at line 265 is shown even when `--skip-duplicates=yes` is already active

**File:** `src/cli/index.ts:265`

**Issue:** When `result.errors > 0`, the CLI unconditionally prints `Re-run with --skip-duplicates=yes to safely retry`. If the user is already running with `--skip-duplicates=yes` (which is the default), the hint is inaccurate — it implies the flag would help when the user is already using it.

**Fix:**
```typescript
if (!skipDuplicates) {
  console.error('Re-run with --skip-duplicates=yes to safely retry (already-uploaded messages will be skipped)')
}
```

---

_Reviewed: 2026-04-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
