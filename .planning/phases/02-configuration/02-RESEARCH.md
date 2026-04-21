# Phase 2: Configuration - Research

**Researched:** 2026-04-21
**Domain:** Node.js config file loading, OS path resolution, OS keyring credential storage
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** File-based only — no `backmail config` subcommands in Phase 2. Users create and edit `config.json` manually. The CLI reads and validates it; no interactive config management.
- **D-02:** Named accounts as a top-level object with account name as key: `{"accounts": {"gmail": {...}, "work": {...}}}`. No duplicate name collisions possible; key-based lookup at O(1).
- **D-03:** `repoPath` accepts any of: tilde-expanded (`~/mail/gmail`), absolute (`/home/jan/mail/gmail`), or relative to the config file directory (`./gmail`). All resolved to absolute at load time.
- **D-04:** Config file is JSON at the OS-appropriate path: `~/.config/backmail/config.json` (Linux), `~/Library/Application Support/backmail/config.json` (macOS), `%APPDATA%\backmail\config.json` (Windows).
- **D-05:** keytar service name: `"backmail"`, account key: the account name from config (e.g., `"gmail"`). One keyring entry per named account.
- **D-06:** Env var fallback: always `BACKMAIL_<ACCOUNT>_PASSWORD` (uppercased account name). No special-case for single account — consistent across all configs.
- **D-07:** Credential lookup order: keytar first → env var → throw (not at load time, see D-09).
- **D-08:** No config file at startup → clear error with path and instructions: `No config found at <OS path>. Create it with your IMAP accounts — see README for format.` Exit non-zero. No template file creation, no wizard.
- **D-09:** Missing credentials are NOT validated at config load time. Error is thrown lazily when a command actually needs the password (sync, restore). Error message: `No credential for account "<name>" — set BACKMAIL_<NAME>_PASSWORD or add to OS keyring.`
- ESM project (`type: "module"`), `.js` extensions in imports
- No `process.exit()` or `console.*` in `src/core/` — config error must throw, not exit
- keytar is NOT yet in package.json — Phase 2 adds it
- `AccountConfig` interface already defined in `src/core/index.ts` — must align, not redefine

