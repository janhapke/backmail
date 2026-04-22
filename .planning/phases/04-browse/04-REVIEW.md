---
phase: 04-browse
reviewed: 2026-04-22T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/core/browse.ts
  - src/core/index.ts
  - src/core/sync.ts
  - src/cli/index.ts
  - vitest.config.ts
  - tests/unit/browse.test.ts
  - tests/integration/browse.test.ts
  - tests/integration/cli-browse.test.ts
findings:
  critical: 3
  warning: 6
  info: 5
  total: 14
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-04-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 4 introduces browse commands (accounts, log, checkout, ls, view) that read the synced archive without IMAP connections. The implementation is well-structured with good separation of concerns between CLI and core modules. However, **three critical security/stability issues were identified** related to path traversal, type safety, and worktree state management. Additionally, **six warnings were found** covering input validation, buffer handling, and error resilience. The test coverage is comprehensive.

Key architectural compliance verified:
- ✓ ARCH-01: No console.* or process.exit() in src/core/
- ✓ ARCH-02: Thin CLI wrapper with logic in core
- ✓ ESM module convention: .js extensions on relative imports
- ✓ CR-01 fix: uidvalidity compared as strings (sync.ts:289)
- ✓ simple-git worktree operations use git.raw(['worktree', ...])
- ✓ Fast 4KB header read for ls listing (readEmlHeaders)

## Critical Issues

### CR-01: Path Traversal Vulnerability in Worktree Name

**File:** `src/core/browse.ts:150`

**Issue:** When a commit hash is passed to `checkoutCommit()`, the worktree name is derived by slicing the first 7 characters: `worktreeName = dateOrHash.slice(0, 7)`. This name is then used in a path join at line 153: `path.join(repoPath, '.worktrees', worktreeName)`. An attacker could pass a malicious hash-like string containing path traversal sequences (e.g., `../../../etc`) that would be partially filtered by the slice operation but could still escape the `.worktrees/` directory if the escape sequence spans the first 7 characters or if the git.raw() command doesn't validate input.

**Fix:**
```typescript
// Validate commit hash contains only hex digits (or short SHA format)
const validateCommitRef = (ref: string): void => {
  if (!/^[0-9a-f]{7,40}$|^\d{4}-\d{2}-\d{2}$/.test(ref)) {
    throw new Error(`Invalid commit reference: ${ref}. Must be a valid commit hash or date YYYY-MM-DD`)
  }
}

// In checkoutCommit():
if (!isDateString(dateOrHash)) {
  validateCommitRef(dateOrHash) // Add this validation
  commitHash = dateOrHash
  worktreeName = dateOrHash.slice(0, 7)
}
```

---

### CR-02: Unsafe Type Assertion on `client.mailbox`

**File:** `src/core/sync.ts:278-282`

**Issue:** The code checks `if (!client.mailbox || typeof client.mailbox === 'boolean')` but then immediately accesses `.uidValidity` and `.uidNext` without confirming the object has these properties. The type guard is incomplete — it only checks truthiness and rejects booleans, but doesn't verify the structure. If ImapFlow's types change or the mailbox object is missing these properties, the access at line 281 will crash with `Cannot read property 'uidValidity' of [undefined|unexpected-type]`.

**Fix:**
```typescript
// Type guard with property verification
if (!client.mailbox || typeof client.mailbox === 'boolean') {
  throw new Error(`Failed to access mailbox: ${folder.path}`)
}
// Verify expected properties exist
if (typeof client.mailbox.uidValidity !== 'bigint' && client.mailbox.uidValidity !== undefined) {
  throw new Error(`Invalid uidValidity from server for ${folder.path}`)
}

const serverValidity = client.mailbox.uidValidity ?? 0n
const serverUidNext = client.mailbox.uidNext ?? 0
```

Or use stricter typing:
```typescript
interface MailboxState {
  uidValidity: bigint | undefined
  uidNext: number | undefined
  // ... other properties
}

if (!client.mailbox || typeof client.mailbox === 'boolean') {
  throw new Error(`Failed to access mailbox: ${folder.path}`)
}

const mb = client.mailbox as MailboxState
const serverValidity = mb.uidValidity ?? 0n
const serverUidNext = mb.uidNext ?? 0
```

---

### CR-03: Race Condition in Worktree Cleanup

**File:** `src/core/browse.ts:155-167`

**Issue:** The function attempts to remove a worktree twice: first via git command (line 157), then via filesystem (line 164). Both operations have empty catch blocks that silently ignore failures. If the git command fails (e.g., worktree in use), the fs.rm might also fail, but the function will still return success. This creates a stale or partially-deleted worktree state that the caller cannot detect. Subsequent calls to checkout the same date will attempt to remove the stale worktree again.

