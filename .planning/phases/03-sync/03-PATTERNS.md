# Phase 3: Sync - Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 5 (3 new, 2 modified)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/core/sync.ts` | service | file-I/O + event-driven | `src/core/config.ts` | role-match (same core layer, same ARCH-01 constraints) |
| `src/core/index.ts` | config / boundary | request-response | `src/core/index.ts` (self — add exports) | exact |
| `src/cli/index.ts` | controller / CLI | request-response | `src/cli/index.ts` (self — add subcommand) | exact |
| `tests/unit/sync.test.ts` | test | CRUD + transform | `tests/unit/config.test.ts` | exact (same test framework, same describe/it/mock pattern) |
| `tests/integration/sync.test.ts` | test | event-driven + file-I/O | `tests/integration/imap-connect.test.ts` | role-match (same framework; different assertion style) |

---

## Pattern Assignments

### `src/core/sync.ts` (service, file-I/O + event-driven)

**Analog:** `src/core/config.ts`

**Imports pattern** (`src/core/config.ts` lines 1-8):
```typescript
// ARCH-01 header comment at top — mandatory for every core file
// src/core/sync.ts — SYNC-01 through SYNC-06
// ARCH-01: no exit calls, no console.*, no CLI imports
import fs from 'node:fs/promises'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import { simpleGit } from 'simple-git'
import type { AccountConfig } from './index.js'
import { getPassword } from './config.js'
```

Note: all relative imports within `src/core/` use `.js` extension (nodenext moduleResolution). `imapflow` is a CJS package imported via ESM default-compatible named export. `simple-git` v3 uses named export `{ simpleGit }`, not default import.

**Core async pattern** (`src/core/config.ts` lines 60-91 — `loadConfig` as structural model):
```typescript
// Core functions throw errors; they never call console.* or process.exit().
// Errors bubble to the CLI layer which decides how to print and exit.
export async function syncAccount(
  accountName: string,
  config: AccountConfig,
  opts: SyncOptions
): Promise<SyncResult> {
  // 1. Lazy credential fetch (same pattern as getPassword call site)
  const password = await getPassword(accountName)

  // 2. Ensure repo exists (D-04)
  const repoInitialized = await ensureRepo(config.repoPath)

  // 3. Open single IMAP connection per account (one connection, iterate folders)
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: { user: config.username, pass: password },
    logger: false,   // suppress pino stdout pollution (Pitfall 8)
  })

  let added = 0
  let removed = 0
  let partial = false
  const folderResults: FolderSyncResult[] = []

  try {
    await client.connect()
    // ... iterate folders, call syncFolder(), accumulate counts
  } catch (err) {
    partial = added > 0   // D-09: partial commit only if something was written
    if (!partial) throw err
  } finally {
    await client.logout().catch(() => {})
  }

  // Commit (or skip if nothing changed)
  await commitDelta(config.repoPath, added, removed, partial)

  return { added, removed, partial, repoInitialized, folderResults }
}
```

**Error handling pattern** (`src/core/config.ts` lines 65-74 — try/catch with typed error):
```typescript
// Rethrow with improved message when cause is identifiable; otherwise rethrow raw.
// Never swallow errors silently (except .catch(() => {}) on best-effort cleanup).
try {
  raw = fs.readFileSync(resolvedPath, 'utf-8')
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new Error(`No config found at ${resolvedPath}. ...`)
  }
  throw err
}
```

Apply same pattern to: IMAP connect failures, disk write failures, git commit failures.

**No-console / no-exit constraint** — enforced at compile-time by `tests/unit/cli-boundary.test.ts`. The new `src/core/sync.ts` must also pass these checks. Boundary test reads source text and asserts absence of `console.(log|error|warn|info|debug)` and `process.exit`.

---

### `src/core/index.ts` (boundary file — add sync exports)

**Analog:** `src/core/index.ts` itself (lines 1-30).