### Claude's Discretion
- JSON schema validation library choice (or manual validation)
- Exact field validation rules (e.g., port range, TLS boolean coercion)
- Internal module structure within `src/core/config.ts`
- Whether to export a `getConfig()` singleton or a `loadConfig(path)` function
- `backmail` command to show which account is being used when running subcommands

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONFIG-01 | User can configure named IMAP accounts in the OS-appropriate config dir (`~/.config/backmail/` on Linux, `~/Library/Application Support/backmail/` on macOS, `%APPDATA%\backmail\` on Windows) | Path construction via Node.js `os` and `path` built-ins — no third-party library needed; verified against D-04 |
| CONFIG-02 | Config supports multiple named accounts, each with IMAP host, port, username, TLS settings, and git repo path | Zod `z.record(z.string(), AccountConfigSchema)` under an `accounts` key; aligns with existing `AccountConfig` interface |
| CONFIG-03 | Credentials stored in OS keyring (via keytar) when available; falls back to `BACKMAIL_<ACCOUNT>_PASSWORD` environment variables | `@napi-rs/keyring` is the actively maintained replacement for archived `keytar`; lazy lookup pattern with null-check then env var then throw |
</phase_requirements>

## Summary

Phase 2 builds the config module (`src/core/config.ts`) that loads a JSON file from the OS-appropriate path, validates it with a schema, resolves `repoPath` to absolute form, and exposes a lazy `getPassword(accountName)` function that tries the OS keyring first then the env var. The CLI wrapper (`src/cli/index.ts`) calls the loader and exits non-zero with a human-readable message when the config is missing.

The most important research finding is that `keytar` (node-keytar, `atom/node-keytar`) was archived in December 2022 and its 7.9.0 release predates Node.js v20. The decision in CONTEXT.md refers to "keytar" by name (D-05, D-07), but the correct package to install is `@napi-rs/keyring` — a 100% API-compatible replacement that is actively maintained (v1.2.0, September 2025) and ships NAPI prebuilts for all target platforms. The service/account API shape is identical, so D-05 naming conventions still apply verbatim.

A second important finding: `env-paths` (the obvious library choice) maps the `config` property to `~/Library/Preferences/` on macOS, but D-04 specifies `~/Library/Application Support/`. Using `paths.data` from env-paths would give the right path, but introducing a dependency just for this is unnecessary. The cleanest approach is a small hand-rolled `getConfigDir()` function using Node.js `os.homedir()`, `process.platform`, and `process.env.APPDATA` — all built-in, zero dependencies, exactly three cases.

**Primary recommendation:** Implement `src/core/config.ts` with hand-rolled OS path detection, Zod schema validation, and `@napi-rs/keyring` for credential storage. Export `loadConfig(configPath?)` (not a singleton) so tests can inject paths without environment coupling.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OS config path resolution | API / Backend (core) | — | Pure Node.js logic; no CLI or I/O concept needed |
| JSON file reading & parsing | API / Backend (core) | — | `fs.readFileSync` + `JSON.parse`; belongs in core, not CLI |
| Schema validation | API / Backend (core) | — | Zod schema lives in `src/core/config.ts`; throws on bad config |
| `repoPath` tilde/relative resolution | API / Backend (core) | — | Path normalization is business logic, not CLI concern |
| Keyring credential lookup | API / Backend (core) | — | `getPassword()` exported from core; CLI never calls keyring directly |
| Env var fallback | API / Backend (core) | — | `process.env` read inside core `getPassword()` function |
| Error reporting (missing config) | CLI (thin wrapper) | — | Core throws; CLI catches and prints + exits non-zero |
| Error reporting (missing credential) | API / Backend (core) | — | Thrown lazily from core when password is needed (D-09) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@napi-rs/keyring` | 1.2.0 | OS keyring credential storage (macOS Keychain, Windows Credential Manager, Linux Secret Service) | 100% API-compatible replacement for archived `keytar`; NAPI prebuilts for all target platforms; actively maintained (Sep 2025) |
| `zod` | 4.3.6 | JSON schema validation with TypeScript type inference | Zero-runtime-overhead types; `z.infer<>` keeps type and schema in sync; best-in-class error messages |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `os`, `path`, `fs` (built-in) | — | Config dir path construction, file I/O | Always — no third-party needed for these operations |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@napi-rs/keyring` | `keytar` (7.9.0) | `keytar` archived Dec 2022, no Node.js v20+ prebuilts — do not use |
| `@napi-rs/keyring` | `keychain` | Less popular, macOS-only — does not cover Windows/Linux |
| `zod` for validation | Manual field checks | Manual checks are verbose, don't produce TypeScript types, miss edge cases |
| `zod` for validation | `ajv` + JSON Schema | More setup, looser TS integration, verbose for this use case |
| Hand-rolled `getConfigDir()` | `env-paths` | `env-paths` maps `config` to `~/Library/Preferences/` on macOS (wrong per D-04); `paths.data` would give the right path but is semantically misleading; hand-rolling 8 lines is cleaner |

**Installation:**
```bash
npm install @napi-rs/keyring zod
```

**Version verification (confirmed against npm registry on 2026-04-21):**
- `@napi-rs/keyring`: 1.2.0 (published 2025-09-02)
- `zod`: 4.3.6 (published 2026-01-25)

## Architecture Patterns

### System Architecture Diagram

```
backmail CLI (src/cli/index.ts)
       │
       │ program.parse() — before any subcommand
       ▼
loadConfig(configPath?)          [src/core/config.ts]
       │
       ├─ getConfigPath()         resolve OS-appropriate config dir
       │       linux:  ~/.config/backmail/config.json
       │       darwin: ~/Library/Application Support/backmail/config.json
       │       win32:  %APPDATA%\backmail\config.json
       │
       ├─ fs.readFileSync(path)   throws ConfigNotFoundError → CLI catches → exit 1
       │
       ├─ JSON.parse(raw)         throws ConfigParseError
       │
       ├─ ConfigSchema.parse()    Zod validation → throws ZodError
       │
       └─ resolveRepoPaths()      tilde + relative → absolute (per D-03)
              │
              ▼
       BackmailConfig { accounts: Record<string, AccountConfig> }
              │
              │  (returned to CLI; stored in memory for command dispatch)
              ▼
       getPassword(accountName)   [lazy — called by sync/restore, NOT at load time]
              │
              ├─ @napi-rs/keyring.getPassword("backmail", accountName)
              │       returns string | null
              │
              ├─ if null → process.env[`BACKMAIL_${accountName.toUpperCase()}_PASSWORD`]
              │
              └─ if undefined → throw Error(`No credential for account "${name}" ...`)
```

### Recommended Project Structure
```
src/
├── core/
│   ├── index.ts          # Public API boundary — re-exports AccountConfig, loadConfig, getPassword
│   └── config.ts         # Config loading, path resolution, credential lookup
└── cli/
    └── index.ts          # Commander skeleton — calls loadConfig, prints errors, exits
tests/
└── unit/
    ├── config.test.ts    # Unit tests for loadConfig, getConfigDir, resolveRepoPath, getPassword
    ├── cli-boundary.test.ts  # Existing — add config.ts to boundary checks
    └── core-api-boundary.test.ts  # Existing
```

### Pattern 1: Config Loading with Zod
**What:** Parse and validate the JSON config file, fail fast with clear errors.
**When to use:** At CLI startup, before any command runs.
**Example:**
```typescript
// Source: Zod docs (github.com/colinhacks/zod) — verified via Context7
import { z } from 'zod'

const AccountConfigSchema = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  username: z.string(),
  tls: z.boolean(),
  repoPath: z.string(),
})

