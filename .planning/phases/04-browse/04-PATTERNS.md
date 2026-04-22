# Phase 4: Browse - Pattern Map

**Mapped:** 2026-04-22
**Files analyzed:** 4 (3 new/modified)
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/core/browse.ts` | service/utility | file-I/O, request-response | `src/core/sync.ts` | exact |
| `src/core/index.ts` | export | module boundary | self (existing) | exact |
| `src/cli/index.ts` | CLI route | request-response | self (sync command pattern) | exact |
| `src/core/sync.ts` | service | file-I/O, CRUD | self (lines 286-301) | self (fix location) |

---

## Pattern Assignments

### `src/core/browse.ts` (service/utility, file-I/O + request-response)

**Analog:** `src/core/sync.ts` — same core module structure, same import patterns, same FolderState types, same path/sanitization helpers

**Imports pattern** (src/core/sync.ts, lines 1-11):
```typescript
import fs from 'node:fs/promises'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import type { AccountConfig } from './index.js'
// Core module may also import:
import type { BackmailConfig } from './config.js'
```

**Function signature pattern** — core functions receive AccountConfig or full repoPath string, never load config themselves:
```typescript
// From sync.ts line 165:
export async function syncAccount(
  accountName: string,
  config: AccountConfig,
  opts: SyncOptions,
): Promise<SyncResult>

// Pattern for browse.ts — same signature style:
export async function getLog(repoPath: string, limit: number | 'unlimited'): Promise<string[]>
export async function checkoutCommit(repoPath: string, dateOrHash: string): Promise<string>
export async function listFolders(repoPath: string): Promise<string[]>
export async function listMessages(repoPath: string, folder: string): Promise<Array<{id: string; date: string; from: string; subject: string}>>
export async function viewMessage(repoPath: string, messageId: string, format: 'eml' | 'plaintext' | 'json'): Promise<string | Record<string, any>>
export function resolveAccount(config: BackmailConfig, accountName?: string): [string, AccountConfig]
```

**Error handling pattern** (src/core/sync.ts, lines 213-220, 223-232):
```typescript
// Per-error try/catch with throw — let CLI layer handle output
try {
  const folderResult = await syncFolder(client, folder, config.repoPath, opts.verbose)
  added += folderResult.added
  removed += folderResult.removed
  folderResults.push(folderResult)
} catch (err) {
  // Re-throw or wrap with context
  throw new Error(`Failed to process ${itemName}: ${(err as Error).message}`)
}
```

**File I/O pattern** (src/core/sync.ts, lines 259-269):
```typescript
// Read JSON file with fallback to null
let storedState: FolderState | null = null
try {
  const jsonContent = await fs.readFile(folderJsonPath, 'utf-8')
  storedState = JSON.parse(jsonContent) as FolderState
} catch {
  // File doesn't exist yet; start fresh
}

// Write JSON file
await fs.writeFile(folderJsonPath, JSON.stringify(updatedState, null, 2))

// Unlink (delete) file with fallback
await fs.unlink(msgPath).catch(() => {})

// Read directory
const files = await fs.readdir(folderPath)
```

**simple-git pattern** (src/core/sync.ts, lines 154-159, 235-240):
```typescript
import { simpleGit } from 'simple-git'

const git = simpleGit(repoPath)

// Check repo status
const status = await git.status()
if (!status.isClean()) { ... }

// Log operations (for browse)
const log = await git.log({ maxCount: 20 })
const commits = await git.raw(['worktree', 'add', worktreePath, commitRef])
```

**Reuse helper functions from sync.ts** (lines 59-84):
```typescript
// Import and reuse in browse.ts:
export function sanitizeMessageId(messageId: string): string { ... }
export function folderPathToFilename(imapPath: string): string { ... }

// In browse.ts imports:
import { sanitizeMessageId, folderPathToFilename } from './sync.js'
```

**FolderState type definition** (src/core/sync.ts, lines 44-48):
```typescript
interface FolderState {
  uidvalidity: string
  uidnext: number
  messages: FolderMessage[]
}

interface FolderMessage {
  uid: number
  'message-id': string
  flags: string[]
}
```
For browse.ts, re-use or import these types from sync.ts (do NOT re-define).

---

### `src/core/index.ts` (export module boundary)

**Analog:** self (existing pattern in lines 27-33)

**Pattern for adding browse exports:**
```typescript
// Existing Phase 3 pattern (lines 31-33):
// Phase 3: Sync module public API
export type { SyncResult, SyncOptions, FolderSyncResult } from './sync.js'
export { syncAccount } from './sync.js'

