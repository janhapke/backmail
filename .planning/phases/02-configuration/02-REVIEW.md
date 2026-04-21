---
phase: 02-configuration
reviewed: 2026-04-21T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - package.json
  - src/cli/index.ts
  - src/core/config.ts
  - src/core/index.ts
  - tests/unit/cli-boundary.test.ts
  - tests/unit/config.test.ts
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the Phase 02 configuration module covering config loading, credential lookup, CLI wiring, and boundary enforcement tests. The architecture is sound — the CLI/core boundary is cleanly separated, Zod validation is used correctly, and the keyring-with-env-fallback pattern is solid.

Three warnings were found: a broad silent catch in `getPassword` that swallows unexpected errors, a test cleanup gap that leaks a temp directory on assertion failure, and a missing `--version` short-circuit in the CLI that causes config loading to run when the user only wants the version string. Four info-level items cover a redundant regex flag, a missing `~` (bare tilde) edge case in path expansion, a hardcoded version string, and `as any` in test code.

No critical issues were found.

---

## Warnings

### WR-01: `getPassword` silently swallows all keyring errors, including unexpected ones

**File:** `src/core/config.ts:103`
**Issue:** The `catch` block around `entry.getPassword()` has no error discrimination. It is intended to handle headless Linux scenarios where the keyring daemon is unavailable (D-Bus errors), but it will also silently swallow programming errors such as a bad `Entry` constructor call, type errors thrown inside the native binding, or unexpected exceptions from the `@napi-rs/keyring` layer. This means bugs in keyring integration will be invisible — the code silently falls through to the env-var lookup and ultimately throws a "No credential" error with no trace of the real cause.

**Fix:** Narrow the catch to only suppress known platform-unavailability errors, or at minimum re-throw if the error is not a known transient failure:
```typescript
} catch (err) {
  // Only suppress known keyring-unavailable errors (headless Linux, no D-Bus)
  const msg = (err as Error)?.message ?? ''
  const isUnavailable =
    msg.includes('DBus') ||
    msg.includes('keyring') ||
    msg.includes('SecretService') ||
    msg.includes('not available')
  if (!isUnavailable) throw err  // surface unexpected errors
  // fall through to env var
}
```
Alternatively, log the suppressed error at debug level so it is recoverable during troubleshooting (acceptable in core as a future logger, not `console.error`).

---

### WR-02: Temp directory leaks in test when assertion fails mid-test

**File:** `tests/unit/config.test.ts:192-215`
**Issue:** The "resolves relative path against config dir" test creates a temporary directory (`configDir`) and cleans it up manually at line 214 (`fs.rmSync(configDir, ...)`). If any assertion before line 214 throws (e.g., the `loadConfig` call or the `expect` on line 211), the cleanup never runs and the directory leaks. The other `repoPath` tests in this file correctly use `beforeEach`/`afterEach` for setup and teardown.

**Fix:** Move the temp directory creation into `beforeEach` and cleanup into `afterEach`, matching the pattern used by the sibling test groups:
```typescript
describe('repoPath relative', () => {
  let configDir: string
  let configPath: string

  beforeEach(() => {
    configDir = path.join(os.tmpdir(), 'backmail-test-rel-' + Date.now())
    fs.mkdirSync(configDir, { recursive: true })
    configPath = path.join(configDir, 'config.json')
  })

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true })
  })

  it('resolves relative path against config dir', () => {
    // ... write config and assert
  })
})
```

---

### WR-03: `--version` flag triggers config load; only `--help`/`-h` are short-circuited

**File:** `src/cli/index.ts:19-36`
**Issue:** The CLI short-circuits config loading for `--help` and `-h` (lines 19-23), which is correct — these flags must work without a config file. However, `--version` and `-V` (Commander's default version flag) are not handled the same way. When a user runs `backmail --version`, the code falls through to `loadConfig()` at line 30, which will throw and print an error if no config file exists, instead of printing the version string. This is a user experience regression for a standard CLI operation.

**Fix:** Extend the short-circuit check to include version flags:
```typescript
const args = process.argv.slice(2)
if (
  args.includes('--help') ||
  args.includes('-h') ||
  args.includes('--version') ||
  args.includes('-V')
) {
  program.parse(process.argv)
  process.exit(0)
}
```

---

## Info

### IN-01: Redundant `i` flag on account name regex

**File:** `src/core/config.ts:21`
**Issue:** The regex `/^[a-z0-9_-]+$/i` uses the case-insensitive flag `i`, but the character class `[a-z0-9_-]` already explicitly covers only lowercase letters and digits. The `i` flag makes it accept uppercase letters too, but this contradicts the intent implied by `[a-z0-9_-]`. If uppercase account names should be allowed, the character class should be `[a-zA-Z0-9_-]` without the `i` flag (clearer intent). If only lowercase is intended, drop the `i` flag.

**Fix:** Choose one:
```typescript
// Option A: allow uppercase explicitly (clear intent)
z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Account name must be alphanumeric')

// Option B: lowercase only (matches the character class as written)
z.string().min(1).regex(/^[a-z0-9_-]+$/, 'Account name must be alphanumeric (lowercase)')
```

---

### IN-02: `resolveRepoPath` does not handle bare `~` (tilde without trailing slash)

**File:** `src/core/config.ts:51-53`
**Issue:** The tilde expansion checks `repoPath.startsWith('~/')` — a path of exactly `~` (meaning the home directory itself) is not expanded and is passed through unresolved. This is an uncommon but valid value a user might enter.

**Fix:**
```typescript
function resolveRepoPath(repoPath: string, configDir: string): string {
  let expanded = repoPath
  if (repoPath === '~') {
    expanded = os.homedir()
  } else if (repoPath.startsWith('~/')) {
    expanded = path.join(os.homedir(), repoPath.slice(2))
  }
  return path.resolve(configDir, expanded)
}
```

---

### IN-03: Version string hardcoded in CLI, duplicating `package.json`

**File:** `src/cli/index.ts:15`
**Issue:** The version `'0.1.0'` is hardcoded and must be kept in sync with `package.json` manually. If `package.json` is bumped, the CLI version will drift.

**Fix:** Read the version from `package.json` at build time or runtime:
```typescript
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { version } = require('../../package.json') as { version: string }

program
  .name('backmail')
  .description('Mirror IMAP mailboxes to git')
  .version(version)
```
Alternatively, use a build-time injection via `tsc` or a bundler constant.

---

### IN-04: `as any` cast when accessing mock internals in tests

**File:** `tests/unit/config.test.ts:224` (and lines 246, 269, 286)
**Issue:** `await import('@napi-rs/keyring') as any` discards type safety to access `_mockGetPassword`. This is a common pattern for Vitest mocks but can be improved with a typed mock helper.

**Fix:** Define a typed mock module interface at the top of the test file:
```typescript
type MockedKeyring = {
  Entry: ReturnType<typeof vi.fn>
  _mockGetPassword: ReturnType<typeof vi.fn>
}

// Then in each beforeEach:
const { _mockGetPassword } = (await import('@napi-rs/keyring')) as unknown as MockedKeyring
```

---

_Reviewed: 2026-04-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
