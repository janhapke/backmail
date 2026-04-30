# Phase 9: Init Command - Research

**Researched:** 2026-04-30
**Domain:** Node.js CLI interactive prompts, OS keyring writes, git repo initialization, TTY detection
**Confidence:** HIGH

## Summary

Phase 9 adds `backmail init [path]` — the final piece of the v1.1 repository-centric UX. All infrastructure is in place: credential types live in `src/core/config.ts`, repo discovery lives in `src/core/discovery.ts`, and the CLI command skeleton pattern is established in `src/cli/index.ts`. This phase adds one new file (`src/core/init.ts`), one new CLI command block, and one new dependency (`@inquirer/prompts`).

The core function `initRepository(targetDir, config, passwordRef)` is purely file-system work: create directories, write JSON, call `simpleGit(archivePath).init()`. It has no I/O, no prompts, no keyring — those belong to the CLI action handler. The CLI action handler detects TTY vs. non-TTY, collects missing parameters via `@inquirer/prompts`, writes the keyring via `new Entry('backmail', username).setPassword(password)` (synchronous, throws on failure), then derives `passwordRef` and calls `initRepository`.

**Primary recommendation:** Follow the existing `syncAccount`/`restoreAccount` pattern exactly: thin CLI handler owns all I/O, core function is pure filesystem/git.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Use `@inquirer/prompts` as the interactive prompt library. ESM-native, well-maintained, typed. Install as production dependency.
- **D-02:** Prompt types: `input` for host/port/username, `confirm` for TLS (default: true), `password` (masked) for password. Port default: 993, TLS default: true.
- **D-03:** Claude's discretion on exact prompt wording and validation logic (e.g., port must be 1–65535 integer).
- **D-04:** `init` supports two credential flags: `--password <plaintext>` (writes to keyring, stores `keyring:service=backmail;account=<username>`) and `--password-ref <ref>` (writes ref directly, no keyring interaction).
- **D-05:** Keyring write failure → clear error mentioning `--password-ref env:BACKMAIL_PASSWORD`, exit non-zero. No silent fallback.
- **D-06:** `BACKMAIL_PASSWORD` env var fallback is a runtime concern unchanged from Phase 6.
- **D-07:** `backmail init [path]` — positional arg defaults to CWD. Does NOT interact with global `--workdir`.
- **D-08:** Full flag coverage: `--host`, `--port`, `--username`, `--tls`/`--no-tls`, `--password`, `--password-ref`. All optional; prompts in TTY, errors in non-TTY.
- **D-09:** `initRepository(targetDir: string, config: RepositoryConfig, passwordRef: string): Promise<void>` in `src/core/init.ts`. Handles: directory creation (`.backmail/`, `.backmail/log`, `archive/`, `worktrees/`), writing `.backmail/config.json`, git init at `archive/`, non-destructive check (throws if `.backmail/` already exists).
- **D-10:** CLI action handler owns: prompts, non-TTY detection (`process.stdin.isTTY === false`), keyring write (`new Entry(service, account).setPassword(password)`), `passwordRef` derivation, calling `initRepository()`.
- **D-11:** `initRepository()` exported from `src/core/index.ts`.
- **D-12:** `getPasswordByRef()` unchanged.
- **D-13:** No changes to `src/core/config.ts`, `src/core/discovery.ts`, or existing commands.
- **D-14:** `archivePath = path.join(repoRoot, 'archive')` convention used in `initRepository()`.

### Claude's Discretion