**Fix:**
```typescript
// Remove existing worktree if present
let gitRemoveError: Error | null = null
try {
  await git.raw(['worktree', 'remove', '--force', worktreePath])
} catch (err) {
  gitRemoveError = err as Error
  // Continue to attempt fs.rm as fallback
}

// Force-remove directory if it still exists
let worktreeExists = false
try {
  await fs.stat(worktreePath) // Check if path exists
  worktreeExists = true
} catch {
  worktreeExists = false
}

if (worktreeExists) {
  try {
    await fs.rm(worktreePath, { recursive: true, force: true })
  } catch (err) {
    // If fs.rm fails and git.raw failed, propagate the error
    if (gitRemoveError) {
      throw new Error(`Failed to clean up worktree at ${worktreePath}: ${(err as Error).message}`)
    }
  }
}
```

---

## Warnings

### WR-01: Missing UID Validation in Fetch Fallback

**File:** `src/core/sync.ts:314`

**Issue:** The code constructs a fallback message ID when `msg.envelope?.messageId` is undefined:
```typescript
const rawId = msg.envelope?.messageId ?? `no-message-id_uid-${msg.uid}_${folderFilename}`
```

However, there's no validation that `msg.uid` is defined. If ImapFlow returns a message without a UID (which violates the protocol but might occur with malformed servers), the fallback will contain `undefined`, creating `no-message-id_uid-undefined_...`, which is a malformed filename.

**Fix:**
```typescript
// Validate UID before using in fallback
if (msg.uid === undefined || msg.uid === null) {
  throw new Error(`Message missing UID in folder ${folder.path}`)
}

const rawId = msg.envelope?.messageId ?? `no-message-id_uid-${msg.uid}_${folderFilename}`
```

---

### WR-02: Excessive Error Silencing in Worktree Operations

**File:** `src/core/browse.ts:156-167`

**Issue:** The worktree cleanup operations silently catch all errors:
```typescript
try {
  await git.raw(['worktree', 'remove', '--force', worktreePath])
} catch {
  // Worktree didn't exist, ignore
}
```

If the failure is due to permissions, disk errors, or other critical issues (not just "worktree doesn't exist"), the caller will have no visibility. The comment is misleading — a catch block catches all errors, not just "worktree didn't exist."

**Fix:**
```typescript
try {
  await git.raw(['worktree', 'remove', '--force', worktreePath])
} catch (err) {
  // Check if error is "worktree not found" (harmless) or something else
  const message = (err as Error).message
  if (!message.includes('No such working tree') && !message.includes('not found')) {
    // Re-throw non-harmless errors
    throw err
  }
  // Otherwise, worktree didn't exist — safe to continue
}
```

---

### WR-03: Buffer Truncation Risk in `readEmlHeaders`

**File:** `src/core/browse.ts:185-208`

**Issue:** The function reads only the first 4KB of an EML file to extract headers:
```typescript
const buf = Buffer.alloc(4096)
const { bytesRead } = await fd.read(buf, 0, 4096, 0)
```

Per RFC 2822, headers can be arbitrarily large. If a message has headers larger than 4KB, the header section won't be complete (no blank line separator found within 4KB), and `headerSection.split(/\r?\n\r?\n/)[0]` will return the entire 4KB, which is incorrect and will result in truncated parsing.

**Fix:**
```typescript
async function readEmlHeaders(emlPath: string): Promise<Record<string, string>> {
  const fd = await fs.open(emlPath, 'r')
  const buf = Buffer.alloc(4096)
  const { bytesRead } = await fd.read(buf, 0, 4096, 0)
  await fd.close()

  const raw = buf.subarray(0, bytesRead).toString('utf-8')
  
  // Split at first blank line to find header section
  const headerSection = raw.split(/\r?\n\r?\n/)[0] ?? raw
  
  // Check if we have a complete header section
  if (!raw.includes('\n\n') && !raw.includes('\r\n\r\n')) {
    // Headers likely extend beyond 4KB
    console.warn(`Warning: EML file ${emlPath} may have headers larger than 4KB. Parsing truncated headers.`)
  }

  // ... rest of function
}
```

---

### WR-04: Missing Array Validation in `listMessages`

**File:** `src/core/browse.ts:277`

**Issue:** The function assumes `state.messages` is an array and iterates over it:
```typescript
for (const msg of state.messages) {
```

However, after `JSON.parse()`, if the JSON is corrupted and `messages` is null, undefined, or not an array, this will throw a TypeError. The try-catch at line 289 only catches file read errors, not invalid data structure errors after parsing.

