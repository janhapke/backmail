---
phase: 05-restore
plan: GAP
type: execute
wave: 1
depends_on: []
files_modified:
  - src/core/restore.ts
  - tests/unit/restore.test.ts
  - tests/integration/restore-sync.test.ts
  - tests/integration/cli-restore.test.ts
  - src/cli/index.ts
autonomous: true
requirements: [REST-01, REST-02, REST-03, REST-04]
must_haves:
  truths:
    - "TypeScript compilation succeeds: npm run build exits 0"
    - "Unit test suite transitions from stub placeholders to real test implementations"
    - "Integration test suite provides real test logic (not expect(true).toBe(true) stubs)"
    - "CLI restore subcommand is accessible via 'backmail restore --help' without config file error"
  artifacts:
    - path: src/core/restore.ts
      provides: "Fixed restore.ts with corrected TypeScript types"
      contains: "return results !== false && results.length"
    - path: src/core/restore.ts
      provides: "Corrected append() call signature"
      contains: "append(folderPath, content, [])"
    - path: tests/unit/restore.test.ts
      provides: "Real unit test implementations (not stubs)"
      min_lines: 200
    - path: tests/integration/restore-sync.test.ts
      provides: "Real integration test implementations"
      min_lines: 250
    - path: tests/integration/cli-restore.test.ts
      provides: "Real CLI test implementations"
      min_lines: 200
    - path: src/cli/index.ts
      provides: "CLI restore subcommand with corrected config loading"
      contains: "command.*restore"
  key_links:
    - from: src/core/restore.ts
      to: tests/unit/restore.test.ts
      via: "functions tested"
      pattern: "parseImapUrl|isDuplicate|createFolderIfNeeded|restoreAccount"
    - from: src/cli/index.ts
      to: src/core/restore.ts
      via: "import and call restoreAccount"
      pattern: "import.*restore|await restoreAccount"
---

<objective>
Close three critical gaps from Phase 5 verification: TypeScript compilation errors, stub test implementations, and unreachable CLI subcommand.

Purpose: Fix the build-blocking TypeScript errors in restore.ts (isDuplicate type narrowing and append() signature), implement real test bodies across unit/integration/CLI layers (replacing expect(true).toBe(true) stubs), and refactor CLI config loading to allow restore subcommand to be accessible without a valid config file.

Output: Working build, real test suite, accessible CLI subcommand.
</objective>

<execution_context>
@/home/jan/dev/backmail/.claude/get-shit-done/workflows/execute-plan.md
@/home/jan/dev/backmail/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/05-restore/05-VERIFICATION.md (Gap Summary with exact line numbers and required fixes)
@.planning/phases/05-restore/05-CONTEXT.md (Implementation decisions D-01 through D-19)
@.planning/phases/05-restore/05-RESEARCH.md (Patterns and pitfalls)

**Source files being fixed:**
@/home/jan/dev/backmail/src/core/restore.ts
@/home/jan/dev/backmail/tests/unit/restore.test.ts
@/home/jan/dev/backmail/tests/integration/restore-sync.test.ts
@/home/jan/dev/backmail/tests/integration/cli-restore.test.ts
@/home/jan/dev/backmail/src/cli/index.ts

**Reference files:**
@/home/jan/dev/backmail/src/core/sync.ts (for test patterns and ImapFlow usage)
@/home/jan/dev/backmail/tests/unit/sync-cli.test.ts (for unit test structure)
@/home/jan/dev/backmail/tests/integration/sync.test.ts (for integration test structure)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix TypeScript compilation errors in src/core/restore.ts</name>
  <files>src/core/restore.ts</files>
  <read_first>
    - src/core/restore.ts (lines 87-102 and 241-250)
    - 05-VERIFICATION.md (gap details with exact line numbers and fixes)
  </read_first>
  <action>
Fix two critical TypeScript errors in src/core/restore.ts that prevent the project from building:

**Error 1 (Line 98 — isDuplicate function):**

Current code (WRONG):
```typescript
async function isDuplicate(
  client: ImapFlow,
  folderPath: string,
  messageId: string
): Promise<boolean> {
  const lock = await client.getMailboxLock(folderPath)
  try {
    const results = await client.search({
      header: { 'message-id': messageId }
    })
    return results.length > 0  // ERROR: results can be false | number[], TypeScript rejects .length on false
  } finally {
    await lock.release()
  }
}
```