- Exact prompt wording and per-field validation (e.g., port integer check)
- `simple-git` vs raw `git init` shell command for archive initialisation (simple-git already in dependencies)
- Whether `initRepository()` uses async fs from `node:fs/promises` or sync fs
- Unit test structure and fixture approach for init

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REPO-01 | User can run `backmail init [path]` to create `.backmail/config.json`, `.backmail/log`, `archive/` (git repo), `worktrees/` | `simpleGit(archivePath).init()` + `fs.promises.mkdir` + JSON.stringify(config) |
| REPO-02 | `init` prompts interactively for missing parameters (host, port, username, TLS, password) | `@inquirer/prompts` input/confirm/password — all verified against published tarball |
| REPO-03 | `init` stores password in OS keyring, writes `passwordRef` to config.json | `new Entry('backmail', username).setPassword(password)` — synchronous, verified in type definitions |
| REPO-04 | `init` is non-destructive — refuses to overwrite existing repo | `fs.existsSync(path.join(targetDir, '.backmail'))` check before any writes; throw with clear message |
| REPO-05 | `init` detects non-TTY (CI/piped stdin) and requires all params as flags | `process.stdin.isTTY === false` → collect missing required params → error if any missing |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Directory + file creation | Core (`src/core/init.ts`) | — | Pure I/O, no UI concerns — matches ARCH-01 pattern |
| Git repo initialization | Core (`src/core/init.ts`) | — | Deterministic operation on a path, no user input needed |
| Non-destructive guard (REPO-04) | Core (`src/core/init.ts`) | — | Core throws; CLI catches and prints — same pattern as all other commands |
| Interactive prompts (REPO-02) | CLI (`src/cli/index.ts`) | — | ARCH-01: no readline/I/O in core |
| Non-TTY detection (REPO-05) | CLI (`src/cli/index.ts`) | — | `process.stdin.isTTY` is process state — CLI concern |
| Keyring write (REPO-03) | CLI (`src/cli/index.ts`) | — | ARCH-01: no keyring I/O in core; CLI derives `passwordRef` string, passes to core |
| `passwordRef` string derivation | CLI (`src/cli/index.ts`) | — | CLI knows which credential path was taken (keyring vs ref flag) |
| Config JSON serialization | Core (`src/core/init.ts`) | — | Uses `RepositoryConfig` type already defined in `src/core/config.ts` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@inquirer/prompts` | 8.4.2 | Interactive CLI prompts (input, password, confirm) | ESM-native (`"type": "module"`), TypeScript typed, single-package for all prompt types. Locked in D-01. [VERIFIED: npm registry + tarball inspection] |
| `@napi-rs/keyring` | 1.3.0 (already installed) | Synchronous OS keyring read/write | Already in project; `Entry.setPassword()` is synchronous void [VERIFIED: installed type definitions at node_modules/@napi-rs/keyring/index.d.ts] |
| `simple-git` | 3.36.0 (already installed) | Git repo initialization (`simpleGit(path).init()`) | Already in project; used in sync.ts [VERIFIED: Context7 docs] |
| `node:fs/promises` | Node built-in | Async directory/file creation | Standard Node built-in; `mkdir({ recursive: true })`, `writeFile` [ASSUMED] |
| `node:path` | Node built-in | Path manipulation | Already used throughout project [VERIFIED: codebase] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | ^4.3.6 (already installed) | Schema parse for config output validation | Already used in `loadRepositoryConfig` — same schema validates what `initRepository` writes [VERIFIED: codebase] |

**Installation:**
```bash
npm install @inquirer/prompts
```

**Version note:** `@inquirer/prompts@8.4.2` requires Node.js `>=23.5.0 || ^22.13.0 || ^21.7.0 || ^20.12.0`. The machine runs Node.js v24.11.1. [VERIFIED: tarball package.json + `node --version`]

## Architecture Patterns

### System Architecture Diagram

```
backmail init [path] [flags]
         │
         ▼
CLI action handler (src/cli/index.ts)
         │
         ├─ Resolve targetDir (positional arg or CWD)
         │
         ├─ Collect params from flags ──────────────────────────────┐
         │                                                            │
         ├─ [TTY check: process.stdin.isTTY]                        │
         │      │                                                     │
         │  TTY=true                          TTY=false              │
         │      │                                  │                  │
         │      ▼                                  ▼                  │
         │  @inquirer/prompts              Error if any              │
         │  input/confirm/password         required param            │
         │  for missing params             is missing                │
         │      │                                  │                  │
         │      └──────────────────────────────────┘                 │
         │                     │                                      │
         ├─ Keyring write ─────┘ (if --password flag used)          │
         │  new Entry('backmail', username).setPassword(pw)          │
         │  throws → print error + exit 1                            │
         │                                                            │
         ├─ Derive passwordRef string ◄──────────────────────────────┘
         │  keyring path: "keyring:service=backmail;account=<user>"
         │  ref path:     value of --password-ref flag
         │
         ▼
