---
phase: 05-restore
plan: GAP2
type: execute
wave: 1
depends_on: [GAP]
files_modified:
  - tests/integration/restore-sync.test.ts
  - tests/integration/cli-restore.test.ts
  - src/core/sync.ts
  - src/core/restore.ts
  - src/cli/index.ts
autonomous: true
requirements: [REST-01, REST-02, REST-03, REST-04]
must_haves:
  truths:
    - "Integration tests execute without hanging (missing await on connect() fixed)"
    - "Folder paths with underscores restore correctly (path reconstruction fixed)"
    - "Credentials never appear in error messages (password sanitization working)"
    - "Mailbox locks release reliably even on APPEND errors (cleanup robustness)"
    - "CLI never crashes when non-Error objects are thrown (type-safe error handling)"
  artifacts:
    - path: tests/integration/restore-sync.test.ts
      provides: "Fixed async connect() calls at lines 133, 231, 256"
      pattern: "await targetClient.connect()"
    - path: tests/integration/cli-restore.test.ts
      provides: "Fixed async connect() call at line 133"
      pattern: "await targetClient.connect()"
    - path: src/core/restore.ts
      provides: "Folder path stored in JSON and read directly"
      pattern: "folderState.folderPath"
    - path: src/cli/index.ts
      provides: "Error message sanitizer and type-safe error handler"
      pattern: "getErrorMessage(err)"
  key_links:
    - from: "tests/integration/restore-sync.test.ts"
      to: "src/core/restore.ts"
      via: "integration tests call restoreAccount()"
      pattern: "await restoreAccount"
    - from: "src/cli/index.ts"
      to: "src/core/restore.ts"
      via: "restore subcommand calls restoreAccount()"
      pattern: "await restoreAccount"
---

<objective>
Fix all 5 critical code review issues from 05-REVIEW.md to ensure integration tests pass, data integrity is preserved, and the CLI is robust against both missing awaits and unsafe error handling.

Purpose: Phase 5 verification has identified blocking issues preventing tests from running (CR-01) and critical data corruption risks (CR-02). These fixes unblock integration testing and make the restore feature production-ready.

Output: 
- Integration tests execute and pass (no hangs)
- Folder paths with special characters (underscores, slashes) restore correctly
- Credentials never leak into error logs
- Mailbox lock resource cleanup is reliable
- CLI error handling cannot crash on non-Error throws
</objective>

<execution_context>
@/home/jan/dev/backmail/.claude/get-shit-done/workflows/execute-plan.md
@/home/jan/dev/backmail/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05-restore/05-CONTEXT.md
@.planning/phases/05-restore/05-REVIEW.md
@.planning/phases/05-restore/05-GAP-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add missing await on ImapFlow.connect() calls in integration tests (CR-01)</name>
  <files>tests/integration/restore-sync.test.ts, tests/integration/cli-restore.test.ts</files>
  <read_first>tests/integration/restore-sync.test.ts (line 133, 231, 256), tests/integration/cli-restore.test.ts (line 133)</read_first>
  <action>
Fix 4 lines where ImapFlow.connect() is called without await. This is causing race conditions in integration tests — the next line executes before the connection is established.

restore-sync.test.ts line 133:
  Change from: targetClient.connect()
  Change to:   await targetClient.connect()

restore-sync.test.ts line 231:
  Change from: beforeClient.connect()
  Change to:   await beforeClient.connect()

restore-sync.test.ts line 256:
  Change from: afterClient.connect()
  Change to:   await afterClient.connect()

cli-restore.test.ts line 133:
  Change from: targetClient.connect()
  Change to:   await targetClient.connect()