**Fix:**
```typescript
// Validate parsed folder state
let state: FolderState
try {
  const content = await fs.readFile(folderPath, 'utf-8')
  const parsed = JSON.parse(content) as FolderState
  
  // Validate structure
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid folder state format: not an object`)
  }
  if (typeof parsed.uidvalidity !== 'string') {
    throw new Error(`Invalid folder state: uidvalidity must be string, got ${typeof parsed.uidvalidity}`)
  }
  if (!Array.isArray(parsed.messages)) {
    throw new Error(`Invalid folder state: messages must be array, got ${Array.isArray(parsed.messages) ? 'array' : typeof parsed.messages}`)
  }
  
  state = parsed
} catch {
  throw new Error(`Folder not found: ${folderName}`)
}
```

---

### WR-05: Unsafe JSON Parsing in `syncFolder`

**File:** `src/core/sync.ts:265-269`

**Issue:** Similar to WR-04, the folder state is parsed without validation:
```typescript
storedState = JSON.parse(jsonContent) as FolderState
```

If the JSON is corrupted (e.g., uidvalidity is a number instead of string), the code continues with invalid data. Later at line 289, the string comparison `storedValidityStr !== serverValidityStr` would use a number converted to string, which might match incorrectly.

**Fix:**
```typescript
let storedState: FolderState | null = null
try {
  const jsonContent = await fs.readFile(folderJsonPath, 'utf-8')
  const parsed = JSON.parse(jsonContent) as FolderState
  
  // Validate schema
  if (typeof parsed.uidvalidity !== 'string') {
    throw new Error(`Invalid uidvalidity in stored state: expected string, got ${typeof parsed.uidvalidity}`)
  }
  if (!Array.isArray(parsed.messages)) {
    throw new Error(`Invalid messages in stored state: expected array, got ${typeof parsed.messages}`)
  }
  
  storedState = parsed
} catch (err) {
  // Treat corrupted state as missing (forces full re-sync)
  if ((err as Error).message.includes('Invalid')) {
    console.warn(`Warning: Folder state corrupted, forcing full re-sync for ${folder.path}`)
    storedState = null
  } else {
    // File doesn't exist yet
    storedState = null
  }
}
```

---

### WR-06: Fragile Empty Text Handling in `viewMessage`

**File:** `src/core/browse.ts:343-346`

**Issue:** The plaintext format handler checks `if (parsed.text !== undefined)`, which is fragile:
```typescript
if (parsed.text !== undefined) {
  return parsed.text
}
throw new Error('No text/plain part found. Use --format eml or --format json to inspect.')
```

If a message has a text/plain part that is an empty string (valid, though unusual), the condition will be true and return the empty string. However, the error message suggests no text part was found, which is misleading. More problematically, if `parsed.text` is undefined but there should have been a text part, the user gets an unhelpful error.

**Fix:**
```typescript
if (format === 'plaintext') {
  // Check if text part exists (even if empty)
  if ('text' in parsed && parsed.text !== undefined) {
    return parsed.text
  }
  // No text part found
  throw new Error('No text/plain part found. Use --format eml or --format json to inspect.')
}
```

Or to distinguish between "no text part" and "empty text part":
```typescript
if (format === 'plaintext') {
  if ('text' in parsed && parsed.text !== undefined) {
    // Could be empty string (valid) or non-empty (valid)
    return parsed.text || ''
  }
  throw new Error('No text/plain part found. Use --format eml or --format json to inspect.')
}
```

---

## Info

### IN-01: Fallback to Zero in UID Validity Check

**File:** `src/core/sync.ts:281-282`

**Issue:** The code uses nullish coalescing to fall back to 0 for uidValidity:
```typescript
const serverValidity = client.mailbox.uidValidity ?? 0n
const serverUidNext = client.mailbox.uidNext ?? 0
```

If the IMAP server legitimately returns 0n for uidValidity (unlikely but possible), this fallback is indistinguishable from the case where the property is undefined. Using 0n as a sentinel value could cause incorrect re-sync logic. There's no logging to indicate which case occurred.

**Suggestion:** Add logging to distinguish between "property is undefined" and "property is 0":
```typescript
const serverValidity = client.mailbox.uidValidity
if (serverValidity === undefined) {
  console.warn(`Warning: No uidValidity from server for ${folder.path}, assuming 0n`)
}
const actualValidity = serverValidity ?? 0n