**Existing re-export pattern** (`src/core/index.ts` lines 27-29):
```typescript
// Phase 2: Config module public API
export type { BackmailConfig } from './config.js'
export { getConfigPath, loadConfig, getPassword } from './config.js'
```

**Pattern to follow for Phase 3 additions:**
```typescript
// Phase 3: Sync module public API
export type { SyncResult, SyncOptions, FolderSyncResult } from './sync.js'
export { syncAccount } from './sync.js'
```

**Header comment block** (`src/core/index.ts` lines 1-9):
```typescript
// src/core/index.ts — ARCH-01: public API boundary
// This file is the eimerjs IPC boundary: must be importable without CLI context.
// RULES:
//   - No circular imports into the CLI layer
//   - No process exit calls
//   - No console log/error calls
//   - No readline or interactive I/O
// All relative imports within src/core/ must use .js extension (nodenext moduleResolution).
```

The Phase 3 additions preserve all existing content and append to the bottom following the "Phase N:" comment convention.

---

### `src/cli/index.ts` (CLI controller — add sync subcommand)

**Analog:** `src/cli/index.ts` itself (lines 1-44 — full file).

**Existing Commander setup pattern** (`src/cli/index.ts` lines 8-23):
```typescript
import { Command } from 'commander'
import { loadConfig } from '../core/index.js'

const program = new Command()

program
  .name('backmail')
  .description('Mirror IMAP mailboxes to git')
  .version('0.1.0')

// Short-circuit for help/version flags — these must work without a config file
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  program.parse(process.argv)
  process.exit(0)
}
```

**Core error handling wrapper** (`src/cli/index.ts` lines 28-36):
```typescript
// Core threw — print to stderr and exit 1
// Do NOT log the full stack trace — only the error message
try {
  config = loadConfig()
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}
```

**Subcommand pattern to follow for `sync`:**
```typescript
// Phase 3: sync subcommand
import { syncAccount } from '../core/index.js'

program
  .command('sync [account]')
  .description('Sync IMAP mailbox(es) to git')
  .option('--all', 'sync all configured accounts')
  .option('--exclude-folder <name>', 'skip this folder (repeatable)', collectRepeatable, [])
  .option('--only-folder <name>', 'restrict to this folder (repeatable)', collectRepeatable, [])
  .option('--verbose', 'log one line per folder and per message')
  .action(async (account: string | undefined, opts) => {
    // Validate mutual exclusion of --exclude-folder and --only-folder (D-02)
    if (opts.excludeFolder.length > 0 && opts.onlyFolder.length > 0) {
      console.error('Error: --exclude-folder and --only-folder are mutually exclusive')
      process.exit(1)
    }

    // Determine which accounts to sync
    const accountNames = opts.all
      ? Object.keys(config.accounts)
      : account
        ? [account]
        : (console.error('Specify an account name or use --all'), process.exit(1) as never)

    // Run sync per account; print summary or error per D-05
    for (const name of accountNames) {
      try {
        const result = await syncAccount(name, config.accounts[name], {
          excludeFolders: opts.excludeFolder,
          onlyFolders: opts.onlyFolder,
          verbose: opts.verbose ?? false,
        })
        if (result.repoInitialized) {
          console.log(`Initialized git repo at ${config.accounts[name].repoPath}`)
        }
        console.log(`${name}: +${result.added} added / -${result.removed} removed`)
      } catch (err) {
        console.error(`${name}: ${(err as Error).message}`)
        process.exit(1)
      }
    }
  })
```

Key CLI rules (from `src/cli/index.ts` lines 1-6 comment block):
- `process.exit()` and `console.*` are allowed only in the CLI layer
- All business logic lives in `src/core/` — CLI is a thin wrapper
- Import from `../core/index.js` only (not directly from `../core/sync.js`)

---

### `tests/unit/sync.test.ts` (unit test, CRUD + transform)

**Analog:** `tests/unit/config.test.ts` (lines 1-300 — full file).