initRepository(targetDir, config, passwordRef)  [src/core/init.ts]
         │
         ├─ Guard: fs.existsSync(.backmail/) → throw "repo already exists"
         │
         ├─ fs.mkdirSync(.backmail/, { recursive: true })
         ├─ fs.mkdirSync(archive/, { recursive: true })
         ├─ fs.mkdirSync(worktrees/, { recursive: true })
         ├─ fs.writeFileSync(.backmail/log, '')
         ├─ fs.writeFileSync(.backmail/config.json, JSON.stringify({...config, passwordRef}))
         │
         └─ simpleGit(archivePath).init()
                   │
                   ▼
              git repo at archive/
```

### Recommended Project Structure

```
src/
├── core/
│   ├── init.ts          # NEW: initRepository() function
│   ├── config.ts        # unchanged — RepositoryConfig type reused
│   ├── discovery.ts     # unchanged
│   └── index.ts         # add: export { initRepository } from './init.js'
└── cli/
    └── index.ts         # add: program.command('init') block
tests/
└── unit/
    ├── init.test.ts     # NEW: unit tests for initRepository()
    └── cli-boundary.test.ts  # extend: add init.ts boundary checks
```

### Pattern 1: initRepository() — Pure Core Function
**What:** Creates all required filesystem structure and git repo. No process interaction.
**When to use:** Called by CLI after all params are collected and validated.

```typescript
// src/core/init.ts
// Source: pattern from src/core/sync.ts + src/core/restore.ts
import fs from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import type { RepositoryConfig } from './config.js'

export async function initRepository(
  targetDir: string,
  config: RepositoryConfig,
  passwordRef: string
): Promise<void> {
  const backmailDir = path.join(targetDir, '.backmail')

  // REPO-04: non-destructive guard
  if (fs.existsSync(backmailDir)) {
    throw new Error(
      `Repository already exists at ${targetDir}. Remove .backmail/ to reinitialize.`
    )
  }

  const archivePath = path.join(targetDir, 'archive')
  const worktreesPath = path.join(targetDir, 'worktrees')

  fs.mkdirSync(backmailDir, { recursive: true })
  fs.mkdirSync(archivePath, { recursive: true })
  fs.mkdirSync(worktreesPath, { recursive: true })

  // .backmail/log — empty file (used by log command)
  fs.writeFileSync(path.join(backmailDir, 'log'), '')

  // .backmail/config.json — full RepositoryConfig + passwordRef
  const configObj = { ...config, passwordRef }
  fs.writeFileSync(
    path.join(backmailDir, 'config.json'),
    JSON.stringify(configObj, null, 2)
  )

  // Initialize git repo at archive/
  await simpleGit(archivePath).init()
}
```

### Pattern 2: CLI Action Handler Structure

```typescript
// src/cli/index.ts — init command addition
// Source: established pattern from sync command in this codebase
import { input, confirm, password } from '@inquirer/prompts'
import { Entry } from '@napi-rs/keyring'
import { initRepository } from '../core/index.js'

