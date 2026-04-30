# Phase 6: Credential Infrastructure - Pattern Map

**Mapped:** 2026-04-29
**Files analyzed:** 4 (2 modified, 1 new source, 1 new test)
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/config.ts` | service | request-response | `src/core/config.ts` (existing) | exact — same file, replacing content |
| `src/core/index.ts` | module boundary / exports | request-response | `src/core/index.ts` (existing) | exact — same file, updating exports |
| `tests/unit/config.test.ts` | test | request-response | `tests/unit/config.test.ts` (existing) | exact — same file, replacing/extending |
| `tests/unit/core-api-boundary.test.ts` | test | static analysis | `tests/unit/core-api-boundary.test.ts` (existing) | exact — same file, updating type assertions |

---

## Pattern Assignments

### `src/core/config.ts` (service, request-response)

**Analog:** `src/core/config.ts` — this file is gutted and replaced; its patterns are the direct template.

**Imports pattern** (lines 1–8):
```typescript
// src/core/config.ts — CRED-01, CRED-02, CRED-03
// ARCH-01: no exit calls, no console.*, no CLI imports
import * as z from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { Entry } from '@napi-rs/keyring'
```
Note: `os` and `path` imports for old config dir logic are removed. `fs` stays for `loadRepositoryConfig`. Only `z`, `fs`, `path`, `Entry` are needed.

**Zod schema pattern** (lines 11–24, existing `AccountConfigSchema`):
```typescript
const RepositoryConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  tls: z.boolean(),
  passwordRef: z.string().min(1),
})

export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>
```
Copy the existing field definitions exactly; swap `repoPath` for `passwordRef`.

**File-read + Zod parse pattern** (lines 60–91, `loadConfig`):
```typescript
export function loadRepositoryConfig(repoRoot: string): RepositoryConfig {
  const configPath = path.join(repoRoot, '.backmail', 'config.json')

  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `No config found at ${configPath}. Run \`backmail init\` to create a repository.`
      )
    }
    throw err
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Config file at ${configPath} is not valid JSON.`)
  }

  return RepositoryConfigSchema.parse(parsed) as RepositoryConfig
}
```
This is a direct port of `loadConfig()` stripped of multi-account and repoPath logic. The two-try-catch structure (ENOENT check + JSON parse) is the established pattern.

**Keyring async/sync pattern** (lines 95–124, `getPassword`):
```typescript
// This is the EXACT pattern to copy into getPasswordByRef() for the keyring branch:
const entry = new Entry(service, account)
const result = entry.getPassword()

// Check if result is a Promise
if (result && typeof (result as any).then === 'function') {
  resolvedPassword = await (result as unknown as Promise<string>)
} else if (typeof result === 'string') {
  resolvedPassword = result
}
// If result is null or undefined, resolvedPassword stays null
```
This Promise-vs-sync detection block (lines 103–108) MUST be copied verbatim into `getPasswordByRef()` — it handles @napi-rs/keyring's inconsistent return type across platforms.

**passwordRef parser — new code, no existing analog:**
```typescript
export interface PasswordRef {
  type: 'keyring' | 'env'
  service?: string
  account?: string
  envVar?: string
}

export function parsePasswordRef(ref: string): PasswordRef {
  if (ref.startsWith('keyring:')) {
    const params = new URLSearchParams(ref.slice(8).replace(/;/g, '&'))
    const service = params.get('service')
    const account = params.get('account')
    if (!service || !account) {
      throw new Error(
        `Malformed keyring passwordRef "${ref}": must include service= and account= keys.`
      )
    }
    return { type: 'keyring', service, account }
  } else if (ref.startsWith('env:')) {
    const envVar = ref.slice(4)
    if (!envVar) {
      throw new Error(`Malformed env passwordRef "${ref}": variable name must follow "env:".`)
    }
    return { type: 'env', envVar }
  }
  const scheme = ref.split(':')[0]
  throw new Error(
    `Unsupported passwordRef scheme "${scheme}" in "${ref}". Use "keyring:" or "env:".`
  )
}
```
Key note: `keyring:` params use semicolons as separators (not `&`). `URLSearchParams` expects `&`. Replace before parsing. This is a D-05 strict-parse requirement.

