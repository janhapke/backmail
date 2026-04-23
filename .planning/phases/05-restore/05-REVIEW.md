---
phase: 05-restore
reviewed: 2026-04-24T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - tests/unit/restore.test.ts
  - tests/integration/restore-sync.test.ts
  - tests/integration/cli-restore.test.ts
  - src/core/restore.ts
  - src/core/index.ts
  - src/cli/index.ts
findings:
  critical: 3
  warning: 4
  info: 5
  total: 12
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-04-24
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

The Phase 5 restore implementation provides a functional API for restoring messages from a local git backup to a target IMAP server. The code architecture correctly separates concerns (core restore logic vs CLI layer) and implements most of the design decisions from 05-CONTEXT.md.

However, there are **3 critical issues** that must be fixed before production use:

1. **Path reconstruction logic is broken** — Folder paths with special characters won't restore correctly
2. **Potential password leak in error messages** — URL credentials could be exposed in error output
3. **Mailbox lock handling has subtle race conditions** — Could cause resource leaks

Additionally, **4 warnings** identify logic gaps in error handling and edge case coverage, and **5 info items** flag test gaps and code quality improvements.

## Critical Issues

### CR-01: Folder Path Reconstruction is Broken

**File:** `src/core/restore.ts:186-191`

**Issue:** The code attempts to reverse the `folderPathToFilename()` sanitization by replacing underscores with slashes:

```typescript
return f.replace(/_/g, '/') // Simple reversal; may need refinement
```

This is fundamentally broken. If the original folder path is `Archive_2024` (with an underscore), it will be sanitized to `Archive_2024` (unchanged), but the reversal logic will convert it to `Archive/2024` (incorrect). Gmail folders like `[Gmail]/All Mail` will similarly fail.

The code cannot reconstruct the original path without storing the mapping. The `folders/*.json` metadata files should include the original folder path, or this operation should use a manifest file.

**Fix:**
1. Modify the folder state JSON files to include the original `folderPath` field:
```typescript
// In folders/INBOX.json
{
  "folderPath": "INBOX",
  "uidvalidity": "...",
  "messages": [...]
}
```

2. Then read it directly:
```typescript
const folderState: { folderPath: string; messages: Array<...> } = 
  JSON.parse(await fs.readFile(folderJsonPath, 'utf-8'))
const folderPath = folderState.folderPath
```

---

### CR-02: Password Exposure in Error Messages

**File:** `src/cli/index.ts:263-267`

**Issue:** The restore command catches errors and prints them to stderr:

```typescript
} catch (err) {
  const msg = (err as Error).message
  console.error(`Restore failed: ${msg}`)
  process.exit(1)
}
```

If `parseImapUrl()` or any downstream function includes the original URL in its error message, this will leak the password to stderr/logs. Example error from URL parsing:

```
Invalid URL: imap://user:secretpass@host — contains invalid characters
```

**Fix:** Sanitize error messages to remove credentials before logging:

```typescript
catch (err) {
  let msg = (err as Error).message
  // Remove password from error message (URL might be in error text)
  msg = msg.replace(/(:)([^@:]+)@/g, ':***@')
  console.error(`Restore failed: ${msg}`)
  process.exit(1)
}
```

Or better: Have `parseImapUrl()` throw errors that don't include the full URL:

```typescript
// In restore.ts
throw new Error('Invalid IMAP URL: must be imap:// or imaps://')
// Not: 
throw new Error(`Invalid URL: ${urlStr}`)
```

---

### CR-03: Mailbox Lock May Not Be Released on APPEND Error

**File:** `src/core/restore.ts:243-261`

**Issue:** The code acquires a mailbox lock for APPEND but has a subtle issue:

```typescript
const lock = await targetClient.getMailboxLock(folderPath)
try {
  await targetClient.append(folderPath, content, { flags: [] })
  folderUploaded++
  result.uploaded++
} finally {
  await lock.release()  // Pitfall 2: always release
}
```

**The problem:** If `targetClient.append()` throws, the lock is released in the finally block (correct). However, this entire block is wrapped in an outer try-catch at line 226:

```typescript
try {
  // ... lock code ...
} catch (err) {
  result.errors++
}
```

If `lock.release()` itself throws (e.g., connection died), the error bubbles up and is caught by the outer try-catch. But the lock state is inconsistent — the lock object still exists but may not be truly released by the server. This can cause subsequent operations to fail or hang.

**Fix:** Ensure the finally block doesn't throw, and handle lock release errors gracefully:

```typescript
const lock = await targetClient.getMailboxLock(folderPath)
try {
  await targetClient.append(folderPath, content, { flags: [] })
  folderUploaded++
  result.uploaded++
} catch (err) {
  // Re-throw to be caught by outer handler, but ensure lock is cleaned up
  throw err
} finally {
  try {
    await lock.release()
  } catch (releaseErr) {
    // Log but don't re-throw (this is a cleanup error)
    console.warn('Failed to release mailbox lock (may affect future operations)')
  }
}
```

But since the core layer should not use console, this should be handled differently — perhaps by returning a warning in the result or letting the outer catch handle it.

---

## Warnings

### WR-01: Loose Type for Folder State JSON

**File:** `src/core/restore.ts:210-212`

**Issue:** The folder state is typed as `{ messages: Array<{ 'message-id': string }> }`, but doesn't validate the structure before accessing:

```typescript
let folderState: { messages: Array<{ 'message-id': string }> }
try {
  folderState = JSON.parse(await fs.readFile(folderJsonPath, 'utf-8'))
} catch {
  result.errors++
  continue
}
```

If the JSON is valid but has a different structure (e.g., `{ data: [...] }` instead of `{ messages: [...] }`), the code will fail when accessing `folderState.messages` at line 223 with a cryptic error.

**Fix:** Validate the structure explicitly:

```typescript
let folderState: { messages: Array<{ 'message-id': string }> }
try {
  const parsed = JSON.parse(await fs.readFile(folderJsonPath, 'utf-8'))
  if (!Array.isArray(parsed.messages)) {
    throw new Error('Invalid folder state: missing or non-array messages field')
  }
  folderState = parsed as { messages: Array<{ 'message-id': string }> }
} catch (err) {
  result.errors++
  continue
}
```

---

### WR-02: Dry-run + Skip-duplicates Interaction is Unclear

**File:** `src/core/restore.ts:228-234`

**Issue:** When `dryRun=true` and `skipDuplicates=true`, the duplicate check is skipped:

```typescript
if (options.skipDuplicates && targetClient) {  // targetClient is null when dryRun=true
  if (await isDuplicate(targetClient, folderPath, messageId)) {
    folderSkipped++
    result.skipped++
    continue
  }
}
```

This is technically correct (no connection to target in dry-run mode), but the behavior is surprising: `--dry-run --skip-duplicates=yes` will report `skipped=0` because duplicate checking is skipped entirely. The user might expect a count of duplicates that *would be* skipped.

