# Phase 9: Init Command - Pattern Map

**Mapped:** 2026-04-30
**Files analyzed:** 5
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/core/init.ts` | service | file-I/O + batch | `src/core/sync.ts` | role-match (same pure-core, no I/O pattern; different data flow) |
| `src/core/index.ts` | config | — | `src/core/index.ts` (self) | exact (adding export line) |
| `src/cli/index.ts` | controller | request-response | `src/cli/index.ts` (self) | exact (adding new command block matching restore command shape) |
| `tests/unit/init.test.ts` | test | — | `tests/unit/config.test.ts` | exact (tmpDir fixture + keyring mock pattern) |
| `package.json` | config | — | `package.json` (self) | exact (adding dependency) |

---

## Pattern Assignments

### `src/core/init.ts` (service, file-I/O)

**Analog:** `src/core/sync.ts`

**Imports pattern** (`src/core/sync.ts` lines 1–11):
```typescript
// ARCH-01 comment block at top — required on all core files
// src/core/init.ts — REPO-01 through REPO-04
// ARCH-01: no exit calls, no console.*, no CLI imports
import fs from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import type { RepositoryConfig } from './config.js'
```
Note: `sync.ts` uses `node:fs/promises`; `init.ts` should use sync `node:fs` to match `config.ts` (which uses `fs.readFileSync`). The function is still `async` because `simpleGit().init()` is awaited.

**Core pattern — `ensureRepo` helper as reference for `simpleGit` usage** (`src/core/sync.ts` lines 153–161):
```typescript
export async function ensureRepo(repoPath: string): Promise<boolean> {
  await fs.mkdir(repoPath, { recursive: true })
  const git = simpleGit(repoPath)
  if (await git.checkIsRepo()) {
    return false
  }
  await git.init()
  return true
}
```
For `initRepository`, call `simpleGit(archivePath).init()` directly — no `checkIsRepo` needed since we guard on `.backmail/` presence first.

**Core pattern — function signature style** (`src/core/sync.ts` lines 166–170):
```typescript
export async function syncAccount(
  config: RepositoryConfig,
  repoPath: string,
  opts: SyncOptions,
): Promise<SyncResult> {
```
For `initRepository`, signature is:
```typescript
export async function initRepository(
  targetDir: string,
  config: RepositoryConfig,
  passwordRef: string,
): Promise<void> {
```

**Error handling pattern — throw Error with human-readable message** (`src/core/config.ts` lines 38–43):
```typescript
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `No config found at ${configPath}. Run \`backmail init\` to create a repository.`
      )
    }
    throw err
  }
