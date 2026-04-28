# Phase 5: Restore - Pattern Map

**Mapped:** 2026-04-22
**Files analyzed:** 6 new/modified files
**Analogs found:** 6 / 6 (all files have close matches)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/restore.ts` | service | CRUD + streaming | `src/core/sync.ts` | exact (inverse operation) |
| `src/core/index.ts` | config/re-export | request-response | `src/core/index.ts` (existing) | self-reference |
| `src/cli/index.ts` | CLI handler | request-response | `src/cli/index.ts` (existing) | self-reference |
| `tests/unit/restore.test.ts` | test | unit | `tests/unit/sync-cli.test.ts` | role-match |
| `tests/integration/restore-sync.test.ts` | test | integration | `tests/integration/sync.test.ts` | role-match |
| `tests/integration/cli-restore.test.ts` | test | integration | `tests/integration/cli-browse.test.ts` | role-match |

---

## Pattern Assignments

### `src/core/restore.ts` (service, CRUD + streaming)

**Analog:** `src/core/sync.ts`

Restore is the inverse of sync — reads from local filesystem and writes to remote IMAP. Copy the structural patterns (error handling, ImapFlow usage, result types) from sync.

**Imports pattern** (lines 1-11 of sync.ts):
```typescript
import fs from 'node:fs/promises'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import { simpleGit } from 'simple-git'
import type { AccountConfig } from './index.js'
import { getPassword } from './config.js'
```

For restore, add URL parsing imports:
```typescript
import fs from 'node:fs/promises'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import { simpleGit } from 'simple-git'
import type { AccountConfig } from './index.js'
import { sanitizeMessageId, folderPathToFilename } from './sync.js'
import { checkoutCommit } from './browse.js'
```

**Core IMAP connection and logger pattern** (lines 186-192 of sync.ts):
```typescript
// T-3-03: MANDATORY logger: false in every ImapFlow constructor
const client = new ImapFlow({
  host: config.host,
  port: config.port,
  secure: config.tls,
  auth: { user: config.username, pass: password },
  logger: false,
})
```

For restore, apply the same pattern to target connection:
```typescript
const targetClient = new ImapFlow({
  host: target.host,
  port: target.port,
  secure: target.secure,
  auth: { user: target.username, pass: target.password },
  logger: false,  // MANDATORY per Phase 3 T-3-03
})
```

**Result type pattern** (lines 28-34 of sync.ts):
```typescript
export interface SyncResult {
  added: number
  removed: number
  partial: boolean
  repoInitialized: boolean
  folderResults: FolderSyncResult[]
}
```

For restore, create analogous result type:
```typescript
export interface RestoreResult {
  uploaded: number
  skipped: number
  errors: number
}