**getPasswordByRef — full function with BACKMAIL_PASSWORD fallback:**
```typescript
export async function getPasswordByRef(passwordRef: string): Promise<string> {
  const parsed = parsePasswordRef(passwordRef)
  let resolvedPassword: string | null = null

  if (parsed.type === 'keyring') {
    try {
      const entry = new Entry(parsed.service!, parsed.account!)
      const result = entry.getPassword()
      if (result && typeof (result as any).then === 'function') {
        resolvedPassword = await (result as unknown as Promise<string>)
      } else if (typeof result === 'string') {
        resolvedPassword = result
      }
    } catch {
      // keyring unavailable (headless Linux, no D-Bus) — fall through
    }
  } else if (parsed.type === 'env') {
    resolvedPassword = process.env[parsed.envVar!] ?? null
  }

  if (resolvedPassword) return resolvedPassword

  // D-03: top-level BACKMAIL_PASSWORD env var fallback
  const fallback = process.env.BACKMAIL_PASSWORD
  if (fallback) return fallback

  throw new Error(
    `No credential resolved for passwordRef "${passwordRef}". ` +
    `Set the BACKMAIL_PASSWORD environment variable or configure a valid passwordRef.`
  )
}
```

**Error handling pattern** (from `loadConfig` and `getPassword`):
- File I/O errors: two-try-catch (ENOENT → friendly message, other errors re-thrown)
- Keyring errors: silent catch, fall through to env var
- Final failure: throw `Error` with human-readable message naming both resolution options
- No `process.exit`, no `console.*` — callers decide how to surface errors (ARCH-01)

---

### `src/core/index.ts` (module boundary, exports)

**Analog:** `src/core/index.ts` (existing, lines 28–29)

**Existing export pattern to replace** (lines 28–29):
```typescript
// REMOVE these lines:
export type { BackmailConfig } from './config.js'
export { getConfigPath, loadConfig, getPassword } from './config.js'
```

**New export block** (replacing the above, same style):
```typescript
// Phase 6: Repository config public API (replaces Phase 2 config exports)
export type { RepositoryConfig, PasswordRef } from './config.js'
export { loadRepositoryConfig, parsePasswordRef, getPasswordByRef } from './config.js'
```

**Interface removal pattern**: The `AccountConfig` interface (lines 10–16) with `repoPath` field is removed. It will be superseded by `RepositoryConfig`. Note: this breaks `core-api-boundary.test.ts` which currently tests `AccountConfig` — that test file must be updated (D-07).

**Module boundary comment** (lines 1–9) must be preserved verbatim — it documents the ARCH-01 boundary contract.

---

### `tests/unit/config.test.ts` (test, request-response)

**Analog:** `tests/unit/config.test.ts` (existing) — direct replacement; existing tests for `loadConfig`, `getConfigPath`, `getPassword(accountName)` are removed; new tests cover `loadRepositoryConfig`, `parsePasswordRef`, `getPasswordByRef`.

**Keyring mock pattern** (lines 14–24) — copy exactly:
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
The `_mockGetPassword` export pattern and the regular function (not arrow) constructor requirement MUST be preserved. Arrow functions cannot be used as constructors (Reflect.construct).

**Mock reset pattern** (lines 223–226) — copy for every `getPasswordByRef` describe block:
```typescript
beforeEach(async () => {
  const { _mockGetPassword } = await import('@napi-rs/keyring') as any
  _mockGetPassword.mockReset()
  _mockGetPassword.mockReturnValue('secret123')
})
```