const serverUidNext = client.mailbox.uidNext
if (serverUidNext === undefined) {
  console.warn(`Warning: No uidNext from server for ${folder.path}, assuming 0`)
}
const actualUidNext = serverUidNext ?? 0
```

---

### IN-02: Unused Variable Suppression in CLI

**File:** `src/cli/index.ts:41-42`

**Issue:** The `config` variable is loaded but not used at the point of `void config`. It's used later by subcommands, but the suppression line suggests the developer was concerned about the unused variable warning. This is a code smell — either use the variable or document why it's loaded early.

**Suggestion:** Rename to `_config` or add a JSDoc comment explaining the early load:
```typescript
// Load config early to validate file existence before any command runs
const config = loadConfig()
```

---

### IN-03: Missing Folder Name Validation

**File:** `src/core/browse.ts:258-262`

**Issue:** The `folderName` parameter is passed to `folderPathToFilename()` without checking for empty or whitespace-only strings. If an empty string is passed, `folderPathToFilename('')` returns `''`, and the JSON file lookup fails with "Folder not found" — which is correct but doesn't indicate the actual problem (invalid input).

**Suggestion:** Add explicit validation:
```typescript
export async function listMessages(
  repoPath: string,
  folderName: string
): Promise<MessageSummary[]> {
  // Validate input
  if (!folderName || !folderName.trim()) {
    throw new Error('Folder name cannot be empty')
  }
  
  const filename = folderPathToFilename(folderName)
  // ... rest of function
}
```

---

### IN-04: Regex Pattern Allows Invalid Dates

**File:** `src/core/browse.ts:120`

**Issue:** The sync commit pattern regex `/^\d{4}-\d{2}-\d{2}(\s\[partial\])?:\s+\+\d+\s+added\s+\/\s+-\d+\s+removed$/` matches any YYYY-MM-DD format, including invalid dates like `2024-13-45` or `2024-02-30`. This is mostly benign (the string came from git, so it's trusted), but it violates strict date validation.

**Suggestion:** Add date validation:
```typescript
function isSyncCommitMessage(message: string): boolean {
  const pattern = /^(\d{4})-(\d{2})-(\d{2})(\s\[partial\])?:\s+\+\d+\s+added\s+\/\s+-\d+\s+removed$/
  const match = message.match(pattern)
  if (!match) return false
  
  const [, year, month, day] = match
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`)
  
  // Verify parsed date matches input (catches invalid dates like 2024-13-45)
  return date.getUTCFullYear() === parseInt(year) &&
         date.getUTCMonth() + 1 === parseInt(month) &&
         date.getUTCDate() === parseInt(day)
}

// In getLog:
return log.all.filter((c) => isSyncCommitMessage(c.message)).map((c) => c.message)
```

---

### IN-05: Unguarded Loop Max in `syncFolder`

**File:** `src/core/sync.ts:307`

**Issue:** The code calculates the fetch range using `Math.max()` on potentially empty array:
```typescript
const lastUid = storedState && storedState.messages.length > 0
  ? Math.max(...storedState.messages.map((m) => m.uid ?? 0))
  : 0
```

If `storedState.messages` is an empty array (which shouldn't happen after validation, but might in edge cases), `Math.max()` on an empty spread will return `-Infinity`, causing the range calculation to be incorrect. The code guards against this with `storedState.messages.length > 0`, so this is already mitigated, but it's fragile.

**Suggestion:** Use a safer approach:
```typescript
const lastUid = storedState && storedState.messages.length > 0
  ? Math.max(...storedState.messages.map((m) => m.uid ?? 0))
  : 0

// Or more robustly:
let lastUid = 0
if (storedState && storedState.messages.length > 0) {
  const uids = storedState.messages.map((m) => m.uid).filter((uid) => uid !== undefined)
  if (uids.length > 0) {
    lastUid = Math.max(...uids)
  }
}
```

---

## Test Coverage Assessment

**Unit tests** (`tests/unit/browse.test.ts`): Comprehensive coverage of:
- `resolveAccount()` with multiple account scenarios
- `getLog()` with filtering and limits
- `listFolders()`, `listMessages()`, `viewMessage()` with valid and error cases

**Integration tests** (`tests/integration/browse.test.ts` and `tests/integration/cli-browse.test.ts`): Good coverage of real filesystem and git operations, including worktree creation and .gitignore handling.

**Note:** Tests do not cover the critical issues found (path traversal in worktree names, type safety on client.mailbox, race conditions in cleanup). Additional tests should verify:
1. Malformed/corrupted folder JSON files are rejected
2. Worktree cleanup handles partial failures gracefully
3. Message IDs with unusual characters are sanitized correctly

---

_Reviewed: 2026-04-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