export interface RestoreOptions {
  skipDuplicates: boolean
  dryRun: boolean
  verbose: boolean
}
```

**Mailbox lock pattern** (lines 274-356 of sync.ts):
```typescript
const lock = await client.getMailboxLock(folder.path)
try {
  // IMAP operations here
  const results = await client.search({ all: true }, { uid: true })
  // ... more operations ...
} finally {
  lock.release()
}
```

For restore, reuse same lock pattern for SEARCH (duplicate checking) and APPEND:
```typescript
const lock = await targetClient.getMailboxLock(folderPath)
try {
  // SEARCH for duplicates if needed
  const results = await targetClient.search({
    header: { 'message-id': messageId }
  })
  // APPEND message
  await targetClient.append(folderPath, messageContent, { flags: [] })
} finally {
  lock.release()
}
```

**Error handling and accumulation pattern** (lines 213-221 of sync.ts):
```typescript
try {
  const folderResult = await syncFolder(...)
  added += folderResult.added
  removed += folderResult.removed
  folderResults.push(folderResult)
} catch (err) {
  // Per-folder error: accumulate and continue
  folderResults.push({
    path: folder.path,
    added: 0,
    removed: 0,
    error: err as Error,
  })
}
```

For restore, follow same pattern — continue on per-message error, accumulate count:
```typescript
try {
  // APPEND or duplicate check
  await targetClient.append(...)
  uploaded++
} catch (err) {
  errors++
  // Log error but continue to next message
  // Return counts at end
}
```

**Logout and cleanup pattern** (lines 230-232 of sync.ts):
```typescript
} finally {
  await client.logout().catch(() => {})
}
```

For restore, apply same cleanup:
```typescript
} finally {
  await targetClient.logout().catch(() => {})
}
```

**Checkout/worktree integration** (import from browse.ts, lines 133-179):
```typescript
export async function checkoutCommit(
  repoPath: string,
  dateOrHash: string
): Promise<{ path: string; sha: string }> {
  // Resolves date to commit, creates worktree, returns path
}
```

For restore, call when `dateOrCommit` positional arg is provided (Phase 5 D-03):
```typescript
let sourcePath = config.repoPath
if (dateOrCommit) {
  const checkout = await checkoutCommit(config.repoPath, dateOrCommit)
  sourcePath = checkout.path
}
```

---

### `src/core/index.ts` (config/re-export, request-response)

**Analog:** `src/core/index.ts` (existing file)

Add exports for restore module following the same pattern as sync/browse exports.

**Current export pattern** (lines 28-44 of index.ts):
```typescript
// Phase 3: Sync module public API
export type { SyncResult, SyncOptions, FolderSyncResult } from './sync.js'
export { syncAccount } from './sync.js'