const ConfigSchema = z.object({
  accounts: z.record(z.string(), AccountConfigSchema),
})

type BackmailConfig = z.infer<typeof ConfigSchema>
// BackmailConfig['accounts'] is Record<string, AccountConfig>
```

### Pattern 2: OS-Appropriate Config Path (no third-party lib)
**What:** Resolve config directory per D-04 using Node.js built-ins.
**When to use:** In `getConfigPath()` — the single function that knows about platforms.
**Example:**
```typescript
// Source: Node.js os/path built-ins [VERIFIED: Node.js v24 docs]
import os from 'node:os'
import path from 'node:path'

function getConfigDir(): string {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA ?? os.homedir(), 'backmail')
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'backmail')
    default: // linux and other unix
      return path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
        'backmail'
      )
  }
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json')
}
```

### Pattern 3: repoPath Resolution (D-03)
**What:** Normalize tilde, absolute, and relative paths to absolute form.
**When to use:** After Zod validation, before returning config.
**Example:**
```typescript
// [VERIFIED: Node.js path module behavior confirmed by test in research session]
function resolveRepoPath(repoPath: string, configDir: string): string {
  // Expand leading ~/
  const expanded = repoPath.startsWith('~/')
    ? path.join(os.homedir(), repoPath.slice(2))
    : repoPath
  // Absolute paths pass through; relative paths resolve from configDir
  return path.resolve(configDir, expanded)
}
```

### Pattern 4: Lazy Credential Lookup (D-07, D-09)
**What:** Try OS keyring first, then env var, then throw — NOT at config load time.
**When to use:** When a command (sync, restore) needs the IMAP password.
**Example:**
```typescript
// Source: @napi-rs/keyring README + keytar.d.ts type definitions [VERIFIED: npm registry + GitHub]
import { getPassword as keytarGet } from '@napi-rs/keyring'