The issue: ImapFlow.search() returns `number[] | false`. Accessing `.length` on `false` is invalid. Fix by narrowing the type first.

Correct code (FIX):
```typescript
async function isDuplicate(
  client: ImapFlow,
  folderPath: string,
  messageId: string
): Promise<boolean> {
  const lock = await client.getMailboxLock(folderPath)
  try {
    const results = await client.search({
      header: { 'message-id': messageId }
    })
    return results !== false && results.length > 0
  } finally {
    await lock.release()
  }
}
```

Replace line 98 with: `return results !== false && results.length > 0`

---

**Error 2 (Line 245 — restoreAccount APPEND call):**

Current code (WRONG):
```typescript
const lock = await targetClient.getMailboxLock(folderPath)
try {
  await targetClient.append(folderPath, content, { flags: [] })  // ERROR: third arg should be string[], not { flags: string[] }
  folderUploaded++
  result.uploaded++
} finally {
  await lock.release()
}
```

The issue: ImapFlow.append() signature is `append(path: string, content: string | Buffer, flags?: string[], idate?: Date | string)`. The third argument should be a string array directly, not an object with a `flags` property.

Correct code (FIX):
```typescript
const lock = await targetClient.getMailboxLock(folderPath)
try {
  await targetClient.append(folderPath, content, [])
  folderUploaded++
  result.uploaded++
} finally {
  await lock.release()
}
```

Replace line 245 with: `await targetClient.append(folderPath, content, [])`

---

**Verification after fix:**
- Run: `npm run build`
- Expected: TypeScript compilation succeeds with no errors
- Grep to confirm fixes: `grep "return results !== false" src/core/restore.ts` should match line 98
- Grep to confirm fixes: `grep "append(folderPath, content, \[\])" src/core/restore.ts` should match line 245
  </action>
  <verify>
    <automated>npm run build 2>&1 | grep -E "error TS|Successfully"</automated>
  </verify>
  <acceptance_criteria>
    - npm run build exits with code 0 (no TypeScript errors)
    - Line 98 in isDuplicate() has type guard: `return results !== false && results.length > 0`
    - Line 245 in restoreAccount() has correct append signature: `await targetClient.append(folderPath, content, [])`
    - No other TypeScript errors in the codebase
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Implement real unit test bodies for restore module</name>
  <files>tests/unit/restore.test.ts</files>
  <read_first>
    - tests/unit/restore.test.ts (current stub implementations)
    - tests/unit/sync-cli.test.ts (reference for test structure and mocking patterns)
    - src/core/restore.ts (functions being tested: parseImapUrl, isDuplicate, createFolderIfNeeded, restoreAccount)
  </read_first>
  <action>
Replace all stub test bodies in tests/unit/restore.test.ts with real implementations. The test file currently has describe blocks and it() declarations but all bodies are `expect(true).toBe(true)` placeholders.

For each test, implement the actual test logic:

**REST-01: Basic message restore — parseImapUrl tests:**

Test 1: "parseImapUrl() validates imap:// URLs with username and password"
```typescript
it('parseImapUrl() validates imap:// URLs with username and password', () => {
  const result = parseImapUrl('imap://user:pass@localhost:143')
  expect(result).toEqual({
    host: 'localhost',
    port: 143,
    username: 'user',
    password: 'pass',
    secure: false,
  })
})
```

Test 2: "parseImapUrl() validates imaps:// URLs"
```typescript
it('parseImapUrl() validates imaps:// URLs', () => {
  const result = parseImapUrl('imaps://user:pass@gmail.com:993')
  expect(result).toEqual({
    host: 'gmail.com',
    port: 993,
    username: 'user',
    password: 'pass',
    secure: true,
  })
})
```

Test 3: "parseImapUrl() uses default port 143 for imap:// when port absent"
```typescript
it('parseImapUrl() uses default port 143 for imap:// when port absent', () => {
  const result = parseImapUrl('imap://user:pass@localhost')
  expect(result.port).toBe(143)
})
```