program
  .command('init [path]')
  .description('Create a new backmail repository')
  .option('--host <host>', 'IMAP server hostname')
  .option('--port <port>', 'IMAP server port', '993')
  .option('--username <username>', 'IMAP account username')
  .option('--tls', 'use TLS (default: true)')
  .option('--no-tls', 'disable TLS')
  .option('--password <password>', 'IMAP password (written to OS keyring)')
  .option('--password-ref <ref>', 'passwordRef string written directly (e.g. env:BACKMAIL_PASSWORD)')
  .action(async (dirPath: string | undefined, opts: {
    host?: string
    port?: string
    username?: string
    tls?: boolean
    password?: string
    passwordRef?: string
  }) => {
    const targetDir = dirPath ? path.resolve(dirPath) : process.cwd()
    const isTTY = process.stdin.isTTY !== false  // REPO-05

    // Collect params — prompt in TTY, error in non-TTY
    const host = opts.host ?? (isTTY
      ? await input({ message: 'IMAP host:', required: true })
      : (console.error('Error: --host required in non-TTY mode'), process.exit(1)))
    // ... pattern repeats for port, username, tls, credential

    // Credential handling (D-04)
    let passwordRef: string
    if (opts.passwordRef) {
      passwordRef = opts.passwordRef
    } else {
      const pw = opts.password ?? (isTTY
        ? await password({ message: 'IMAP password:', mask: true })
        : (console.error('Error: --password or --password-ref required in non-TTY mode'), process.exit(1)))
      try {
        new Entry('backmail', username).setPassword(pw)  // synchronous
      } catch (err) {
        console.error(
          `Error: Failed to write password to OS keyring: ${(err as Error).message}\n` +
          'Use --password-ref env:BACKMAIL_PASSWORD for CI environments.'
        )
        process.exit(1)
      }
      passwordRef = `keyring:service=backmail;account=${username}`
    }

    try {
      await initRepository(targetDir, { host, port: portNum, username, tls }, passwordRef)
      console.log(`Initialized backmail repository at ${targetDir}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })
```

### Pattern 3: @inquirer/prompts — Exact Import Syntax

```typescript
// Source: @inquirer/prompts tarball dist/index.js inspection + Context7 /sboudrias/inquirer.js
import { input, confirm, password } from '@inquirer/prompts'

// input — free text, with validation
const host = await input({
  message: 'IMAP host:',
  required: true,
})

// input with numeric validation
const portStr = await input({
  message: 'IMAP port:',
  default: '993',
  validate: (v) => {
    const n = parseInt(v, 10)
    return (Number.isInteger(n) && n >= 1 && n <= 65535) || 'Port must be an integer 1–65535'
  },
})

// confirm — boolean, default true
const useTLS = await confirm({ message: 'Use TLS?', default: true })

// password — masked input
const pw = await password({ message: 'IMAP password:', mask: true })
```

### Pattern 4: Entry.setPassword() — Synchronous Keyring Write

```typescript
// Source: node_modules/@napi-rs/keyring/index.d.ts (installed, verified)
import { Entry } from '@napi-rs/keyring'

// setPassword is synchronous (void return, throws on error)
// Contrast: AsyncEntry.setPassword() returns Promise<void>
const entry = new Entry('backmail', username)
entry.setPassword(plaintext)  // throws if keyring unavailable
// passwordRef to store in config: `keyring:service=backmail;account=${username}`
```

### Pattern 5: simple-git init() at a Specific Directory

```typescript
// Source: Context7 /steveukx/git-js
import { simpleGit } from 'simple-git'

// Initialize a new git repo at a given path
// The path must exist before calling init()
await simpleGit(archivePath).init()
// Returns: { bare: false, existing: false, path: archivePath, gitDir: `${archivePath}/.git` }
```

### Anti-Patterns to Avoid

- **Calling `findRepository()` inside `initRepository()`:** `init` creates new repos; `findRepository` walks up looking for existing ones. These are different operations. [VERIFIED: codebase — D-13 explicitly forbids this]
- **Prompting in core:** Core functions must have no readline/interactive I/O (ARCH-01). All prompts go in the CLI action handler.
- **Using `AsyncEntry` instead of `Entry`:** The sync `Entry` class is what the codebase uses in `getPasswordByRef()`. Tests mock `Entry`, not `AsyncEntry`. Use `Entry.setPassword()` (sync) to match. [VERIFIED: codebase mock in config.test.ts]
- **`process.stdin.isTTY === undefined` edge case:** In some environments (e.g., piped input, test runners), `isTTY` is `undefined` rather than `false`. The safe check is `process.stdin.isTTY !== false` for "is TTY" — but D-10 says `=== false` triggers non-TTY mode. This is deliberate: `undefined` (not piped, just no TTY flag) is treated as interactive. [VERIFIED: D-10 decision]
- **Not using `.js` extension in imports:** Project uses `module: "nodenext"` — all relative imports in `src/core/` must end with `.js` [VERIFIED: existing codebase pattern].

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Interactive CLI prompts with masking | Custom readline loop | `@inquirer/prompts` password/input/confirm | Handles raw mode, SIGINT, terminal resize, Windows compatibility |
| OS keyring write | Custom D-Bus/Keychain calls | `new Entry(service, account).setPassword()` | Platform abstraction over macOS Keychain, Windows Credential Manager, Linux Secret Service |
| Git repo initialization | `child_process.exec('git init')` | `simpleGit(path).init()` | Already in dependencies; promise-based; cross-platform path handling |
| Port number validation | Custom parse logic | `validate` callback in `input()` prompt | One-liner: `(v) => (Number.isInteger(parseInt(v,10)) && ...) || 'error msg'` |

**Key insight:** All three libraries (inquirer, keyring, simple-git) handle significant platform complexity. The only custom code needed is the coordination logic in the CLI handler and the directory/file writes in `initRepository`.

## Runtime State Inventory

> Omitted — this is a greenfield phase adding new functionality, not a rename/refactor/migration.

## Common Pitfalls

### Pitfall 1: @inquirer/prompts throws in non-TTY instead of returning
**What goes wrong:** If `process.stdin.isTTY === false` and the code calls a prompt anyway (e.g., `await input(...)`), inquirer throws a rejected promise instead of returning a default value.
**Why it happens:** `@inquirer/prompts` requires an interactive environment. [CITED: https://github.com/sboudrias/inquirer.js/blob/main/packages/inquirer/README.md — "prompts require an interactive environment where `process.stdin.isTTY` is true"]
**How to avoid:** Always check `process.stdin.isTTY !== false` before calling any prompt. The non-TTY check must happen before the first `await input(...)`.
**Warning signs:** Tests that pipe stdin or run in CI will throw `"readline was closed"` or similar instead of triggering the expected "required flag" error message.

### Pitfall 2: Entry.setPassword() throws but test mock doesn't cover it
**What goes wrong:** The `@napi-rs/keyring` mock in `config.test.ts` mocks `getPassword`, not `setPassword`. Init tests need `setPassword` mocked too, or they'll hit native code.
**Why it happens:** Phase 6 only used `getPassword`; `setPassword` was never mocked.
**How to avoid:** In `init` CLI tests, extend the mock: `{ getPassword: vi.fn(), setPassword: vi.fn() }`.
**Warning signs:** `ReferenceError: Cannot read native module` or similar in test output.

### Pitfall 3: config.json written before git init — ordering matters for restoreAccount
**What goes wrong:** If `initRepository` creates config.json but `git init` throws (e.g., git not on PATH), the repo is in a half-initialized state where `.backmail/` exists but `archive/` has no git history.
**Why it happens:** No atomic write sequence.
**How to avoid:** Run `simpleGit(archivePath).init()` first; write config.json last. Or do the REPO-04 guard first, then all directory creation, then git init, then JSON write — so if git init fails the user can re-run after fixing git (since `.backmail/` won't exist yet if we write it last).
**Warning signs:** `backmail sync` failing with "not a git repository" on a directory that has a config.json.

### Pitfall 4: `--no-tls` Commander flag produces `tls: false` not `tls: undefined`
**What goes wrong:** Commander's boolean flag pairs (`--tls` / `--no-tls`) produce a boolean `opts.tls` that is `true` by default when neither flag is passed. This is correct behavior but easy to get wrong when building the config object.
**Why it happens:** Commander's boolean flags default to the value set by `.option()` — if the default isn't specified it may be `undefined`.
**How to avoid:** Set explicit default: `.option('--tls', '...', true)` and `.option('--no-tls', '...')` — Commander handles this pair correctly, producing `opts.tls = true/false`. [ASSUMED — based on Commander documentation patterns; verify with existing `--dry-run` flag handling in restore command]
**Warning signs:** `tls` field fails Zod validation with `z.boolean()` if it ends up as `undefined`.

### Pitfall 5: targetDir path resolution for positional arg
**What goes wrong:** If the user runs `backmail init ./my-repo`, the positional is a relative path. Commander passes it as-is. If not resolved, subsequent `path.join(targetDir, '.backmail')` will create a relative path that breaks if CWD changes.
**Why it happens:** Relative paths are not automatically resolved to absolute.
**How to avoid:** `const targetDir = dirPath ? path.resolve(dirPath) : process.cwd()` — always resolve to absolute path before use.
**Warning signs:** Directory created in wrong location; `findRepository` can't find it later.

## Code Examples

### Complete keyring write + passwordRef derivation flow

```typescript
// Source: node_modules/@napi-rs/keyring/index.d.ts (VERIFIED)
import { Entry } from '@napi-rs/keyring'

// --password flag path (D-04)
function writeKeyringAndGetRef(username: string, plaintext: string): string {
  const entry = new Entry('backmail', username)
  entry.setPassword(plaintext)  // synchronous; throws on keyring failure
  return `keyring:service=backmail;account=${username}`
}

// --password-ref flag path (D-04) — no keyring interaction
function getRefDirect(ref: string): string {
  return ref  // value written as-is to config.json
}
```

### Non-TTY detection pattern

```typescript
// Source: D-10 decision + @inquirer/prompts documentation
const isTTY = process.stdin.isTTY !== false

// Collect a required param
async function requireParam(
  flagValue: string | undefined,
  promptFn: () => Promise<string>,
  flagName: string,
  isTTY: boolean
): Promise<string> {
  if (flagValue !== undefined) return flagValue
  if (!isTTY) {
    console.error(`Error: ${flagName} is required in non-TTY mode`)
    process.exit(1)
  }
  return promptFn()
}
```

### initRepository directory creation order (safe sequencing)

```typescript
// Source: pattern analysis (verified that .backmail/ check is the guard)
// Create archive/ and worktrees/ first (safe even if they exist via recursive:true)
// Then create .backmail/ last — its presence is the "repo exists" marker
// This ensures: if git init fails, re-running init will not hit REPO-04 guard
fs.mkdirSync(archivePath, { recursive: true })
fs.mkdirSync(worktreesPath, { recursive: true })
await simpleGit(archivePath).init()  // fail here → no .backmail/ yet → re-runnable
fs.mkdirSync(backmailDir, { recursive: true })
fs.writeFileSync(path.join(backmailDir, 'log'), '')
fs.writeFileSync(path.join(backmailDir, 'config.json'), JSON.stringify(configObj, null, 2))
```

**Note:** The REPO-04 guard `if (fs.existsSync(backmailDir))` runs at the top of the function before any of this. The sequencing above is for resilience, not the guard itself.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `inquirer` (legacy all-in-one) | `@inquirer/prompts` (modular ESM) | Inquirer v9+ (2022) | Named imports; pure ESM; each prompt type independently installable |
| `keytar` (archived) | `@napi-rs/keyring` | 2022–2023 | Already migrated in this project (Phase 6) |
| `Entry.getPassword()` returns `string \| null` (sync) | Same — sync Entry is still available alongside AsyncEntry | Current | `Entry` (sync) and `AsyncEntry` (async) coexist in same package; project uses sync |

**Deprecated/outdated:**
- `inquirer` v8 and below: CommonJS only, object-based prompt definitions — replaced by `@inquirer/prompts` named function exports
- `keytar`: Archived npm package — `@napi-rs/keyring` is the maintained replacement (already in project)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `process.stdin.isTTY !== false` is the correct TTY check (undefined = interactive) | Architecture Patterns: Pattern 2, Pitfall 1 | If wrong, test environment could incorrectly trigger non-TTY error path or interactive prompts; low risk since D-10 explicitly specifies `=== false` |
| A2 | `.backmail/log` should be an empty file (not a directory) | Pattern 1 code example | If log command expects different format, init would be incompatible; verify against `getLog()` in browse.ts |
| A3 | Commander `--tls`/`--no-tls` boolean pair defaults to `true` when neither flag is passed | Pitfall 4 | If Commander defaults to `undefined`, `RepositoryConfig` Zod validation will fail at init time |

**If this table is empty:** It is not empty — see A1–A3 above.

## Open Questions

1. **What does `.backmail/log` contain / does the `log` command read this file?**
   - What we know: `getLog()` in `src/core/browse.ts` uses `simpleGit(archivePath).log()` — git commit log, not the file.
   - What's unclear: Is `.backmail/log` a real file used by any command, or just a convention placeholder?
   - Recommendation: Read `src/core/browse.ts` to confirm before writing `initRepository`. If it's only a directory requirement (not a file read), `fs.mkdirSync` is sufficient. If it's a file, create it as empty string. Safe default: create as empty file.

2. **Should `initRepository` use sync fs or async fs?**
   - What we know: `loadRepositoryConfig()` in config.ts uses sync `fs.readFileSync`. `syncAccount` and `restoreAccount` are async but their internal file operations are mixed.
   - What's unclear: No strong reason either way — this is marked as Claude's Discretion.
   - Recommendation: Use sync `fs` for simplicity (no concurrency concern during init, consistent with `loadRepositoryConfig`). The function is already `async` for the `simpleGit.init()` call.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `@inquirer/prompts` engine requirement | ✓ | v24.11.1 | — |
| `@inquirer/prompts` | REPO-02 interactive prompts | ✗ (not yet installed) | 8.4.2 (latest) | — (must install) |
| `@napi-rs/keyring` | REPO-03 keyring write | ✓ | 1.3.0 | — |
| `simple-git` | REPO-01 git init | ✓ | 3.36.0 | — |
| `git` binary | `simpleGit().init()` | ✓ | (system git) | — |

**Missing dependencies with no fallback:**
- `@inquirer/prompts` — must be installed in Wave 0: `npm install @inquirer/prompts`

**Missing dependencies with fallback:**
- None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/unit/init.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REPO-01 | `initRepository()` creates `.backmail/config.json`, `.backmail/log`, `archive/`, `worktrees/` | unit | `npx vitest run tests/unit/init.test.ts` | ❌ Wave 0 |
| REPO-01 | `simpleGit(archivePath).init()` called on `archive/` directory | unit | `npx vitest run tests/unit/init.test.ts` | ❌ Wave 0 |
| REPO-02 | CLI prompts for missing params in TTY mode | unit | `npx vitest run tests/unit/init-cli.test.ts` (or within init.test.ts) | ❌ Wave 0 |
| REPO-03 | `Entry('backmail', username).setPassword(password)` called; `passwordRef = keyring:service=backmail;account=<user>` written to config | unit | `npx vitest run tests/unit/init.test.ts` | ❌ Wave 0 |
| REPO-04 | `initRepository()` throws "already exists" error when `.backmail/` exists | unit | `npx vitest run tests/unit/init.test.ts` | ❌ Wave 0 |
| REPO-05 | CLI exits with error when stdin is non-TTY and required param is missing | unit | `npx vitest run tests/unit/init-cli.test.ts` | ❌ Wave 0 |
| ARCH-01 | `src/core/init.ts` has no `process.exit`, no `console.*`, no CLI imports | unit (boundary) | `npx vitest run tests/unit/cli-boundary.test.ts` | ❌ extend existing |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/unit/init.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/init.test.ts` — covers REPO-01, REPO-03, REPO-04 (core unit tests with tmp dir)
- [ ] `tests/unit/cli-boundary.test.ts` extension — add ARCH-01 check for `src/core/init.ts`
- [ ] `@inquirer/prompts` install: `npm install @inquirer/prompts`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Port validation (1–65535 integer) in prompt `validate` callback; `parsePasswordRef` already validates ref format |
| V6 Cryptography | no (storage delegation) | `@napi-rs/keyring` handles platform-native secure storage |

### Known Threat Patterns for init command

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Password logged in process args (`--password secret`) | Information Disclosure | Document that `--password-ref env:VAR` is preferred for CI; password in flags appears in `ps aux` |
| config.json world-readable | Information Disclosure | `passwordRef` is a reference string (not the password itself); actual password stays in keyring. Config file permissions follow `fs.writeFileSync` defaults (0o666 minus umask) — acceptable. |
| Path traversal via `[path]` arg | Tampering | `path.resolve()` collapses `../` sequences; no sanitization needed beyond absolute resolution |

## Sources

### Primary (HIGH confidence)
- `node_modules/@napi-rs/keyring/index.d.ts` — `Entry.setPassword(password: string): void` verified directly from installed type definitions
- `@inquirer/prompts` npm tarball `dist/index.js` and `dist/index.d.ts` — `import { input, confirm, password } from '@inquirer/prompts'` verified as correct ESM named imports
- Context7 `/steveukx/git-js` — `simpleGit(path).init()` API verified
- Context7 `/sboudrias/inquirer.js` — `input`, `confirm`, `password` prompt APIs with validation signatures
- Existing codebase: `src/core/config.ts`, `src/core/discovery.ts`, `src/cli/index.ts`, `tests/unit/config.test.ts` — patterns for core/CLI boundary, keyring mock, module imports

### Secondary (MEDIUM confidence)
- npm registry: `@inquirer/prompts@8.4.2` requires Node.js `>=23.5.0 || ^22.13.0 || ...` — verified in tarball package.json
- `@inquirer/prompts` documentation: non-TTY environments cause promise rejection — cited from official README

### Tertiary (LOW confidence)
- Commander `--tls`/`--no-tls` boolean pair default behavior — [ASSUMED] based on established Commander patterns; verify against existing `--dry-run` usage in restore command

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified from installed type definitions, npm registry, and tarball inspection
- Architecture: HIGH — patterns derived directly from existing codebase (config.ts, cli/index.ts, config.test.ts)
- Pitfalls: MEDIUM — library behavior pitfalls cited from documentation; implementation pitfalls derived from codebase analysis

**Research date:** 2026-04-30
**Valid until:** 2026-05-30 (stable libraries; @inquirer/prompts is actively developed but API is stable)