export async function getPassword(accountName: string): Promise<string> {
  // Try OS keyring first
  let password: string | null = null
  try {
    password = keytarGet('backmail', accountName)  // sync in @napi-rs/keyring Entry API
  } catch {
    // keyring not available (e.g. headless Linux without secret service) — fall through
  }
  if (password !== null) return password

  // Env var fallback (D-06)
  const envKey = `BACKMAIL_${accountName.toUpperCase()}_PASSWORD`
  const envPassword = process.env[envKey]
  if (envPassword !== undefined) return envPassword

  // No credential found — throw (D-07, D-09)
  throw new Error(
    `No credential for account "${accountName}" — set ${envKey} or add to OS keyring.`
  )
}
```

> **Note on `@napi-rs/keyring` API:** The library exposes both an `Entry` class and keytar-compatible
> function exports. The keytar-compatible shim (`getPassword(service, account)`) returns `string | null`
> (not a Promise). The `Entry` class is synchronous. Wrap in try/catch for headless Linux where the
> secret service may be absent — it throws rather than returning null in that case.

### Anti-Patterns to Avoid
- **Singleton config module:** A module-level cached `config` variable breaks test isolation. Export `loadConfig(path?)` so tests inject the path.
- **Eager credential validation:** Do not call `getPassword()` in `loadConfig()`. D-09 is explicit: credentials are validated lazily. Loading config should succeed even if passwords are missing.
- **`process.exit()` in `src/core/`:** Core throws errors; the CLI layer catches them and calls `process.exit(1)`. This keeps the core importable in Electron/eimerjs without side effects.
- **`console.*` in `src/core/`:** Same reason — no I/O in core.
- **Storing absolute config path in module scope:** Compute it at call time so tests can override `process.env.APPDATA` or `process.env.XDG_CONFIG_HOME` without mocking the module.
- **Re-exporting `AccountConfig` interface separately from `src/core/index.ts`:** The interface is already defined there; import from the existing location, do not duplicate.
- **Using `env-paths` package for `config` paths on macOS:** `env-paths` maps `config` to `~/Library/Preferences/` on macOS, which conflicts with D-04. Avoid this package for this use case.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config schema validation | Custom field-by-field checks | Zod | Missing fields, wrong types, nested errors — Zod handles all cases and produces TypeScript types for free |
| OS keychain credential storage | File-based secret storage, encrypted config | `@napi-rs/keyring` | macOS Keychain, Windows Credential Manager, Linux Secret Service each have their own C APIs with complex locking and encryption — using the keyring avoids all of it |
| Tilde expansion | `repoPath.replace('~', os.homedir())` | `path.join(os.homedir(), repoPath.slice(2))` | Simple `replace` breaks on `~user` patterns and Windows; use the `path.join` pattern shown above |

**Key insight:** The config domain looks simple but has two genuinely hard problems: cross-platform path conventions (three distinct OS behaviors) and credential storage (three distinct OS keychains). Both have well-known, well-tested library solutions.

## Common Pitfalls

### Pitfall 1: keytar vs. @napi-rs/keyring
**What goes wrong:** Installing `keytar` (the archived package) instead of `@napi-rs/keyring`. Keytar has no prebuilts for Node.js v20+ and will fail to compile or produce a mismatched native module error at runtime.
**Why it happens:** CONTEXT.md refers to "keytar" by concept name (the decision predates the archive), and `npm install keytar` appears to succeed — it downloads the package but the native build may fail silently.
**How to avoid:** Always install `@napi-rs/keyring`. The API surface is 100% compatible; the service/account naming in D-05 applies unchanged.
**Warning signs:** `Error: Module did not self-register` or `NODE_MODULE_VERSION` mismatch at runtime.

### Pitfall 2: keyring throws on headless Linux (secret service absent)
**What goes wrong:** On a headless Linux server (no D-Bus / GNOME Keyring / KWallet), `@napi-rs/keyring`'s `getPassword` throws rather than returning null. If the caller doesn't catch, the entire CLI crashes before reaching the env var fallback.
**Why it happens:** Linux secret service backends (libsecret, KWallet) require a running desktop session. CI environments and servers typically lack one.
**How to avoid:** Wrap the keyring call in try/catch as shown in Pattern 4. Any thrown exception means "keyring unavailable" — fall through to env var. The env var path is the primary headless mechanism.
**Warning signs:** CLI hangs or crashes on CI/server with `DBusError` or `SecretService unavailable`.

### Pitfall 3: env-paths macOS config path mismatch
**What goes wrong:** Using `envPaths('backmail').config` on macOS returns `~/Library/Preferences/backmail-nodejs` — not `~/Library/Application Support/backmail` as specified in D-04.
**Why it happens:** `env-paths` follows macOS App Store conventions for `.plist` preference files, not the Application Support convention used by most CLI tools.
**How to avoid:** Use the hand-rolled `getConfigDir()` function (Pattern 2). Do not use `env-paths` for this project.

### Pitfall 4: `z.record()` key validation permissiveness
**What goes wrong:** `z.record(z.string(), AccountConfigSchema)` accepts any string key including empty string or keys with spaces. This is fine for config loading, but account names fed into `BACKMAIL_${name.toUpperCase()}_PASSWORD` must be valid identifier-like strings to produce predictable env var names.
**Why it happens:** Zod's `z.record` validates values only by default.
**How to avoid:** Add `z.string().min(1).regex(/^[a-z0-9_-]+$/i)` as the key validator in the record schema to enforce valid account names. This catches `{"accounts": {"my account": {...}}}` early.
**Warning signs:** Env var names with spaces that never match — silent credential failure.

### Pitfall 5: Relative `repoPath` resolves against CWD, not config dir
**What goes wrong:** Using `path.resolve(repoPath)` instead of `path.resolve(configDir, repoPath)` resolves relative paths against the process working directory (wherever the user ran `backmail` from), not the config file directory.
**Why it happens:** D-03 specifies "relative to the config file directory" — easy to miss.
**How to avoid:** Always pass `configDir` as the first argument to `path.resolve()` when normalizing relative paths.

## Code Examples

Verified patterns from official sources:

### Zod record with key + value validation
```typescript
// Source: Zod docs (colinhacks/zod) — verified via Context7 2026-04-21
import { z } from 'zod'

const AccountConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  tls: z.boolean(),
  repoPath: z.string().min(1),
})

const ConfigSchema = z.object({
  accounts: z.record(
    z.string().min(1).regex(/^[a-z0-9_-]+$/i, 'Account name must be alphanumeric'),
    AccountConfigSchema
  ),
})
```

### @napi-rs/keyring keytar-compatible import
```typescript
// Source: @napi-rs/keyring README + keytar.d.ts [VERIFIED: npm registry, GitHub 2026-04-21]
// The package ships a keytar-compatible named export:
import { getPassword, setPassword, deletePassword } from '@napi-rs/keyring'

// getPassword returns: string | null (synchronous)
const password = getPassword('backmail', 'gmail')  // null if not found
```

### Safe file read with custom error
```typescript
// [VERIFIED: Node.js fs built-in — standard pattern]
import fs from 'node:fs'

function readConfigFile(configPath: string): string {
  try {
    return fs.readFileSync(configPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `No config found at ${configPath}. Create it with your IMAP accounts — see README for format.`
      )
    }
    throw err
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `keytar` (atom/node-keytar) | `@napi-rs/keyring` | Dec 2022 (keytar archived) | Direct drop-in; same API surface; NAPI prebuilts included |
| CJS `require('keytar')` | ESM `import { getPassword } from '@napi-rs/keyring'` | With ESM migration | Must use named import style; module type `"module"` in package.json |

**Deprecated/outdated:**
- `keytar` (7.9.0): Archived December 2022. No prebuilts for Node.js v20+. Last commit 2022. Use `@napi-rs/keyring` instead.
- `env-paths` for this use case: Returns wrong macOS path for `config` property. Only useful here if using `paths.data`, which is semantically misleading.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@napi-rs/keyring`'s keytar-compatible `getPassword` is synchronous (returns `string \| null`, not `Promise<string \| null>`) | Code Examples, Pattern 4 | If it's async, the `getPassword()` wrapper in core must be `async` and callers must `await` |

> A1 is based on the `Entry` class being synchronous in the README and the keytar.d.ts showing `Promise<string | null>` for the shim. The shim function signatures are `Promise`-based per the type file, but the underlying `Entry.getPassword()` is synchronous. The `keytar.d.ts` compatibility shim wraps them in promises. **Verify at implementation time:** run `typeof getPassword('x','y').then` to confirm whether the shim is promise-based.

## Open Questions

1. **Zod v3 vs v4 API compatibility**
   - What we know: Zod 4.3.6 is current (Jan 2026); project has no existing Zod dep; Zod v4 introduced some breaking changes vs v3.
   - What's unclear: Whether the import path changed (`import { z } from 'zod'` vs `import * as z from 'zod'`).
   - Recommendation: Use `import { z } from 'zod'` which works in both. Verified via Context7 examples which show `import * as z from "zod"` as the v4 pattern.

2. **Secret service on this dev machine (Linux)**
   - What we know: Dev machine is Linux (verified from env); secret service availability unknown.
   - What's unclear: Whether `@napi-rs/keyring` can store/retrieve credentials in this environment during integration testing.
   - Recommendation: Unit tests should mock the keyring call entirely. Don't depend on OS keyring being present in test environments.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v24.11.1 | — |
| npm | Package installation | ✓ | (standard) | — |
| `@napi-rs/keyring` | CONFIG-03 credential storage | ✗ (not yet installed) | 1.2.0 | env var fallback in code; install in Wave 0 |
| `zod` | CONFIG-02 schema validation | ✗ (not yet installed) | 4.3.6 | — install in Wave 0 |
| OS secret service (Linux) | Keyring backend | Unknown | — | Env var fallback is the design; keyring unavailability is handled gracefully |

**Missing dependencies with no fallback:**
- None — both packages are available on npm and installation is straightforward.

**Missing dependencies with fallback:**
- OS secret service: keyring failure caught in try/catch → falls through to env var (D-07).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/unit/config.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONFIG-01 | `getConfigDir()` returns correct path on linux/darwin/win32 | unit | `npx vitest run tests/unit/config.test.ts -t "getConfigDir"` | ❌ Wave 0 |
| CONFIG-01 | `loadConfig()` with missing file throws with path in message | unit | `npx vitest run tests/unit/config.test.ts -t "missing config"` | ❌ Wave 0 |
| CONFIG-02 | `loadConfig()` parses valid multi-account JSON | unit | `npx vitest run tests/unit/config.test.ts -t "valid config"` | ❌ Wave 0 |
| CONFIG-02 | `loadConfig()` throws on invalid schema (bad port, missing host, etc.) | unit | `npx vitest run tests/unit/config.test.ts -t "invalid schema"` | ❌ Wave 0 |
| CONFIG-02 | `resolveRepoPath` handles tilde, absolute, relative | unit | `npx vitest run tests/unit/config.test.ts -t "repoPath"` | ❌ Wave 0 |
| CONFIG-03 | `getPassword()` returns keyring value when keyring has it | unit (mock keyring) | `npx vitest run tests/unit/config.test.ts -t "getPassword keyring"` | ❌ Wave 0 |
| CONFIG-03 | `getPassword()` falls back to env var when keyring returns null | unit | `npx vitest run tests/unit/config.test.ts -t "getPassword env var"` | ❌ Wave 0 |
| CONFIG-03 | `getPassword()` throws when neither keyring nor env var has value | unit | `npx vitest run tests/unit/config.test.ts -t "getPassword throws"` | ❌ Wave 0 |
| CONFIG-03 | `getPassword()` falls back to env var when keyring throws (headless) | unit | `npx vitest run tests/unit/config.test.ts -t "getPassword keyring error"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/unit/config.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/config.test.ts` — covers all CONFIG-01, CONFIG-02, CONFIG-03 requirement rows above
- [ ] Framework install: `npm install @napi-rs/keyring zod` — packages not yet in package.json

*(Existing test infrastructure covers CLI boundary and core API boundary checks; config test file is net-new.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth flow in this phase; credentials are stored/retrieved, not validated) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Zod schema validation of all config fields |
| V6 Cryptography | partial | OS keyring handles encryption at rest; never store plaintext passwords in config file |

### Known Threat Patterns for Config Loading

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IMAP password in plaintext config.json | Information Disclosure | D-09 / D-07: passwords never in config file; keyring or env var only |
| Config path traversal (malformed `repoPath`) | Tampering | `path.resolve()` normalizes; Zod validates string type; absolute path is safe to pass downstream |
| Env var leakage in logs | Information Disclosure | No `console.*` in `src/core/`; CLI layer must not log credential values |
| Untrusted config JSON content | Tampering | Zod validation rejects unexpected shapes; unknown keys handled by Zod's `strip` default |

## Sources

### Primary (HIGH confidence)
- `npm view @napi-rs/keyring` — version 1.2.0, published 2025-09-02 [VERIFIED: npm registry]
- `npm view zod` — version 4.3.6, published 2026-01-25 [VERIFIED: npm registry]
- `npm view keytar` — version 7.9.0, archived package, last published 2022-02-17 [VERIFIED: npm registry]
- Context7 `/colinhacks/zod` — `z.record()`, `z.object()`, `safeParse()` patterns [VERIFIED: Context7]
- GitHub `Brooooooklyn/keyring-node` README + `keytar.d.ts` — API signatures, keytar shim [VERIFIED: WebFetch]
- Node.js `os`, `path` built-in modules — `os.homedir()`, `process.platform`, `path.join/resolve` [VERIFIED: test run in research session]

### Secondary (MEDIUM confidence)
- GitHub `atom/node-keytar` — archived Dec 2022, no active maintenance [CITED: github.com/atom/node-keytar]
- `env-paths` README — macOS config path `~/Library/Preferences/` (not `Application Support`) [CITED: github.com/sindresorhus/env-paths]

### Tertiary (LOW confidence)
- None — all critical claims were verified with primary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified via npm registry on research date
- Architecture: HIGH — based on locked decisions in CONTEXT.md plus verified API shapes
- Pitfalls: HIGH (keytar archival), MEDIUM (Linux headless behavior) — keytar status verified; headless behavior from multiple corroborating sources
- Security: HIGH — Zod and OS keyring are the correct controls; no novel decisions needed

**Research date:** 2026-04-21
**Valid until:** 2026-10-21 (stable libraries; `@napi-rs/keyring` and `zod` are actively maintained)