```
For REPO-04 guard, throw before any writes:
```typescript
if (fs.existsSync(backmailDir)) {
  throw new Error(
    `Repository already exists at ${targetDir}. Remove .backmail/ to reinitialize.`
  )
}
```

**JSON write pattern — how config is serialized** (`src/core/sync.ts` line 355):
```typescript
await fs.writeFile(folderJsonPath, JSON.stringify(updatedState, null, 2))
```
For `initRepository`, use sync equivalent:
```typescript
fs.writeFileSync(
  path.join(backmailDir, 'config.json'),
  JSON.stringify({ ...config, passwordRef }, null, 2)
)
```

**Directory creation pattern** (`src/core/sync.ts` lines 183–184):
```typescript
await fs.mkdir(path.join(repoPath, 'messages'), { recursive: true })
await fs.mkdir(path.join(repoPath, 'folders'), { recursive: true })
```
For `initRepository`, use sync `fs.mkdirSync` with `{ recursive: true }` for `archive/`, `worktrees/`, and `.backmail/`.

**Safe sequencing (from RESEARCH.md Pitfall 3):** Create `archive/` and `worktrees/` first, call `simpleGit(archivePath).init()`, then create `.backmail/` and write files last. This ensures re-runnability if `git init` fails.

---

### `src/core/index.ts` (config — add export)

**Analog:** `src/core/index.ts` (self)

**Export line pattern** (`src/core/index.ts` lines 26–28, 38–42):
```typescript
// Phase 5: Restore module public API
export type { RestoreResult, RestoreOptions } from './restore.js'
export { restoreAccount } from './restore.js'
```
For Phase 9, add after the restore block:
```typescript
// Phase 9: Init module public API
export { initRepository } from './init.js'
```
No types to export — `initRepository` returns `Promise<void>` and takes `RepositoryConfig` (already exported) and primitives.

Note: All relative imports use `.js` extension (`nodenext` module resolution — `src/core/index.ts` lines 21–42 throughout).

---

### `src/cli/index.ts` (controller — add init command)

**Analog:** `src/cli/index.ts` restore command block (lines 188–246) — closest shape match because it has optional positional arg + multiple options + try/catch action handler.

**Top-level imports to add** (`src/cli/index.ts` lines 8–11):
```typescript
import { Command } from 'commander'
import path from 'node:path'
import { loadRepositoryConfig, findRepository } from '../core/index.js'
import type { RepositoryConfig } from '../core/index.js'
```
Add to existing import block:
```typescript
import { input, confirm, password as promptPassword } from '@inquirer/prompts'
import { Entry } from '@napi-rs/keyring'
import { initRepository } from '../core/index.js'
```
Note: rename `password` to `promptPassword` to avoid shadowing the `opts.password` variable in the action handler.

**Command registration pattern** (`src/cli/index.ts` lines 188–195):
```typescript
program
  .command('restore [date|commit]')
  .description('Restore messages from backup to target IMAP server')
  .requiredOption('--to <imap-url>', 'target IMAP URL (imap:// or imaps://)')
  .option('--skip-duplicates <yes|no>', 'check for duplicates (default: yes)', 'yes')
  .option('--dry-run', 'output without writing to target server', false)
  .option('--verbose', 'log one line per message', false)
  .action(async (dateOrCommit: string | undefined, opts: {
    to: string
    skipDuplicates: string
    dryRun?: boolean
    verbose?: boolean
  }) => {
```
For `init`, the positional arg is `[path]` (optional, defaults to CWD). Boolean flag pair `--tls` / `--no-tls` uses Commander's built-in negation.

**Error handling pattern — catch + exit** (`src/cli/index.ts` lines 97–100):
```typescript
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
```
Same pattern for init. For keyring write failure, add the `--password-ref env:BACKMAIL_PASSWORD` hint (D-05).

**`getRepoRoot()` helper as reference for `resolveInitTarget`** (`src/cli/index.ts` lines 22–35):
```typescript
function getRepoRoot(): string {
  const opts = program.opts() as { workdir?: string }
  const startDir = opts.workdir ? path.resolve(opts.workdir) : process.cwd()
  const repoRoot = findRepository(startDir)
  if (!repoRoot) {
    console.error(
      'Error: Not inside a backmail repository.\n' +
      'Use `backmail init` to create one, or `--workdir <path>` to specify a path.'
    )
    process.exit(1)
  }
  return repoRoot
}
```
For `init`, there is no equivalent helper — just inline: `const targetDir = dirPath ? path.resolve(dirPath) : process.cwd()`.

**getErrorMessage / sanitizeErrorMessage helpers** (`src/cli/index.ts` lines 40–49):
```typescript
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}
```
Reuse `getErrorMessage` in the init catch block rather than casting `(err as Error).message` directly, for consistency with restore command.

**Non-TTY detection pattern** — not yet in codebase; use from RESEARCH.md Pattern 2:
```typescript
const isTTY = process.stdin.isTTY !== false
```

---

### `tests/unit/init.test.ts` (test)

**Analog:** `tests/unit/config.test.ts` — exact match for tmpDir fixture setup and `@napi-rs/keyring` mock structure.

**Test file header + imports** (`tests/unit/config.test.ts` lines 1–5):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { loadRepositoryConfig, parsePasswordRef, getPasswordByRef } from '../../src/core/config.js'
```
For `init.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { initRepository } from '../../src/core/init.js'
```

**`@napi-rs/keyring` mock** (`tests/unit/config.test.ts` lines 7–15):
```typescript
vi.mock('@napi-rs/keyring', () => {
  const mockGetPassword = vi.fn()
  return {
    Entry: vi.fn().mockImplementation(function () {
      return { getPassword: mockGetPassword }
    }),
    _mockGetPassword: mockGetPassword,
  }
})
```
For `init.test.ts`, extend mock to include `setPassword` (RESEARCH.md Pitfall 2):
```typescript
vi.mock('@napi-rs/keyring', () => {
  const mockSetPassword = vi.fn()
  const mockGetPassword = vi.fn()
  return {
    Entry: vi.fn().mockImplementation(function () {
      return { getPassword: mockGetPassword, setPassword: mockSetPassword }
    }),
    _mockSetPassword: mockSetPassword,
    _mockGetPassword: mockGetPassword,
  }
})
```

**`simple-git` mock** (`tests/unit/sync.test.ts` lines 30–38):
```typescript
vi.mock('simple-git', () => ({
  simpleGit: vi.fn().mockImplementation(() => ({
    checkIsRepo: vi.fn().mockResolvedValue(true),
    init: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({}),
    status: vi.fn().mockResolvedValue({ isClean: () => true }),
  })),
}))
```
For `init.test.ts`, only `init` is called:
```typescript
vi.mock('simple-git', () => ({
  simpleGit: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
}))
```

**tmpDir fixture pattern** (`tests/unit/config.test.ts` lines 23–31):
```typescript
let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-test-'))
  const backmailDir = path.join(tmpDir, '.backmail')
  fs.mkdirSync(backmailDir)
  tmpConfigPath = path.join(backmailDir, 'config.json')
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
```
For `init.test.ts`, the tmpDir starts empty (no `.backmail/`) — init creates it:
```typescript
let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-init-test-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
```

---

### `tests/unit/cli-boundary.test.ts` (test — extend existing)

**Analog:** `tests/unit/cli-boundary.test.ts` (self) — extend by adding a new `describe` block following the established pattern.

**Existing boundary check pattern** (`tests/unit/cli-boundary.test.ts` lines 84–118):
```typescript
describe('ARCH-01: src/core/sync.ts module boundary enforcement', () => {
  it('src/core/sync.ts does not import from src/cli/', () => {
    const syncSource = readFileSync(
      resolve(__dirname, '../../src/core/sync.ts'),
      'utf-8'
    )
    expect(syncSource).not.toMatch(/from ['"]\.\.\/cli\//)
    expect(syncSource).not.toMatch(/from ['"].*\/cli\//)
    expect(syncSource).not.toMatch(/require\(.*cli/)
  })

  it('src/core/sync.ts does not call process.exit()', () => {
    const syncSource = readFileSync(resolve(__dirname, '../../src/core/sync.ts'), 'utf-8')
    expect(syncSource).not.toMatch(/process\.exit/)
  })

  it('src/core/sync.ts does not call console methods', () => {
    const syncSource = readFileSync(resolve(__dirname, '../../src/core/sync.ts'), 'utf-8')
    expect(syncSource).not.toMatch(/console\.(log|error|warn|info|debug)/)
  })
})
```
For `init.ts`, copy this describe block verbatim, replacing `sync` with `init`.

---

## Shared Patterns

### ARCH-01 Header Comment
**Source:** `src/core/sync.ts` lines 1–5, `src/core/restore.ts` lines 1–4
**Apply to:** `src/core/init.ts`
```typescript
// src/core/init.ts — REPO-01 through REPO-04
// ARCH-01: no exit calls, no console.*, no CLI imports
```

### Error Throw Pattern (core modules)
**Source:** `src/core/config.ts` lines 38–44
**Apply to:** `src/core/init.ts`
- Throw `new Error(...)` with human-readable message including the path
- Never call `process.exit()` or `console.*` in core
- Caller (CLI) catches and calls `console.error(err.message)` + `process.exit(1)`

### CLI catch/exit Pattern
**Source:** `src/cli/index.ts` lines 97–100 (sync), 241–245 (restore)
**Apply to:** init command block in `src/cli/index.ts`
```typescript
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
```

### `.js` Extension on Relative Imports
**Source:** `src/core/index.ts` lines 21–42, `src/core/sync.ts` line 10–11
**Apply to:** `src/core/init.ts`, `src/core/index.ts` export line, `src/cli/index.ts` import
All relative imports within `src/` end with `.js` — TypeScript `nodenext` module resolution requirement.

### `RepositoryConfig` Type Import
**Source:** `src/core/sync.ts` line 10, `src/core/restore.ts` line 8
**Apply to:** `src/core/init.ts`
```typescript
import type { RepositoryConfig } from './config.js'
```
`RepositoryConfig` is a Zod-inferred type: `{ host, port, username, tls, passwordRef }`. The `passwordRef` field in `RepositoryConfig` is used for runtime credential lookup — but `initRepository` receives `passwordRef` as a separate argument and writes both `config` and `passwordRef` into the JSON together. The stored config.json will include `passwordRef` in the object.

### `path.join(repoRoot, 'archive')` Convention
**Source:** `src/cli/index.ts` lines 70, 112, 131, 148 — `archivePath` pattern throughout CLI
**Apply to:** `src/core/init.ts` (uses `targetDir` as root, not `repoRoot`, since it's creating the repo)
```typescript
const archivePath = path.join(targetDir, 'archive')
```

---

## No Analog Found

All files have close analogs in the codebase. No entries in this section.

---

## Metadata

**Analog search scope:** `src/core/`, `src/cli/`, `tests/unit/`
**Files scanned:** 9 (sync.ts, restore.ts, config.ts, index.ts, cli/index.ts, config.test.ts, sync.test.ts, cli-boundary.test.ts, core-api-boundary.test.ts)
**Pattern extraction date:** 2026-04-30