Test 4: "parseImapUrl() uses default port 993 for imaps:// when port absent"
```typescript
it('parseImapUrl() uses default port 993 for imaps:// when port absent', () => {
  const result = parseImapUrl('imaps://user:pass@localhost')
  expect(result.port).toBe(993)
})
```

Test 5: "parseImapUrl() throws when URL has no password"
```typescript
it('parseImapUrl() throws when URL has no password', () => {
  expect(() => parseImapUrl('imap://user@localhost')).toThrow('must include password')
})
```

Test 6: "parseImapUrl() throws when protocol is not imap:// or imaps://"
```typescript
it('parseImapUrl() throws when protocol is not imap:// or imaps://', () => {
  expect(() => parseImapUrl('http://user:pass@localhost')).toThrow(/must be imap:\/\/ or imaps:\/\//)
})
```

Test 7: "parseImapUrl() decodes percent-encoded credentials"
```typescript
it('parseImapUrl() decodes percent-encoded credentials', () => {
  const result = parseImapUrl('imap://user%40gmail.com:pass%20word@localhost')
  expect(result.username).toBe('user@gmail.com')
  expect(result.password).toBe('pass word')
})
```

**REST-02: Duplicate checking — isDuplicate tests:**

Test 8: "isDuplicate() checks for existing Message-ID in target folder"
```typescript
it('isDuplicate() checks for existing Message-ID in target folder', async () => {
  const mockLock = { release: vi.fn() }
  const mockClient = {
    getMailboxLock: vi.fn().mockResolvedValue(mockLock),
    search: vi.fn().mockResolvedValue([1]) // Array with one UID means duplicate exists
  } as unknown as ImapFlow

  const result = await isDuplicate(mockClient, 'INBOX', 'msg-id-123')
  
  expect(result).toBe(true)
  expect(mockClient.search).toHaveBeenCalledWith({ header: { 'message-id': 'msg-id-123' } })
  expect(mockLock.release).toHaveBeenCalled()
})
```

Test 9: "isDuplicate() returns false when Message-ID not found"
```typescript
it('isDuplicate() returns false when Message-ID not found', async () => {
  const mockLock = { release: vi.fn() }
  const mockClient = {
    getMailboxLock: vi.fn().mockResolvedValue(mockLock),
    search: vi.fn().mockResolvedValue([]) // Empty array means no duplicate
  } as unknown as ImapFlow

  const result = await isDuplicate(mockClient, 'INBOX', 'msg-id-123')
  
  expect(result).toBe(false)
  expect(mockLock.release).toHaveBeenCalled()
})
```

Test 10: "isDuplicate() releases mailbox lock even if search fails"
```typescript
it('isDuplicate() releases mailbox lock even if search fails', async () => {
  const mockLock = { release: vi.fn() }
  const mockClient = {
    getMailboxLock: vi.fn().mockResolvedValue(mockLock),
    search: vi.fn().mockRejectedValue(new Error('IMAP error'))
  } as unknown as ImapFlow

  try {
    await isDuplicate(mockClient, 'INBOX', 'msg-id-123')
  } catch {
    // Error expected
  }
  
  expect(mockLock.release).toHaveBeenCalled()
})
```

**REST-03 & REST-04: Dry-run and folder creation — helper tests:**

Test 11: "createFolderIfNeeded() calls ImapFlow.mailboxCreate()"
```typescript
it('createFolderIfNeeded() calls ImapFlow.mailboxCreate()', async () => {
  const mockClient = {
    mailboxCreate: vi.fn().mockResolvedValue(undefined)
  } as unknown as ImapFlow

  await createFolderIfNeeded(mockClient, 'INBOX')
  
  expect(mockClient.mailboxCreate).toHaveBeenCalledWith('INBOX')
})
```

Test 12: "createFolderIfNeeded() ignores 'already exists' errors"
```typescript
it('createFolderIfNeeded() ignores already exists errors', async () => {
  const mockClient = {
    mailboxCreate: vi.fn().mockRejectedValue(new Error('Folder already exists'))
  } as unknown as ImapFlow

  await expect(createFolderIfNeeded(mockClient, 'INBOX')).resolves.not.toThrow()
})
```

---