**Decision needed:** Should dry-run mode:
- **Option A:** Report `skipped=0` always (current behavior — can't detect duplicates without connecting)
- **Option B:** Connect to target *only* for duplicate detection, even in dry-run mode, then report what *would* be skipped
- **Option C:** Clearly document this limitation in the CLI help text

**Fix:** Add a comment explaining the behavior, or change the design to connect for detection only:

```typescript
// Comment for clarity:
// In dry-run mode, skipDuplicates is ignored because we don't connect to target.
// If duplicate detection is needed in dry-run, the user must remove --dry-run.
if (options.skipDuplicates && targetClient) {
```

---

### WR-03: Connection Failures Are Not Clearly Reported

**File:** `src/core/restore.ts:177-179`

**Issue:** The code assumes `targetClient.connect()` will succeed:

```typescript
if (targetClient) {
  await targetClient.connect()  // May throw, but error message will be generic
}
```

If the connection fails (bad credentials, firewall, host down), the error bubbles up with only ImapFlow's error message, which may be unclear. For example: `"connect ENOTFOUND imap.example.com"` doesn't indicate it's a DNS failure.

**Fix:** Wrap with a more informative error:

```typescript
if (targetClient) {
  try {
    await targetClient.connect()
  } catch (err) {
    throw new Error(
      `Failed to connect to target IMAP server at ${target.host}:${target.port}: ${(err as Error).message}`
    )
  }
}
```

---

### WR-04: Message Restore Errors Lose Context

**File:** `src/core/restore.ts:258-261`

**Issue:** When a message fails to upload, the error is caught but discarded:

```typescript
} catch (err) {
  // D-17: Per-message error: continue (do not abort)
  result.errors++
}
```

The error message, message ID, and folder path are all lost. This makes debugging impossible — the user sees `errors=5` but doesn't know which messages failed or why.

**Fix:** Collect error details for reporting. Since the core layer should not log, return error details in the result:

```typescript
export interface RestoreResult {
  uploaded: number
  skipped: number
  errors: number
  errorDetails?: Array<{ folder: string; messageId: string; reason: string }>  // NEW
}

// In the catch block:
const errorDetails = result.errorDetails ?? []
errorDetails.push({
  folder: folderPath,
  messageId,
  reason: (err as Error).message,
})
result.errorDetails = errorDetails
result.errors++
```

Then the CLI layer can format and display these details.

---

## Info

### IN-01: All Test Files Are Placeholders

**Files:** 
- `tests/unit/restore.test.ts:44-156`
- `tests/integration/restore-sync.test.ts:112-251`
- `tests/integration/cli-restore.test.ts:112-288`

**Issue:** All test cases contain only `expect(true).toBe(true)` placeholders. While this is intentional per the test comments, it means the restore feature has zero test coverage currently.

Each test file lists the expected test cases clearly, so implementation is straightforward. The tests should be filled in before the feature is merged.

**Fix:** Implement the test cases once the core functionality is ready. Current structure is good; just needs assertions filled in.

---

### IN-02: Port Parsing Could Fail Silently

**File:** `src/core/restore.ts:68`

**Issue:** 

```typescript
const port = url.port ? parseInt(url.port, 10) : defaultPort
```

If `url.port` is set to something invalid like `"abc"`, `parseInt()` returns `NaN`. This will be passed to ImapFlow, which may fail in unexpected ways.

**Fix:** Validate the port:

```typescript
const port = url.port ? 
  (() => {
    const p = parseInt(url.port, 10)
    if (isNaN(p) || p < 1 || p > 65535) {
      throw new Error(`Invalid port number: ${url.port}`)
    }
    return p
  })() : 
  defaultPort
```

---

### IN-03: Missing Error Handling for Folder Creation

**File:** `src/core/restore.ts:195-202`

**Issue:** When folder creation fails, `result.errors++` is incremented:

```typescript
try {
  await createFolderIfNeeded(targetClient, folderPath)
} catch (err) {
  result.errors++  // But what folder failed?
}
```

Unlike message errors (which increment a separate per-folder counter), folder creation errors are mixed into the overall error count. The user cannot tell if 5 errors means 5 failed folders or 5 failed messages.

**Fix:** Separate folder errors from message errors, or include context:

```typescript
interface RestoreResult {
  uploaded: number
  skipped: number
  errors: number
  folderErrors?: number  // NEW
}
```

Or collect details in `errorDetails` (as suggested in WR-04).

---

### IN-04: Unused Comment in Folder Path Code

**File:** `src/core/restore.ts:187-191`

**Issue:** The comment acknowledges this is a limitation but leaves it unresolved:

```typescript
// This is a limitation that could be improved by storing original path in folders/*.json metadata
return f.replace(/_/g, '/')
```

This should either be fixed (CR-01 above) or documented as a known issue. As-is, it's a time bomb.

**Fix:** See CR-01. Store the original folder path in the JSON metadata.

---

### IN-05: Verbose Flag is Accepted but Not Used in Core

**File:** `src/core/restore.ts:152` and CLI usage at `src/cli/index.ts:244`

**Issue:** The `RestoreOptions` includes `verbose: boolean`, but the core `restoreAccount()` function doesn't use it:

```typescript
export interface RestoreOptions {
  verbose: boolean  // D-15: true = per-message lines
}

// In restoreAccount():
// D-15: Per-message verbose output (handled by CLI layer, not core)
```

The comment says this is handled by the CLI layer, but the core function doesn't return per-message details (no `messageId` in the result), so the CLI layer can't actually output them.

**Fix:** Either:
1. Return per-message details from the core function (via `RestoreResult.messages[]`)
2. Move the verbose logic to the core function and return formatted output
3. Remove the verbose flag from `RestoreOptions` and have the CLI layer call restoreAccount() in a way that allows per-message logging

Current design (leaving verbose to CLI) is good, but the implementation is incomplete.

---

## Summary of Recommended Actions

**Before merging:**
1. Fix CR-01 (folder path reconstruction) by storing original paths in metadata
2. Fix CR-02 (password leak) by sanitizing error messages in CLI
3. Fix CR-03 (lock handling) by ensuring errors in lock cleanup are handled gracefully

**Before release:**
1. Implement all test cases (currently placeholders)
2. Add error detail collection (WR-04) to make debugging possible
3. Validate port numbers (IN-02) to prevent silent failures

**Nice to have:**
1. Separate folder errors from message errors (IN-03)
2. Add comments explaining the dry-run + skip-duplicates behavior (WR-02)

---

_Reviewed: 2026-04-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