**Imports + mock declaration pattern** (`tests/unit/config.test.ts` lines 1-24):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// Subject under test — .js extension required (nodenext ESM)
import { syncAccount } from '../../src/core/sync.js'

// vi.mock is hoisted by Vitest — place at top of file
vi.mock('imapflow', () => { /* ... */ })
vi.mock('simple-git', () => { /* ... */ })
```

**describe/it structure with tmp dir lifecycle** (`tests/unit/config.test.ts` lines 76-119):
```typescript
describe('descriptive group name matching requirement ID', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('specific behavior being tested', () => {
    // Arrange
    // Act
    // Assert
    expect(result).toBe(expected)
  })
})
```

**Async test pattern** (`tests/unit/config.test.ts` lines 233-237):
```typescript
it('returns keyring value when available', async () => {
  const result = await getPassword('gmail')
  expect(result).toBe('secret123')
})
```

**vi.mock with constructor** (`tests/unit/config.test.ts` lines 14-24):
```typescript
vi.mock('@napi-rs/keyring', () => {
  const mockGetPassword = vi.fn()
  // Use regular function (not arrow) so `new Entry()` works — Reflect.construct requirement
  return {
    Entry: vi.fn().mockImplementation(function () {
      return { getPassword: mockGetPassword }
    }),
    _mockGetPassword: mockGetPassword,
  }
})
```

Apply this same pattern when mocking `ImapFlow` constructor in `sync.test.ts`:
```typescript
vi.mock('imapflow', () => {
  const mockFetch = vi.fn()
  const mockSearch = vi.fn()
  // ... etc.
  return {
    ImapFlow: vi.fn().mockImplementation(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: mockList,
        getMailboxLock: mockGetMailboxLock,
        fetch: mockFetch,
        search: mockSearch,
        mailbox: { uidValidity: 1n, uidNext: 2 },
      }
    }),
  }
})
```

**Test timeout** — unit config sets `testTimeout: 10_000` globally (`vitest.config.ts` line 4); no per-test override needed unless testing partial failure simulation.

---

### `tests/integration/sync.test.ts` (integration test, event-driven + file-I/O)

**Analog:** `tests/integration/imap-connect.test.ts` (lines 1-33 — full file).

**Integration test file structure** (`tests/integration/imap-connect.test.ts` lines 1-7):
```typescript
import { describe, it, expect } from 'vitest'
import * as net from 'node:net'

// Allow override via env vars for CI environments that map ports differently
const IMAP_HOST = process.env.IMAP_HOST ?? 'localhost'
const IMAP_PORT = Number(process.env.IMAP_PORT ?? '143')
```

Apply the same env-var override pattern to `sync.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ImapFlow } from 'imapflow'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { syncAccount } from '../../src/core/sync.js'

const IMAP_HOST = process.env.IMAP_HOST ?? 'localhost'
const IMAP_PORT = Number(process.env.IMAP_PORT ?? '143')
const IMAP_USER = process.env.IMAP_USER ?? 'testuser'
const IMAP_PASS = process.env.IMAP_PASS ?? 'testpass'
```

**beforeAll / afterAll with IMAP APPEND for fixture seeding** (RESEARCH.md Open Question 3):
```typescript
// Use imapflow itself to APPEND fixture .eml files into Dovecot before tests run.
// This is the pattern imapflow's own tests use — avoids Docker volume complexity.
let tmpRepo: string

beforeAll(async () => {
  tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-integration-'))

  // Seed Dovecot with fixtures via APPEND
  const seeder = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, ... })
  await seeder.connect()
  const lock = await seeder.getMailboxLock('INBOX')
  try {
    const eml = await fs.readFile('./tests/fixtures/fixture-001.eml')
    await seeder.append('INBOX', eml)
  } finally {
    lock.release()
  }
  await seeder.logout()
})