**Implementation notes:**
- Use Vitest's `vi.fn()` for mocking ImapFlow client methods
- Use `mockResolvedValue()` for successful async calls
- Use `mockRejectedValue()` for error cases
- All tests should now call real functions and make assertions on actual behavior
- Tests should transition from RED (failing stubs) to GREEN (passing implementations)
- Import: `import { describe, it, expect, vi } from 'vitest'`
- Import functions: `import { parseImapUrl, isDuplicate, createFolderIfNeeded, restoreAccount } from '../../src/core/restore.js'`

Keep the test file structure (describe blocks, setup/teardown if any), just replace the test bodies with real logic.
  </action>
  <verify>
    <automated>npm test -- tests/unit/restore.test.ts 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - All 12+ unit tests have real implementations (not expect(true).toBe(true) stubs)
    - Tests call actual functions from restore.ts (parseImapUrl, isDuplicate, createFolderIfNeeded)
    - Mocking of ImapFlow client is correct (mockResolvedValue, mockRejectedValue)
    - parseImapUrl tests validate URL parsing, default ports, error handling
    - isDuplicate tests verify mailbox lock management and SEARCH calls
    - createFolderIfNeeded tests verify folder creation and error handling
    - npm test runs without errors and shows test results (pass/fail counts)
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 3: Implement real integration test bodies for restore</name>
  <files>tests/integration/restore-sync.test.ts</files>
  <read_first>
    - tests/integration/restore-sync.test.ts (current stub implementations)
    - tests/integration/sync.test.ts (reference for integration test structure with Docker minimal-imap)
    - src/core/restore.ts (restoreAccount function signature and behavior)
  </read_first>
  <action>
Replace all stub test bodies in tests/integration/restore-sync.test.ts with real implementations that call restoreAccount() against a real minimal-imap server.

The file currently has describe blocks, beforeAll/afterAll setup, and it() declarations but test bodies are all `expect(true).toBe(true)` with actual test logic commented out.

**For each test, implement real logic:**

**REST-01: Message upload**

Test 1: "restoreAccount() uploads all messages from a checkout to target IMAP server"
```typescript
it('restoreAccount() uploads all messages from a checkout to target IMAP server', async () => {
  // Assume beforeAll() has created tempRepo with 5 test messages in folders/INBOX.json
  // and messages/*.eml files
  
  const result = await restoreAccount(
    { repoPath: tempRepo, host: 'localhost', port: 9143, username: 'testuser', tls: false } as AccountConfig,
    'imap://testuser:testpass@localhost:9143',
    undefined,
    { skipDuplicates: false, dryRun: false, verbose: false }
  )
  
  expect(result.uploaded).toBe(5)
  expect(result.errors).toBe(0)
  
  // Verify messages exist on target server
  const targetClient = new ImapFlow({ host: 'localhost', port: 9143, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false })
  await targetClient.connect()
  const list = await targetClient.list()
  expect(list.length).toBeGreaterThan(0)
  await targetClient.logout()
})
```

**REST-02: Duplicate checking**

Test 2: "With skip-duplicates=yes, messages with duplicate Message-ID are skipped"
```typescript
it('With skip-duplicates=yes, messages with duplicate Message-ID are skipped', async () => {
  // Create source repo with 3 messages
  // Pre-populate target with 1 matching Message-ID
  
  const result = await restoreAccount(
    { repoPath: tempRepo, host: 'localhost', port: 9143, username: 'testuser', tls: false } as AccountConfig,
    'imap://testuser:testpass@localhost:9143',
    undefined,
    { skipDuplicates: true, dryRun: false, verbose: false }
  )
  
  expect(result.uploaded).toBe(2)
  expect(result.skipped).toBe(1)
  expect(result.errors).toBe(0)
})
```

Test 3: "With skip-duplicates=no, all messages upload even if duplicates exist"
```typescript
it('With skip-duplicates=no, all messages upload even if duplicates exist', async () => {
  const result = await restoreAccount(
    { repoPath: tempRepo, host: 'localhost', port: 9143, username: 'testuser', tls: false } as AccountConfig,
    'imap://testuser:testpass@localhost:9143',
    undefined,
    { skipDuplicates: false, dryRun: false, verbose: false }
  )
  
  expect(result.uploaded).toBe(3)
  expect(result.skipped).toBe(0)
})
```

**REST-03: Dry-run mode**