// Phase 4: Add browse exports in same style (new section after Phase 3):
// Phase 4: Browse module public API
export { 
  getLog, 
  checkoutCommit, 
  listFolders, 
  listMessages, 
  viewMessage,
  resolveAccount 
} from './browse.js'
```

**Module boundary rules** (lines 2-8 comments):
```typescript
// ARCH-01: public API boundary
// RULES:
//   - No circular imports into the CLI layer
//   - No process exit calls
//   - No console log/error calls
//   - No readline or interactive I/O
// All relative imports within src/core/ must use .js extension
```

---

### `src/cli/index.ts` (CLI subcommand routes)

**Analog:** self (sync subcommand pattern, lines 50-114)

**Subcommand structure pattern** (lines 50-114):
```typescript
// Pattern from sync command:
program
  .command('sync [account]')
  .description('Sync IMAP mailbox(es) to git')
  .option('--some-flag <value>', 'description', defaultValue)
  .action(async (account: string | undefined, opts: { someFlag: string }) => {
    // 1. Resolve account via config (use helper from core)
    const [accountName, accountConfig] = resolveAccount(config, opts.account)
    
    // 2. Call core function
    const result = await coreFunction(accountConfig.repoPath, ...)
    
    // 3. Format and print output to stdout
    console.log(`...formatted result...`)
    
    // 4. Exit with error code on failure
    if (result.error) process.exit(1)
  })
```

**Account flag pattern** (from CONTEXT.md D-01, D-02):
```typescript
// All browse commands use --account flag (optional when single account)
program
  .command('log')
  .description('Show sync history')
  .option('--account <name>', 'account name (optional if single account configured)')
  .option('--limit <n>', 'number of commits to show', '20')
  .action(async (opts: { account?: string; limit: string }) => {
    const [accountName, accountConfig] = resolveAccount(config, opts.account)
    // ...
  })
```

**Program setup** (lines 11-42):
```typescript
import { Command } from 'commander'
import { loadConfig } from '../core/index.js'

const program = new Command()

program
  .name('backmail')
  .description('Mirror IMAP mailboxes to git')
  .version('0.1.0')

// Help/version must work without config
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  program.parse(process.argv)
  process.exit(0)
}

// Load config early — all subcommands need it
let config
try {
  config = loadConfig()
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}

// Subcommands added after this point — config is always available
```

**Error handling pattern in CLI** (lines 84-113):
```typescript
let anyFailed = false
for (const name of accountNames) {
  try {
    const result = await coreFunction(...)
    // Format result for output
    console.log(`...output...`)
    // Check for per-item errors
    for (const item of result.items) {
      if (item.error) {
        console.error(`...error message...`)
        anyFailed = true
      }
    }
  } catch (err) {
    console.error(`${name}: ${(err as Error).message}`)
    anyFailed = true
  }
}

if (anyFailed) process.exit(1)
```

**Parser invocation** (line 116):
```typescript
program.parse(process.argv)
```

---

### `src/core/sync.ts` (CR-01: BigInt fix)

**Location:** src/core/sync.ts, lines 285-301 (uidvalidity comparison)

**Current unsafe pattern** (lines 286-289):
```typescript
let storedValidity: bigint | null = null
try {
  storedValidity = BigInt(storedState.uidvalidity)  // UNSAFE: throws on non-numeric string
} catch {
  // Corrupted state file — treat as uidvalidity change
  if (storedState.messages.length > 0) {
    // ... delete all messages ...
  }
  storedState = null
}
if (storedState && storedValidity !== null && storedValidity !== serverValidity) {
  // ... re-sync ...
}
```

**Fix (D-20):** Replace BigInt() conversion with string comparison:
```typescript
// FIXED: string comparison — no unsafe BigInt conversion
const storedValidityStr = storedState.uidvalidity  // Already a string in JSON
const serverValidityStr = serverValidity.toString()  // Convert bigint to string once
if (storedState && storedValidityStr !== serverValidityStr) {
  // uidvalidity changed: invalidate all local state
  if (storedState.messages.length > 0) {
    for (const msg of storedState.messages) {
      const safeId = sanitizeMessageId(msg['message-id'])
      const msgPath = path.join(repoPath, 'messages', `${safeId}.eml`)
      await fs.unlink(msgPath).catch(() => {})
    }
    removed += storedState.messages.length
  }
  storedState = null
}
```

**Rationale:** The `uidvalidity` field is stored as a string in the FolderState JSON schema (line 361: `uidvalidity: serverValidity.toString()`). The server's `uidValidity` is a `bigint`. Direct string comparison of both is safe and avoids the unsafe `BigInt()` constructor call. This applies to browse code as well — never construct `BigInt()` from folder JSON.

---

## Shared Patterns

### File System Safety (ARCH-01 inheritance from sync.ts)

**Apply to:** All browse.ts file-I/O operations

Pattern: Always use `.catch(() => {})` for cleanup operations that may not exist:
```typescript
await fs.unlink(msgPath).catch(() => {})  // File may not exist
await fs.rm(worktreePath, { recursive: true, force: true })  // Force remove
```

### Error Messages (Core → CLI boundary)

**Apply to:** All browse.ts and sync.ts core functions

Pattern: Core throws descriptive Error; CLI catches and prints `.message`:
```typescript
// Core:
if (condition) throw new Error('Human-readable message for CLI')