afterAll(async () => {
  await fs.rm(tmpRepo, { recursive: true, force: true })
})
```

**Integration timeout** — `vitest.integration.config.ts` sets `testTimeout: 120_000` and `hookTimeout: 30_000` globally; no per-test override needed.

---

## Shared Patterns

### ARCH-01: No console.* / No process.exit() in Core
**Source:** `src/core/config.ts` (entire file); enforced by `tests/unit/cli-boundary.test.ts` lines 8-82
**Apply to:** `src/core/sync.ts`
```typescript
// cli-boundary.test.ts asserts these patterns are absent from core files:
expect(coreSource).not.toMatch(/process\.exit/)
expect(coreSource).not.toMatch(/console\.(log|error|warn|info|debug)/)
expect(coreSource).not.toMatch(/from ['"]\.\.\/cli\//)
```
The boundary test already covers `src/core/index.ts` and `src/core/config.ts`. Phase 3 should add matching assertions for `src/core/sync.ts` in the same test file.

### ESM .js Extension on Relative Imports
**Source:** `src/core/config.ts` line 7 (`import { Entry } from '@napi-rs/keyring'`), `src/core/index.ts` lines 28-29
**Apply to:** All new and modified source files
```typescript
// Correct — .js extension on all relative imports in src/core/
import type { AccountConfig } from './index.js'
import { getPassword } from './config.js'
export { syncAccount } from './sync.js'

// Correct — no extension needed for npm packages
import { ImapFlow } from 'imapflow'
import { simpleGit } from 'simple-git'
import fs from 'node:fs/promises'
```

### Error Throw Pattern (Core)
**Source:** `src/core/config.ts` lines 65-91
**Apply to:** `src/core/sync.ts`
```typescript
// Typed error narrowing before re-throw with helpful message
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new Error(`Helpful message: ${resolvedPath}`)
  }
  throw err
}
// Best-effort cleanup: .catch(() => {}) is acceptable on logout/lock.release()
await client.logout().catch(() => {})
```

### CLI Error Handler
**Source:** `src/cli/index.ts` lines 28-36
**Apply to:** The new `sync` subcommand's `.action()` handler
```typescript
try {
  // call core function
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}
```

### Tmp Dir Test Lifecycle
**Source:** `tests/unit/config.test.ts` lines 88-100
**Apply to:** `tests/unit/sync.test.ts` for any test that writes to the filesystem (D-04 auto-init test, partial commit test)
```typescript
let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
```

### vi.mock Constructor Pattern
**Source:** `tests/unit/config.test.ts` lines 14-24
**Apply to:** `tests/unit/sync.test.ts` when mocking `ImapFlow` class
```typescript
// Use regular function (not arrow) — arrow functions cannot be used as constructors
vi.fn().mockImplementation(function () {
  return { /* mock instance */ }
})
```

### Vitest Config Includes
**Source:** `vitest.config.ts` line 3, `vitest.integration.config.ts` line 3
```typescript
// Unit tests: 'tests/unit/**/*.test.ts' — new sync.test.ts is auto-included
// Integration tests: 'tests/integration/**/*.test.ts' — new sync.test.ts is auto-included
// No config changes needed — file placement is sufficient
```

---

## No Analog Found

All files have close analogs in the codebase. No files require fallback to RESEARCH.md patterns only.

| File | Note |
|------|------|
| `src/core/sync.ts` | No existing async service module in core yet — `config.ts` is the closest structural analog, but `sync.ts` will be significantly larger and async throughout. RESEARCH.md patterns for imapflow and simple-git are authoritative for the new library usage. |

---

## Metadata

**Analog search scope:** `src/core/`, `src/cli/`, `tests/unit/`, `tests/integration/`
**Files scanned:** 8 (config.ts, core/index.ts, cli/index.ts, config.test.ts, core-api-boundary.test.ts, cli-boundary.test.ts, fixtures.test.ts, imap-connect.test.ts)
**Pattern extraction date:** 2026-04-21