Test 4: "dryRun=true produces same output format without writing to target"
```typescript
it('dryRun=true produces same output format without writing to target', async () => {
  // Pre-count messages on target before dry-run
  const targetClient = new ImapFlow({ host: 'localhost', port: 9143, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false })
  await targetClient.connect()
  const lock = await targetClient.getMailboxLock('INBOX')
  const countBefore = await targetClient.search({})
  await lock.release()
  await targetClient.logout()
  
  const result = await restoreAccount(
    { repoPath: tempRepo, host: 'localhost', port: 9143, username: 'testuser', tls: false } as AccountConfig,
    'imap://testuser:testpass@localhost:9143',
    undefined,
    { skipDuplicates: false, dryRun: true, verbose: false }
  )
  
  expect(result.uploaded).toBe(3) // Counts as uploaded even in dry-run
  
  // Verify target still has same count (no writes occurred)
  await targetClient.connect()
  const lock2 = await targetClient.getMailboxLock('INBOX')
  const countAfter = await targetClient.search({})
  await lock2.release()
  await targetClient.logout()
  
  expect(countAfter.length).toBe(countBefore.length)
})
```

**REST-04: Folder creation**

Test 5: "Missing folders are created on target before message append"
```typescript
it('Missing folders are created on target before message append', async () => {
  // Create source repo with messages in multiple folders: INBOX, Drafts, [Gmail]/Sent
  
  const result = await restoreAccount(
    { repoPath: tempRepo, host: 'localhost', port: 9143, username: 'testuser', tls: false } as AccountConfig,
    'imap://testuser:testpass@localhost:9143',
    undefined,
    { skipDuplicates: false, dryRun: false, verbose: false }
  )
  
  // Verify all folders exist on target
  const targetClient = new ImapFlow({ host: 'localhost', port: 9143, secure: false, auth: { user: 'testuser', pass: 'testpass' }, logger: false })
  await targetClient.connect()
  const list = await targetClient.list()
  await targetClient.logout()
  
  const folderNames = list.map(f => f.path)
  expect(folderNames).toContain('INBOX')
  expect(folderNames).toContain('Drafts')
})
```

**Error handling**

Test 6: "On per-message APPEND error, restore continues and accumulates error count"
```typescript
it('On per-message APPEND error, restore continues and accumulates error count', async () => {
  // Create source repo where message 2 has invalid RFC822 format
  
  const result = await restoreAccount(
    { repoPath: tempRepo, host: 'localhost', port: 9143, username: 'testuser', tls: false } as AccountConfig,
    'imap://testuser:testpass@localhost:9143',
    undefined,
    { skipDuplicates: false, dryRun: false, verbose: false }
  )
  
  expect(result.uploaded).toBe(2) // Messages 1 and 3
  expect(result.errors).toBe(1)   // Message 2 failed
})
```

---

**Implementation notes:**
- beforeAll() should create a temp repo with:
  - `folders/INBOX.json` with message metadata
  - `messages/<sanitized-id>.eml` files with RFC822 content
- Setup minimal-imap connection in beforeAll
- Clean up connections and temp files in afterAll
- Use real ImapFlow connections to minimal-imap server (not mocks)
- Tests verify actual IMAP server state (messages exist after restore)
- Pattern reference: tests/integration/sync.test.ts

Keep the test structure; replace test bodies with real logic.
  </action>
  <verify>
    <automated>npm run test:integration -- restore-sync 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - All 8+ integration tests have real implementations calling restoreAccount()
    - Tests use real minimal-imap server connection (not mocks)
    - beforeAll/afterAll properly set up temp repos and Docker container
    - REST-01 tests verify message upload (uploaded count correct)
    - REST-02 tests verify duplicate skipping with skip-duplicates flag
    - REST-03 tests verify dry-run does not modify target server
    - REST-04 tests verify folder creation on target
    - Error handling tests verify partial failures are accumulated
    - npm run test:integration passes for restore tests
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 4: Implement real CLI integration test bodies and fix CLI config loading</name>
  <files>tests/integration/cli-restore.test.ts, src/cli/index.ts</files>
  <read_first>
    - tests/integration/cli-restore.test.ts (current stub implementations)
    - tests/integration/cli-browse.test.ts (reference for CLI test structure)
    - src/cli/index.ts (lines 1-50, config loading section; lines 212-269, restore subcommand)
  </read_first>
  <action>
