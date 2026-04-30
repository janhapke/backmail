# Phase 07: Repository Discovery - Pattern Map

**Mapped:** 2026-04-29
**Files analyzed:** 4
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/core/discovery.ts` | utility (pure function) | transform (fs walk) | `src/core/sync.ts` (fs operations) | role-match |
| `src/cli/index.ts` | CLI router + command handlers | request-response | `src/cli/index.ts` (existing) | exact |
| `src/core/index.ts` | module exports | N/A | `src/core/index.ts` (existing) | exact |
| `tests/unit/discovery.test.ts` | unit test | N/A | `tests/unit/config.test.ts` (unit test pattern) | exact |

## Pattern Assignments

### `src/core/discovery.ts` (utility, transform — fs walk)

**Analog:** `src/core/sync.ts` (filesystem operations, error handling)

**Module structure and imports** (lines 1-12 of sync.ts):
```typescript
// src/core/sync.ts — SYNC-01 through SYNC-05
// ARCH-01: no exit calls, no console.*, no CLI imports
import fs from 'node:fs/promises'
import path from 'node:path'

// For discovery.ts, use fs (not fs/promises since walk is sync):
import fs from 'node:fs'
import path from 'node:path'
```

**Header comment pattern** (from sync.ts and config.ts):
```typescript
// src/core/discovery.ts — DISC-01, DISC-02, DISC-03
// ARCH-01: no exit calls, no console.*, no CLI imports
// Walk up filesystem to find .backmail/ directory marker
```

**Helper function pattern** (lines 60-85 of sync.ts — sanitization helpers):
```typescript
// Exported public function with JSDoc, pure (no side effects)
export function sanitizeMessageId(messageId: string): string {
  let result = messageId
  // ... transformations ...
  return result
}

// Apply to findRepository:
/**
 * Walk up from startDir looking for .backmail/ directory.
 * Returns the repository root path (containing .backmail/) or null if not found.
 * Stops at filesystem root. Pure function — no side effects.
 */
export function findRepository(startDir: string): string | null {
  // ... walk implementation ...
  return repoRoot ?? null
}
```

**Error handling pattern** (from config.ts, lines 31-54):
```typescript
// Synchronous file operations with explicit error checking:
export function loadRepositoryConfig(repoRoot: string): RepositoryConfig {
  const configPath = path.join(repoRoot, '.backmail', 'config.json')
  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`No config found at ${configPath}...`)
    }
    throw err
  }
  // ...
}

// For discovery.ts, use sync fs.existsSync without try/catch:
export function findRepository(startDir: string): string | null {
  let current = path.resolve(startDir)
  const root = path.parse(current).root
  
  while (true) {
    if (fs.existsSync(path.join(current, '.backmail'))) {
      return current
    }
    if (current === root) {
      return null
    }
    current = path.dirname(current)
  }
}
```

**Type exports** (from config.ts and browse.ts):
- For discovery.ts: no types to export (return type is `string | null`)
- Add to `src/core/index.ts` re-exports (follows pattern of other exports)

---

### `src/cli/index.ts` (CLI router, request-response)

**Analog:** `src/cli/index.ts` (existing file — MODIFY)

**Global option pattern** (commander — add to program setup):

At top of file, after `program.version(...)`, add:
```typescript
program
  .name('backmail')
  .description('Mirror IMAP mailboxes to git')
  .version('0.1.0')
  .option('--workdir <path>', 'path to backmail repository (default: auto-detect from CWD)')