**Temp dir fixture pattern** (lines 90–98) — for `loadRepositoryConfig` tests:
```typescript
let tmpDir: string
let tmpConfigPath: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-test-'))
  tmpConfigPath = path.join(tmpDir, 'config.json')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
```
For `loadRepositoryConfig`, the fixture must create a `.backmail/` subdirectory:
```typescript
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-test-'))
  const backmailDir = path.join(tmpDir, '.backmail')
  fs.mkdirSync(backmailDir)
  tmpConfigPath = path.join(backmailDir, 'config.json')
})
```

**Import pattern** for new test file (lines 1–8):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

import { loadRepositoryConfig, parsePasswordRef, getPasswordByRef } from '../../src/core/config.js'
```

---

### `tests/unit/core-api-boundary.test.ts` (test, static analysis)

**Analog:** `tests/unit/core-api-boundary.test.ts` (existing) — minor update only.

**Type assertion test pattern** (lines 7–18):
```typescript
it('exports RepositoryConfig as a usable interface (compile-time check)', () => {
  const config: core.RepositoryConfig = {
    host: 'localhost',
    port: 993,
    username: 'jan@gmail.com',
    tls: true,
    passwordRef: 'env:BACKMAIL_PASSWORD',
  }
  expect(config.host).toBe('localhost')
})
```
Replace the `AccountConfig` assertion (which tests `repoPath`) with a `RepositoryConfig` assertion that tests `passwordRef`. Same structure.

**Static source inspection pattern** (lines 46–82) — preserve the ARCH-01 checks for `config.ts`:
- No `from ['"]../cli/` imports
- No `process.exit()`
- No `console.*` calls
- No `require('keytar')` (archived package)
These checks run against the new `config.ts` content and must continue to pass.

---

## Shared Patterns

### ARCH-01: No CLI Leakage in Core
**Source:** `src/core/config.ts` (comment on line 2) + `tests/unit/cli-boundary.test.ts`
**Apply to:** `src/core/config.ts`
```typescript
// ARCH-01: no exit calls, no console.*, no CLI imports
```
The comment is a convention signal AND it is enforced by the static test in `tests/unit/core-api-boundary.test.ts`. The new `config.ts` must retain this comment and must not introduce any `process.exit`, `console.*`, or CLI imports.

### Zod `.parse()` for validation
**Source:** `src/core/config.ts` line 83
**Apply to:** `src/core/config.ts` (`loadRepositoryConfig`)
```typescript
const config = ConfigSchema.parse(parsed) as BackmailConfig
```
Use `Schema.parse()` — not `.safeParse()` — so that `ZodError` propagates up for callers to catch and reformat. Do not suppress Zod errors.

### @napi-rs/keyring mock in tests
**Source:** `tests/unit/config.test.ts` lines 14–24
**Apply to:** `tests/unit/config.test.ts` (all `getPasswordByRef` describe blocks)
The `_mockGetPassword` export trick is the project-standard way to get a handle on the mock function across `vi.mock` hoisting. Always use this pattern — never use `vi.mocked(Entry)` directly as it is less reliable across Vitest versions.

### Error message format
**Source:** `src/core/config.ts` lines 69–72, 121–123
**Apply to:** `src/core/config.ts` (all new throw sites)
```typescript
throw new Error(
  `No config found at ${resolvedPath}. Create it with your IMAP accounts — see README for format.`
)
```
Errors are single `Error` instances with human-readable backtick template literal messages. No custom error classes. No multi-line strings (one template literal per throw). Caller decides how to surface.

---

## No Analog Found

All files in scope have strong in-codebase analogs. The `parsePasswordRef` and `getPasswordByRef` functions are new logic but live inside the existing `src/core/config.ts` file which is the analog for structure, imports, and error patterns. The `URLSearchParams`-based parser and the keyring/env branching logic were specified in ARCHITECTURE.md and CONTEXT.md.

---

## Metadata

**Analog search scope:** `src/core/`, `tests/unit/`
**Files scanned:** 6 source + 5 test files
**Pattern extraction date:** 2026-04-29