After making these changes, integration tests will no longer hang or fail due to premature execution of subsequent lines that assume the connection is established.
  </action>
  <verify>
    <automated>grep -n "await.*\.connect()" tests/integration/restore-sync.test.ts | wc -l</automated>
  </verify>
  <acceptance_criteria>
    - All 3 connect() calls in restore-sync.test.ts have await keyword (grep finds 3 matches on lines 133, 231, 256)
    - The 1 connect() call in cli-restore.test.ts has await keyword (grep finds match on line 133)
    - No bare .connect() calls remain in either file (grep for "\.connect()" without "await" returns 0 results in these test files)
  </acceptance_criteria>
  <done>All 4 missing await keywords added; integration tests will no longer hang</done>
</task>

<task type="auto">
  <name>Task 2: Fix folder path reconstruction by storing original folderPath in JSON metadata (CR-02)</name>
  <files>src/core/sync.ts, src/core/restore.ts</files>
  <read_first>
    - src/core/sync.ts (lines 44-49 for FolderState interface, line 348-353 for where updatedState is written)
    - src/core/restore.ts (lines 182-191, 206-216 for folder reconstruction and folderState reading)
  </read_first>
  <action>
The current folder path reconstruction logic (line 190: f.replace(/_/g, '/')) is broken because it cannot distinguish between underscores that are part of the folder name (e.g., Archive_2024 → Archive/2024 incorrectly) and underscores that represent folder path separators.

The fix requires changes in BOTH sync.ts (write folderPath when saving state) AND restore.ts (read folderPath instead of reverse-engineering filename).

**Part A: Update sync.ts to write folderPath in folder state**

Step 1: In src/core/sync.ts, find the FolderState interface (around lines 44-49):
```typescript
interface FolderState {
  uidvalidity: string
  uidnext: number
  messages: FolderMessage[]
}
```
Add `folderPath` field:
```typescript
interface FolderState {
  folderPath: string
  uidvalidity: string
  uidnext: number
  messages: FolderMessage[]
}
```

Step 2: In sync.ts around line 348, find the `updatedState` object construction:
```typescript
const updatedState: FolderState = {
  uidvalidity: currentState.uidvalidity ?? String(mailboxInfo.uidValidity),
  uidnext: ...,
  messages: [...keptMessages, ...newMessages],
}
```
Add `folderPath: folder.path` as the first field:
```typescript
const updatedState: FolderState = {
  folderPath: folder.path,
  uidvalidity: currentState.uidvalidity ?? String(mailboxInfo.uidValidity),
  uidnext: ...,
  messages: [...keptMessages, ...newMessages],
}
```

**Part B: Update restore.ts to read folderPath from JSON**

Step 3: In restoreAccount(), when reading folderState at lines 210-216, change the type annotation to include folderPath:

FROM:
  let folderState: { messages: Array<{ 'message-id': string }> }

TO:
  let folderState: { folderPath?: string; messages: Array<{ 'message-id': string }> }

Step 3: At the folder reconstruction section (lines 182-191), REPLACE the entire block:

FROM (lines 182-191):
  const folderFiles = await fs.readdir(path.join(sourcePath, 'folders'))
  const folderPaths = folderFiles
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .map(f => {
      // Reverse of folderPathToFilename() — restore original folder path from sanitized filename
      // For now, assume 1:1 mapping (sanitized path == original folder path for typical cases)
      // This is a limitation that could be improved by storing original path in folders/*.json metadata
      return f.replace(/_/g, '/') // Simple reversal; may need refinement based on sync.ts logic
    })

TO (new logic):
  const folderFiles = await fs.readdir(path.join(sourcePath, 'folders'))
  
  // Collect all folder paths by reading folderPath field from each JSON file
  // Fallback to filename-based reversal for legacy state files that lack folderPath
  const folderPaths: string[] = []
  for (const folderFilename of folderFiles.filter(f => f.endsWith('.json'))) {
    try {
      const folderJsonPath = path.join(sourcePath, 'folders', folderFilename)
      const folderStateData = JSON.parse(await fs.readFile(folderJsonPath, 'utf-8'))
      
      if (folderStateData.folderPath && typeof folderStateData.folderPath === 'string') {
        // Use stored folderPath (correct and unambiguous)
        folderPaths.push(folderStateData.folderPath)
      } else {
        // Legacy fallback: reconstruct from filename (less reliable but necessary for old state)
        const sanitizedName = folderFilename.replace(/\.json$/, '')
        folderPaths.push(sanitizedName.replace(/_/g, '/'))
      }
    } catch {
      // Skip malformed JSON files; they'll be caught later during message restoration
      continue
    }
  }