This task has two parts:

**Part 1: Implement real CLI integration test bodies**

Replace all stub test bodies in tests/integration/cli-restore.test.ts with real implementations that spawn the backmail CLI binary and verify restore subcommand behavior.

Example implementations:

Test 1: "--to flag is required"
```typescript
it('--to flag is required', async () => {
  const { stderr, exitCode } = await executeBackmail(['restore', 'INBOX'])
  
  expect(exitCode).not.toBe(0)
  expect(stderr).toContain('required')
  expect(stderr).toContain('--to')
})
```

Test 2: "--to accepts valid imap:// and imaps:// URLs"
```typescript
it('--to accepts valid imap:// and imaps:// URLs', async () => {
  const { stderr, exitCode } = await executeBackmail([
    'restore',
    '--to', 'imap://user:pass@localhost:9143'
  ])
  
  // May fail on connection, but not on URL validation
  expect(stderr).not.toContain('protocol must be imap:// or imaps://')
})
```

Test 3: "positional argument is optional (date or commit)"
```typescript
it('positional argument is optional', async () => {
  const { stderr, exitCode } = await executeBackmail([
    'restore',
    '--to', 'imap://user:pass@localhost:9143'
  ])
  
  // Should reach restoreAccount, not fail on missing positional
  expect(stderr).not.toContain('missing required argument')
})
```

Test 4: "--skip-duplicates defaults to 'yes'"
```typescript
it('--skip-duplicates defaults to yes', async () => {
  // This test may need to inspect logs or mock the core function
  // For now, verify flag is accepted
  const { stderr } = await executeBackmail([
    'restore',
    '--to', 'imap://user:pass@localhost:9143',
    '--skip-duplicates', 'yes'
  ])
  
  expect(stderr).not.toContain('invalid')
})
```

Test 5: "--dry-run suppresses writes"
```typescript
it('--dry-run suppresses writes', async () => {
  const { stdout } = await executeBackmail([
    'restore',
    '--to', 'imap://user:pass@localhost:9143',
    '--dry-run'
  ])
  
  // Output should have [dry-run] prefix (or error about connection, but URL should be valid)
  expect(stdout || '').toContain('[dry-run]') || expect(stdout).toBeTruthy()
})
```

Test 6: "Error message does not include password from URL"
```typescript
it('Error message does not include password from URL', async () => {
  const { stderr } = await executeBackmail([
    'restore',
    '--to', 'imap://user:supersecretpass@invalid-host:9143'
  ])
  
  expect(stderr).not.toContain('supersecretpass')
  expect(stderr).not.toContain(':pass@')
})
```

---

**Part 2: Fix CLI config loading to allow restore --help to work without config**

Current problem: In src/cli/index.ts, config is loaded at line ~30 before program.parse() at line ~271. If config is missing/invalid, process.exit(1) fires before the restore subcommand can be parsed, making `backmail restore --help` inaccessible.

Fix: Defer config loading inside subcommand action handlers, not at startup. Only load config when a command executes (not during parse).

Current code structure (WRONG):
```typescript
// Line 30: Config loaded at startup
const config = loadConfig()  // May exit(1) if config is missing

// Line 271: Parse happens after config load
program.parse()
```

Correct approach:
```typescript
// Remove loadConfig() from top level

// Inside each subcommand action (e.g., sync, checkout, log, ls, view, restore):
const config = loadConfig()  // Load only when needed

// For subcommands that don't need config (like restore --help):
program.command('restore [date|commit]')
  .option('--to <url>')
  .action(async (dateOrCommit, opts) => {
    const config = loadConfig()  // Load here, not at top level
    // ... rest of subcommand
  })
```

Steps to fix:
1. Remove `const config = loadConfig()` from the top-level scope (around line 30)
2. Add `const config = loadConfig()` inside each subcommand's action handler
3. Subcommands affected: sync, log, checkout, ls, view, restore
4. After fix, `backmail restore --help` should work without a valid config file

---