// Phase 4: Browse module public API
export type { MessageSummary } from './browse.js'
export {
  resolveAccount,
  getLog,
  checkoutCommit,
  listFolders,
  listMessages,
  viewMessage,
} from './browse.js'
```

For restore, add after Phase 4 exports:
```typescript
// Phase 5: Restore module public API
export type { RestoreResult, RestoreOptions } from './restore.js'
export { restoreAccount } from './restore.js'
```

---

### `src/cli/index.ts` (CLI handler, request-response)

**Analog:** `src/cli/index.ts` (existing file, reference sync and browse subcommands)

Add restore subcommand following the same pattern as checkout and sync handlers.

**Checkout subcommand pattern** (lines 148-161 of cli/index.ts):
```typescript
program
  .command('checkout <date|commit>')
  .description('Create a git worktree at a point in history')
  .option('--account <name>', 'account name (optional if single account configured)')
  .action(async (dateOrHash: string, opts: { account?: string }) => {
    try {
      const [, accountConfig] = resolveAccount(config, opts.account)
      const result = await checkoutCommit(accountConfig.repoPath, dateOrHash)
      console.log(`Checked out ${dateOrHash} (${result.sha}) → ${result.path}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })
```

For restore, follow same structure with additional options for --to, --skip-duplicates, --dry-run, --verbose:
```typescript
program
  .command('restore [date|commit]')
  .description('Restore messages from backup to target IMAP server')
  .requiredOption('--to <imap-url>', 'target IMAP URL (imap:// or imaps://)')
  .option('--account <name>', 'account name (optional if single account configured)')
  .option('--skip-duplicates <yes|no>', 'check for duplicates (default: yes)', 'yes')
  .option('--dry-run', 'output without writing to target server')
  .option('--verbose', 'log one line per message')
  .action(async (dateOrCommit: string | undefined, opts: {
    to: string
    account?: string
    skipDuplicates: string
    dryRun?: boolean
    verbose?: boolean
  }) => {
    try {
      const [, accountConfig] = resolveAccount(config, opts.account)
      const result = await restoreAccount(
        accountConfig,
        opts.to,
        dateOrCommit,
        {
          skipDuplicates: opts.skipDuplicates === 'yes',
          dryRun: opts.dryRun ?? false,
          verbose: opts.verbose ?? false,
        }
      )
      // Format and print output per D-14, D-15, D-16
      console.log(`Total: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.errors} errors`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })
```

**Error handling pattern** — console.error + process.exit(1):
```typescript
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}
```

---

### `tests/unit/restore.test.ts` (test, unit)

**Analog:** `tests/unit/sync-cli.test.ts`

Unit tests for URL parsing, duplicate logic, sanitization functions, error cases. Use Vitest's describe/it/expect pattern.

**Test structure pattern** (lines 1-24 of sync-cli.test.ts):
```typescript
import { describe, it, expect } from 'vitest'
import { /* imported functions */ } from '../../src/core/...'

describe('Feature Name: Requirement description', () => {
  it('Test case name: what it should do', () => {
    // Arrange
    const input = ...
    // Act
    const result = ...
    // Assert
    expect(result).toBe(...)
  })
})
```

For restore, create unit tests for:
1. URL parsing (valid imap://, imaps://, missing password, invalid protocol)
2. Message-ID duplicate detection logic
3. Folder sanitization and path construction
4. Dry-run flag handling
5. Error accumulation

**Test helper pattern** — use helper functions for fixture creation:
```typescript
const mkFolder = (path: string, flags: string[] = []) => ({
  path, delimiter: '/', flags: new Set(flags),
})
```

---

### `tests/integration/restore-sync.test.ts` (test, integration)

**Analog:** `tests/integration/sync.test.ts`

Integration tests for core restore function against minimal-imap Docker container.

**Integration test structure** (lines 1-45, 57-96 of sync.test.ts):
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ImapFlow } from 'imapflow'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { syncAccount } from '../../src/core/sync.js'

let tmpRepo: string

beforeAll(async () => {
  // Create tmp directory
  tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-test-'))
  // Set up environment variables for test credentials
  process.env.BACKMAIL_TEST_PASSWORD = 'testpass'
  // Seed IMAP server with fixtures
})

afterAll(async () => {
  // Clean up tmp directory
  await fs.rm(tmpRepo, { recursive: true, force: true })
  delete process.env.BACKMAIL_TEST_PASSWORD
})

describe('REST-01: end-to-end restore from checkout to target', () => {
  it('uploads messages from local checkout to target IMAP server', async () => {
    // Create source repo (e.g., via sync)
    // Create target connection
    // Call restoreAccount()
    // Assert: messages appear on target server
  })
})
```

For restore, test:
1. REST-01: basic message upload to target
2. REST-02: duplicate checking (message with same Message-ID skipped)
3. REST-03: dry-run produces same output format without writing
4. REST-04: missing folders created on target

---

### `tests/integration/cli-restore.test.ts` (test, integration)

**Analog:** `tests/integration/cli-browse.test.ts`

CLI integration tests for restore command with all flags.

**CLI integration pattern** — spawn CLI as subprocess and capture output:
```typescript
// Similar to cli-browse.test.ts pattern
describe('CLI: restore subcommand', () => {
  it('--to flag is required', async () => {
    // Execute: backmail restore [--account test]
    // Assert: error message about missing --to
  })
  
  it('--dry-run produces output without writing', async () => {
    // Execute: backmail restore --to imaps://... --dry-run
    // Assert: output contains "[dry-run]" prefix
    // Assert: no messages written to target
  })
})
```

---

## Shared Patterns

### IMAP Connection and Credential Handling

**Source:** Phase 3 T-3-03 (mandatory logger: false), Phase 5 RESEARCH.md Pattern 1

**Apply to:** `src/core/restore.ts` (both source and target connections)

**Pattern:**
```typescript
// T-3-03: MANDATORY logger: false in ImapFlow constructor
// This prevents ImapFlow from logging IMAP protocol trace
const client = new ImapFlow({
  host: config.host,
  port: config.port,
  secure: config.tls,
  auth: { user: config.username, pass: config.password },
  logger: false,  // CRITICAL: never log IMAP protocol
})
```

For restore target URL parsing (RESEARCH.md Pattern 1):
```typescript
function parseImapUrl(urlStr: string): {
  host: string
  port: number
  username: string
  password: string
  secure: boolean
} {
  const url = new URL(urlStr)
  
  if (url.protocol !== 'imap:' && url.protocol !== 'imaps:') {
    throw new Error('URL must start with imap:// or imaps://')
  }
  
  if (!url.username || !url.password) {
    throw new Error('URL must include username:password')
  }
  
  const secure = url.protocol === 'imaps:'
  const defaultPort = secure ? 993 : 143
  const port = url.port ? parseInt(url.port, 10) : defaultPort
  
  return {
    host: url.hostname ?? 'localhost',
    port,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    secure,
  }
}
```

### Mailbox Lock Pattern

**Source:** `src/core/sync.ts` lines 274-356, `tests/integration/sync.test.ts` lines 34-40

**Apply to:** All IMAP operations (SEARCH, APPEND, CREATE) in `src/core/restore.ts`

**Pattern:**
```typescript
const lock = await client.getMailboxLock(folderPath)
try {
  // Perform IMAP operations: SEARCH, APPEND, CREATE
  const results = await client.search({ /* criteria */ })
  await client.append(folderPath, content, { flags: [] })
} finally {
  lock.release()  // ALWAYS release, even on error
}
```

**Critical:** Never omit the `finally` block. Unreleased locks cause subsequent operations to hang.

### Filesystem Sanitization

**Source:** `src/core/sync.ts` lines 59-84

**Apply to:** `src/core/restore.ts` when constructing paths to read `.eml` files

**Pattern:**
```typescript
import { sanitizeMessageId, folderPathToFilename } from './sync.js'

// When reading message from disk for APPEND
const sanitized = sanitizeMessageId(rawMessageId)
const emlPath = path.join(sourcePath, 'messages', `${sanitized}.eml`)
const content = await fs.readFile(emlPath)

// When reading folder metadata from disk
const folderFilename = folderPathToFilename(folderPath)
const folderJsonPath = path.join(sourcePath, 'folders', `${folderFilename}.json`)
const state = JSON.parse(await fs.readFile(folderJsonPath, 'utf-8'))
```

### Account Resolution

**Source:** `src/core/browse.ts` lines 26-58

**Apply to:** CLI restore command

**Pattern:**
```typescript
import { resolveAccount } from '../core/index.js'

// In CLI action handler
const [accountName, accountConfig] = resolveAccount(config, opts.account)
// accountName: resolved account name (or auto-selected)
// accountConfig: AccountConfig object with host, port, username, tls, repoPath
```

### Error Message Sanitization

**Source:** Phase 5 RESEARCH.md Pitfall 4

**Apply to:** CLI error output in restore subcommand

**Pattern:**
```typescript
try {
  const result = await restoreAccount(accountConfig, opts.to, ...)
} catch (err) {
  // NEVER print the full error or URL containing password
  const msg = (err as Error).message
  console.error(`Restore failed: ${msg}`)
  // Not: console.error(`Restore failed to ${opts.to}: ${msg}`)
  process.exit(1)
}
```

---

## No Analog Found

None — all files have close matches in the existing codebase.

---

## Metadata

**Analog search scope:**
- `src/core/` — sync.ts, browse.ts, config.ts, index.ts
- `src/cli/` — index.ts
- `tests/unit/` — sync-cli.test.ts, fixtures.test.ts
- `tests/integration/` — sync.test.ts, cli-browse.test.ts

**Files scanned:** 12 core/CLI/test files

**Pattern extraction date:** 2026-04-22

**Key findings:**
- Phase 5 restore mirrors Phase 3 sync inverted (local filesystem → remote IMAP)
- Reuse ImapFlow patterns exactly: `logger: false` mandatory, mailbox lock required, error accumulation
- CLI subcommand follows Phase 4 browse pattern: resolveAccount(), try/catch, console.error/process.exit
- Test structure mirrors sync.test.ts (integration) and sync-cli.test.ts (unit)
- All core functions receive AccountConfig explicitly; no internal config loading
- Filesystem paths use sanitizeMessageId() and folderPathToFilename() from sync.ts
- Checkout integration calls checkoutCommit() from browse.ts when date/commit provided