```

**Helper function replacement pattern** (lines 18-28):

Old (to be replaced):
```typescript
// Helper to load config with error handling
function getConfig() {
  try {
    return loadConfig()
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}
```

New:
```typescript
// Helper to find repository root and load config
function getRepoRoot(): string {
  try {
    // Import findRepository from core (add to imports)
    const opts = program.opts()
    const startDir = opts.workdir ? path.resolve(opts.workdir) : process.cwd()
    const repoRoot = findRepository(startDir)
    if (!repoRoot) {
      throw new Error(
        'Error: Not inside a backmail repository.\n' +
        'Use `backmail init` to create one, or `--workdir <path>` to specify a path.'
      )
    }
    return repoRoot
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}

// Helper to load repository config using discovered root
function getConfig(): RepositoryConfig {
  try {
    const repoRoot = getRepoRoot()
    return loadRepositoryConfig(repoRoot)
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}
```

**Command action error handling pattern** (lines 55-113, 133-145):

Pattern already exists in sync command and other commands — wrap action handler body in try/catch, call `getRepoRoot()` or `getConfig()` to trigger discovery, catch errors and exit(1). No changes needed.

**Required imports to add**:
```typescript
import path from 'node:path'
import { loadRepositoryConfig, findRepository } from '../core/index.js'
```

Remove old import:
```typescript
// DELETE: import { loadConfig } from '../core/index.js'
```

---

### `src/core/index.ts` (module exports)

**Analog:** `src/core/index.ts` (existing file — MODIFY)

**Re-export pattern** (lines 19-40):

Add to the phase 7 section (after Phase 6 exports, before Phase 3):
```typescript
// Phase 7: Repository discovery public API
export { findRepository } from './discovery.js'
```

Example of full context (lines 19-25 with Phase 7 insertion):
```typescript
// Phase 6: Repository config public API (replaces Phase 2 config exports)
export type { RepositoryConfig, PasswordRef } from './config.js'
export { loadRepositoryConfig, parsePasswordRef, getPasswordByRef } from './config.js'

// Phase 7: Repository discovery public API
export { findRepository } from './discovery.js'

// Phase 3: Sync module public API
export type { SyncResult, SyncOptions, FolderSyncResult } from './sync.js'
export { syncAccount } from './sync.js'
```

---

### `tests/unit/discovery.test.ts` (unit test, N/A)

**Analog:** `tests/unit/config.test.ts` (unit test pattern)

**Test framework and structure** (lines 1-34 of config.test.ts):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { findRepository } from '../../src/core/discovery.js'

describe('findRepository', () => {
  let tmpDir: string
  let backmailDir: string

  beforeEach(() => {
    // Create temp directory with optional .backmail marker
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-test-'))
  })
  
  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // Test cases follow pattern from config.test.ts lines 35+
  it('returns repoRoot when .backmail/ exists in startDir', () => {
    const backmailDir = path.join(tmpDir, '.backmail')
    fs.mkdirSync(backmailDir)
    const result = findRepository(tmpDir)
    expect(result).toBe(tmpDir)
  })

  it('returns null when .backmail/ not found (walk stops at root)', () => {
    const result = findRepository(tmpDir)
    expect(result).toBeNull()
  })

  it('finds .backmail/ in parent directory', () => {
    const backmailDir = path.join(tmpDir, '.backmail')
    fs.mkdirSync(backmailDir)
    const childDir = path.join(tmpDir, 'child', 'grandchild')
    fs.mkdirSync(childDir, { recursive: true })
    const result = findRepository(childDir)
    expect(result).toBe(tmpDir)
  })

  it('walks to filesystem root without throwing', () => {
    // tmpDir has no .backmail — walk should reach root and return null
    const result = findRepository(tmpDir)
    expect(result).toBeNull()
  })

  it('walks up through multiple directories', () => {
    const backmailDir = path.join(tmpDir, '.backmail')
    fs.mkdirSync(backmailDir)
    const deepDir = path.join(tmpDir, 'a', 'b', 'c', 'd')
    fs.mkdirSync(deepDir, { recursive: true })
    const result = findRepository(deepDir)
    expect(result).toBe(tmpDir)
  })

  it('prefers closest .backmail/ in walk', () => {
    const outer = path.join(tmpDir, '.backmail')
    fs.mkdirSync(outer)
    const innerDir = path.join(tmpDir, 'inner')
    const inner = path.join(innerDir, '.backmail')
    fs.mkdirSync(innerDir)
    fs.mkdirSync(inner)
    const result = findRepository(innerDir)
    expect(result).toBe(innerDir)
  })
})
```

**Error handling test pattern** (from config.test.ts, though discovery.ts has no errors):
- discovery.ts returns `null` instead of throwing, so no error cases to test
- Test focus: boundary conditions (root directory, nested dirs, nonexistent paths)

**No external mocks needed** — unlike config.test.ts (which mocks `@napi-rs/keyring`), discovery.test.ts uses real temp filesystem operations via `fs.mkdirSync` and `fs.mkdtempSync`.

---

## Shared Patterns

### ARCH-01: Core Module Boundary
**Source:** `src/core/index.ts` header comments + all core modules (config.ts, browse.ts, sync.ts)
**Apply to:** `src/core/discovery.ts`

```typescript
// src/core/discovery.ts — DISC-01, DISC-02, DISC-03
// ARCH-01: public API boundary — must be importable without CLI context.
// RULES:
//   - No circular imports into the CLI layer
//   - No process exit calls
//   - No console log/error calls
//   - No readline or interactive I/O
```

### Import Conventions
**Source:** `src/core/config.ts`, `src/core/sync.ts` (lines 1-12)
**Apply to:** `src/core/discovery.ts`, `src/cli/index.ts`

```typescript
// Use node: prefix for Node.js built-ins (nodenext moduleResolution)
import fs from 'node:fs'
import path from 'node:path'

// Use relative imports with .js extension within src/core/
import { loadRepositoryConfig } from './config.js'

// Import from re-export index in CLI only
import { findRepository, loadRepositoryConfig } from '../core/index.js'
```

### Error Handling in CLI
**Source:** `src/cli/index.ts` lines 18-28, 106-112, 133-145
**Apply to:** Modified CLI command handlers

```typescript
// Wrap config-dependent action logic in try/catch
.action(async (opts: { ... }) => {
  try {
    const config = getConfig()  // Throws on discovery failure
    // ... rest of command logic ...
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
})
```

### Error Message Format
**Source:** `src/core/config.ts` lines 39-43 (exact error messages with context)
**Apply to:** `src/core/discovery.ts` and `src/cli/index.ts`

For discovery:
- Never include debug CWD or absolute paths in error message
- Use concise two-line format per D-06:
  ```
  Error: Not inside a backmail repository.
  Use `backmail init` to create one, or `--workdir <path>` to specify a path.
  ```

## No Analog Found

None — all four files have direct analogs in the existing codebase or are modifications of existing files.

## Metadata

**Analog search scope:** `/home/jan/dev/backmail/src/core/`, `/home/jan/dev/backmail/src/cli/`, `/home/jan/dev/backmail/tests/unit/`
**Files scanned:** 8 (config.ts, browse.ts, sync.ts, index.ts, cli/index.ts, config.test.ts, browse.test.ts, sync.test.ts)
**Pattern extraction date:** 2026-04-29
**Key patterns identified:**
- ARCH-01 boundary rules enforced consistently (no process.*, no console.* in src/core/)
- Unit tests use vitest + temp filesystem fixtures (no mocks for fs operations)
- CLI commands follow try/catch + exit(1) error handling
- Module exports centralized in src/core/index.ts with JSDoc-style comments
- Helper functions in CLI follow pattern: try { core call } catch { console.error + exit }