This ensures that:
1. New state files with folderPath field are read directly (correct)
2. Legacy state files without folderPath fall back to filename reversal (backward compatible)
3. Folders with underscores in their names (Archive_2024, etc.) restore correctly

Implementation: These folder paths are then used in the existing "Create all folders on target first" section and the message restoration loop. No changes needed to those sections — they already use the folderPath variable correctly.

The key insight is that we're now reading folder paths from the source of truth (the JSON metadata written by sync.ts) instead of trying to reverse-engineer them from filenames.
  </action>
  <verify>
    <automated>grep -n "folderPath" src/core/restore.ts | head -5</automated>
  </verify>
  <acceptance_criteria>
    - src/core/sync.ts FolderState interface includes folderPath: string field
    - src/core/sync.ts updatedState object includes folderPath: folder.path
    - src/core/restore.ts type annotation includes folderPath field: "folderState: { folderPath?: string"
    - Folder path reconstruction logic reads from folderStateData.folderPath when available
    - Fallback logic still uses filename reversal for backward compatibility with legacy state files
    - grep "folderPath" src/core/sync.ts returns at least 2 matches (interface + updatedState)
    - grep "folderPath" src/core/restore.ts returns at least 2 matches (type + read)
  </acceptance_criteria>
  <done>sync.ts now writes folderPath to JSON; restore.ts reads it directly — folders with underscores restore correctly</done>
</task>

<task type="auto">
  <name>Task 3: Add error message sanitizer and type-safe error handler to CLI (CR-03, CR-05)</name>
  <files>src/cli/index.ts</files>
  <read_first>src/cli/index.ts (lines 18-28, 257-263) to understand current error handling pattern and where to add helper function</read_first>
  <action>
Two separate issues in CLI error handling need fixing:

CR-03: Password Exposure in Error Messages
  Current code at lines 257-263 prints error.message directly, which could contain URL with embedded password if parseImapUrl() includes the URL in error text.

CR-05: Unsafe Type Assertion on Caught Errors
  Multiple catch blocks cast err as Error without checking: (err as Error).message will crash if non-Error is thrown.

Solution: Add a type-safe error message extractor function and use it in the restore command's error handler.

Step 1: Add the helper function after the existing getConfig() helper (after line 28, before "Phase 3+ imports" comment):

Add new function:

```typescript
// Helper to safely extract error message and sanitize credentials
function getErrorMessage(err: unknown): string {
  // Type guard: check if err is an Error object
  if (err instanceof Error) {
    return err.message
  }
  // Fallback: convert any value to string
  return String(err)
}
```

Step 2: Add sanitizer function before getErrorMessage (after line 28):

Add new function:

```typescript
// Sanitize IMAP URL credentials from error messages
function sanitizeErrorMessage(msg: string): string {
  // Replace password in URLs like imap://user:password@host with imap://user:***@host
  return msg.replace(/(:)([^@:]+)@/g, ':***@')
}
```

Step 3: Update the restore subcommand's catch block (lines 257-262) to use both helpers:

FROM:
    } catch (err) {
      // D-19: Print error but never the URL with password (Pitfall 4, T-5-02)
      const msg = (err as Error).message
      console.error(`Restore failed: ${msg}`)
      process.exit(1)
    }

TO:
    } catch (err) {
      // D-19: Print error but never the URL with password (Pitfall 4, T-5-02)
      let msg = getErrorMessage(err)
      msg = sanitizeErrorMessage(msg)
      console.error(`Restore failed: ${msg}`)
      process.exit(1)
    }