// CLI:
try {
  await coreFunction(...)
} catch (err) {
  console.error((err as Error).message)  // Only message, not stack
  process.exit(1)
}
```

### Account Resolution (New helper for Phase 4)

**Source:** RESEARCH.md section 7, CONTEXT.md D-01, D-02

**Apply to:** All browse commands that have `--account` flag

Pattern lives in `src/core/browse.ts`:
```typescript
export function resolveAccount(config: BackmailConfig, accountName?: string): [string, AccountConfig] {
  if (accountName) {
    const acc = config.accounts[accountName]
    if (!acc) throw new Error(`Unknown account: ${accountName}`)
    return [accountName, acc]
  }
  const names = Object.keys(config.accounts)
  if (names.length === 1) return [names[0], config.accounts[names[0]]]
  throw new Error(
    `Multiple accounts configured. Specify one with --account:\n  ${names.join('\n  ')}`
  )
}
```

CLI usage:
```typescript
const [accountName, accountConfig] = resolveAccount(config, opts.account)
```

### Import conventions (ESM)

**Apply to:** All new core files

All relative imports within src/core/ use `.js` extension (nodenext moduleResolution):
```typescript
import { sanitizeMessageId, folderPathToFilename } from './sync.js'
import type { BackmailConfig } from './config.js'
```

### simple-git Usage

**Apply to:** browse.ts git operations (log, worktree)

For log queries (research section 3):
```typescript
import { simpleGit } from 'simple-git'
const git = simpleGit(repoPath)
const log = await git.log({ maxCount: limit })
const commits = log.all
  .filter(c => /^\d{4}-\d{2}-\d{2}/.test(c.message))
  .map(c => c.message)
```

For worktree operations (no typed API in simple-git 3.x):
```typescript
const git = simpleGit(repoPath)
// Create: git worktree add <path> <commit-ish>
await git.raw(['worktree', 'add', worktreePath, commitRef])
// Remove: git worktree remove --force <path>
await git.raw(['worktree', 'remove', '--force', worktreePath])
```

---

## No Analog Found

None. All patterns extracted from existing codebase.

---

## Metadata

**Analog search scope:** `src/core/` (sync.ts, config.ts, index.ts), `src/cli/` (index.ts)
**Files scanned:** 4
**Pattern extraction date:** 2026-04-22

### Key Insights for Planner

1. **browse.ts is a utility module** — similar to sync.ts in structure (imports, error handling, file I/O). Reuse sanitizeMessageId/folderPathToFilename rather than re-implementing.

2. **Account resolution is NEW** — no existing `resolveAccount()` helper in the codebase, but research section 7 provides the exact pattern. It should live in browse.ts (core layer, handles multiple-account logic).

3. **CR-01 BigInt fix is in sync.ts** — lines 285-301 need refactoring. Replace unsafe `BigInt()` constructor with string comparison. This is independent of browse implementation but must be done in this phase.

4. **CLI subcommands follow a thin-wrapper pattern** — all new browse commands (`accounts`, `log`, `checkout`, `ls`, `view`) follow the sync command structure: option parsing → core function call → formatted output → error exit.

5. **MIME parsing library not yet installed** — research recommends `mailparser`. Phase 4 planning should include adding `npm install mailparser @types/mailparser` to package.json updates.