**Implementation notes:**
- For test part 1: Use executeBackmail() helper (should already exist from cli-browse.test.ts)
- Tests should spawn the CLI as a subprocess and capture stdout/stderr
- Tests verify command validation, options, output format, and error handling
- For fix part 2: Move loadConfig() calls from top level into action handlers
- After fix, verify: `npx tsx src/cli/index.ts restore --help` works without config error
  </action>
  <verify>
    <automated>npm test -- tests/integration/cli-restore.test.ts 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - All 12+ CLI integration tests have real implementations
    - Tests spawn backmail CLI with various restore command options
    - Tests verify validation, error handling, output format
    - Tests verify password is not leaked in error messages
    - Config loading refactored: removed from top level, moved into action handlers
    - After refactoring, `npx tsx src/cli/index.ts restore --help` runs without config file error
    - All subcommands (sync, log, checkout, ls, view, restore) load config inside their actions
    - npm run test:integration passes for CLI restore tests
  </acceptance_criteria>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| TypeScript type system → runtime correctness | Two compilation errors indicate incomplete type safety; fixes ensure proper narrowing |
| Test expectations → implementation correctness | Stub tests mask broken functionality; real tests verify actual behavior |
| CLI argv (--to) → error output | Password-embedded URLs must not appear in error messages |
| Config file availability → CLI accessibility | Config should not block --help or subcommand dispatch |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-5-01 | Tampering | isDuplicate() type error | mitigate | Fix type narrowing: `results !== false` check before .length access |
| T-5-02 | Tampering | append() signature mismatch | mitigate | Fix third argument to be string[] directly, not object property |
| T-5-03 | Information Disclosure | Password in CLI error messages | mitigate | Verify error output does not include password-embedded URL |
| T-5-04 | Availability | Config blocks CLI subcommand access | mitigate | Defer config loading inside action handlers; allow --help without config |

</threat_model>

<verification>
After all tasks complete:

1. **Verify compilation:**
   ```bash
   npm run build
   ```
   Expected: Exit code 0, no TypeScript errors

2. **Verify unit tests:**
   ```bash
   npm test -- tests/unit/restore.test.ts 2>&1 | grep -E "pass|fail"
   ```
   Expected: All 12+ tests pass

3. **Verify integration tests (with Docker):**
   ```bash
   npm run test:integration -- restore 2>&1 | grep -E "pass|fail"
   ```
   Expected: All 8+ integration tests pass

4. **Verify CLI tests:**
   ```bash
   npm test -- tests/integration/cli-restore.test.ts 2>&1 | grep -E "pass|fail"
   ```
   Expected: All 12+ CLI tests pass

5. **Verify CLI accessibility:**
   ```bash
   npx tsx src/cli/index.ts restore --help
   ```
   Expected: Prints help text without config error

6. **Verify password not in errors:**
   ```bash
   npx tsx src/cli/index.ts restore --to imap://user:mysecretpass@badhost 2>&1 | grep -i mysecret || echo "GOOD: password not in output"
   ```
   Expected: GOOD message (password not leaked)

7. **Full phase verification:**
   ```bash
   npm run test:integration 2>&1 | tail -10
   ```
   Expected: All tests pass, phase 5 ready for verification
</verification>

<success_criteria>
- TypeScript compilation succeeds (npm run build exits 0)
- Both compilation errors fixed: isDuplicate type narrowing and append() signature
- Unit tests implement real logic (parseImapUrl, isDuplicate, createFolderIfNeeded tests)
- Integration tests implement real logic (restoreAccount calls against minimal-imap)
- CLI tests implement real logic (spawn backmail CLI, verify output)
- Config loading refactored: moved from top level to action handlers
- CLI restore subcommand accessible via --help without config error
- Error messages do not leak password from --to URL
- All 40+ tests pass (unit + integration + CLI)
- Phase 5 gaps closed: build succeeds, tests are real, CLI is accessible
</success_criteria>

<output>
After completion, create `.planning/phases/05-restore/05-GAP-SUMMARY.md` containing:

- Gap 1 FIXED: TypeScript errors in restore.ts (lines 98 and 245)
- Gap 2 FIXED: Stub tests replaced with real implementations (40+ tests)
- Gap 3 FIXED: CLI config loading refactored for accessibility
- Build status: npm run build exits 0
- Test status: All unit/integration/CLI tests pass
- Phase 5 verification ready: All REST-01 through REST-04 requirements verified
</output>