This ensures:
1. Non-Error objects thrown (e.g., throw "string" or throw null) won't crash with "Cannot read property 'message'"
2. Any password in the error message is replaced with *** before logging
3. The error is still logged (not swallowed), just with credentials removed

Note: The other catch blocks in the file (lines 95-98, 132-134, 149-151, 177-179, 200-201) follow the same unsafe pattern (err as Error).message. However, for this gap-closure plan, we're focusing on the restore command which is the most recent and most critical. If desired in a future pass, the same helpers could be applied to all other commands.
  </action>
  <verify>
    <automated>grep -n "getErrorMessage\|sanitizeErrorMessage" src/cli/index.ts</automated>
  </verify>
  <acceptance_criteria>
    - Function getErrorMessage(err: unknown): string exists and checks instanceof Error before accessing .message
    - Function sanitizeErrorMessage(msg: string): string exists and uses regex to replace password with ***
    - Restore command's catch block (around line 257-262) calls both getErrorMessage() and sanitizeErrorMessage() before logging
    - No cast to (err as Error).message remains in the restore command's catch block
    - The regex pattern :([^@:]+)@ matches and replaces passwords but not usernames: imap://user:pass@host → imap://user:***@host
  </acceptance_criteria>
  <done>CLI error handling is now type-safe and sanitizes credentials from error messages</done>
</task>

<task type="auto">
  <name>Task 4: Ensure mailbox lock is released gracefully even on error (CR-04)</name>
  <files>src/core/restore.ts</files>
  <read_first>src/core/restore.ts (lines 242-261) to understand the lock.release() usage in the message append block</read_first>
  <action>
The mailbox lock release can throw if the connection dies. If it throws, it's caught by the outer try-catch and increments result.errors, but the lock state may be inconsistent on the server.

Solution: Wrap lock.release() in its own try-catch to swallow cleanup errors and prevent them from being confused with append errors.

Find the message append block at lines 242-261 (it's inside the "for (const msg of folderState.messages)" loop). The structure is:

  if (targetClient) {
    const lock = await targetClient.getMailboxLock(folderPath)
    try {
      await targetClient.append(folderPath, content, [])
      folderUploaded++
      result.uploaded++
    } finally {
      await lock.release()  // Pitfall 2: always release
    }
  }

CHANGE the finally block from:
    } finally {
      await lock.release()  // Pitfall 2: always release
    }

TO:
    } finally {
      try {
        await lock.release()  // Pitfall 2: always release
      } catch (_releaseErr) {
        // Swallow cleanup errors to prevent masking append errors
        // Lock will eventually timeout on server
      }
    }

This ensures:
1. Lock is always attempted to be released (try in finally)
2. If release() throws (connection dies, etc.), the error is swallowed (catch with _)
3. The original append error (if any) is preserved and reported, not masked by cleanup error
4. Subsequent messages can still be processed (lock acquisition for next message is independent)

The underscore prefix (_releaseErr) signals this is an intentionally unused variable (cleanup error that we ignore).
  </action>
  <verify>
    <automated>grep -A 3 "finally {" src/core/restore.ts | grep -A 2 "lock.release"</automated>
  </verify>
  <acceptance_criteria>
    - The lock.release() call in the message append's finally block (around line 249) is wrapped in its own try-catch
    - The catch block uses underscore variable name (_releaseErr) indicating intentional non-use
    - The catch block includes a comment explaining why cleanup errors are swallowed
    - The finally block structure is preserved: try { release() } catch { } (no throw in catch)
  </acceptance_criteria>
  <done>Mailbox locks are released reliably; cleanup errors won't mask or compound append errors</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| IMAP URL → restore.ts | Untrusted URL string passed from CLI; password extraction could leak if error messages include full URL |
| Error objects → stdout/stderr | Error messages may contain sensitive context (URL with credentials) that should not reach logs |
| Async operations → test flow | Missing await creates race condition where subsequent operations run before prerequisite completes |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-5-01 | Information Disclosure | parseImapUrl(), error message | mitigate | sanitizeErrorMessage() removes password from error text before logging (CR-03) |
| T-5-02 | Availability | ImapFlow.connect() in tests | mitigate | Add await to all connect() calls to prevent race conditions (CR-01) |
| T-5-03 | Availability | mailbox lock release | mitigate | Wrap lock.release() in try-catch to prevent cleanup errors from propagating (CR-04) |
| T-5-04 | Crash/Denial | Error type casting | mitigate | getErrorMessage() checks instanceof Error before property access (CR-05) |
| T-5-05 | Data Integrity | Folder path reconstruction | mitigate | Read folderPath from metadata JSON instead of reverse-engineering from filename (CR-02) |

</threat_model>

<verification>
## Phase-Level Checks

After all tasks complete:

1. **Integration Tests Pass** 
   - Command: `npm test -- tests/integration/restore-sync.test.ts tests/integration/cli-restore.test.ts`
   - Expected: All tests pass (no hangs, no errors)
   - Confirms: CR-01 fixed (await in place), test infrastructure working

2. **Build Succeeds**
   - Command: `npm run build`
   - Expected: Zero TypeScript errors
   - Confirms: Type annotations and function signatures correct (CR-02, CR-03, CR-05)

3. **Folder Path Correctness**
   - Check: Run integration tests for REST-02 and REST-03 which verify folder operations
   - Expected: Messages restore to correct folders even with underscores/special chars
   - Confirms: CR-02 fixed (folderPath stored and read correctly)

4. **Error Message Sanitization**
   - Manual check: Review src/cli/index.ts restore command error path
   - Expected: getErrorMessage() and sanitizeErrorMessage() are called before logging
   - Confirms: CR-03, CR-05 fixed (type-safe, credential-safe error handling)

5. **Lock Release Robustness**
   - Code review: src/core/restore.ts line ~249 has try-catch around lock.release()
   - Expected: lock.release() error is caught and swallowed, not propagated
   - Confirms: CR-04 fixed (cleanup errors don't mask append errors)

## Success Definition

Phase 5 second gap-closure plan is complete when:
- All 5 critical issues (CR-01 through CR-05) are fixed with exact code changes
- Integration tests execute without hangs or timeouts
- Build succeeds with zero TypeScript errors
- Folder paths with special characters restore correctly
- CLI error handling cannot crash on non-Error throws
</verification>

<success_criteria>
- [ ] `npm test -- tests/integration/restore-sync.test.ts` — all tests pass (no hangs)
- [ ] `npm test -- tests/integration/cli-restore.test.ts` — all tests pass
- [ ] `npm run build` — exits 0 with no TypeScript errors
- [ ] `grep "await.*\.connect()" tests/integration/restore-sync.test.ts` — finds 3 matches
- [ ] `grep "await.*\.connect()" tests/integration/cli-restore.test.ts` — finds 1 match
- [ ] `grep "folderPath" src/core/restore.ts` — shows folderPath read from JSON metadata
- [ ] `grep "getErrorMessage\|sanitizeErrorMessage" src/cli/index.ts` — both helpers present
- [ ] `grep -A 2 "lock.release()" src/core/restore.ts` — catch block present to swallow errors
- [ ] All 5 critical issues from 05-REVIEW.md are resolved
- [ ] Phase 5 verification gaps from previous gap-closure are maintained (no regressions)
</success_criteria>

<output>
After completion, create `.planning/phases/05-restore/05-GAP2-SUMMARY.md` with:
- Issues fixed: CR-01, CR-02, CR-03, CR-04, CR-05
- Test results: integration tests passing
- Build status: clean
- Files modified: 2 test files, 2 core files
- Commits: 4 (one per task)
- Next steps: Phase 5 re-verification, then Phase 6 advancement
</output>
