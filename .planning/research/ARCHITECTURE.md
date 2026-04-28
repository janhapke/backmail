# Architecture Research: Repository-Centric v1.1

**Project:** backmail
**Researched:** 2026-04-28
**Mode:** Architecture Integration
**Confidence:** HIGH

## Executive Summary

The transition from central `~/.config/backmail/config.json` to per-repository `.backmail/config.json` requires three new architecture layers:

1. **Repository Discovery** (CLI-owned) — Walk up the filesystem tree looking for `.backmail/` directory
2. **Config Loading** (Core-owned) — Parse repository-local `config.json` with new `passwordRef` format
3. **Password Resolution** (Core-owned, existing) — Extend `getPassword()` to handle `passwordRef` strings

The key insight: **Repository discovery is CLI-scoped** (it depends on CWD and --workdir flags), but **config parsing and credential lookup are Core functions** (they're stateless, testable, and needed by Electron later). The split maintains ARCH-01 and ARCH-02 boundaries while adding the plumbing for git-style repo detection.

---

## Architecture Changes Required

### Current State (v1.0)

```
CLI Layer (src/cli/index.ts)
  ├─ Receives command-line arguments
  └─ Calls loadConfig() → Zod schema validates global config
       └─ Returns BackmailConfig with .accounts[] map
          └─ Core functions receive config.accounts[name]

Core Layer (src/core/)
  ├─ config.ts: loadConfig(), getPassword()
  ├─ sync.ts, browse.ts, restore.ts: Accept AccountConfig objects
  └─ No knowledge of repository filesystem structure
```

### New State (v1.1)

```
CLI Layer (src/cli/index.ts)
  ├─ Parses --workdir global flag
  ├─ Calls findRepositoryRoot(cwd | workdir)
  │  └─ Walks up looking for .backmail/ directory
  ├─ Calls loadRepositoryConfig(repoRoot) → Zod schema validates repo config
  │  └─ Returns RepositoryConfig with single account config
  └─ Calls resolvePassword(config.passwordRef) → extracts credentials

Core Layer (src/core/)
  ├─ config.ts: Adds parsePasswordRef() and enhanced getPassword()
  │  └─ Handles both old format (plain password field) and new (passwordRef)
  ├─ repository.ts (NEW): Repository-agnostic config parsing
  │  └─ loadRepositoryConfig(repoRoot) — no CWD access
  └─ Passes resolved credentials + config to sync/browse/restore functions
```

---

## New Components Detailed

### 1. Repository Discovery: `findRepositoryRoot(cwd?: string): string`

**Location:** `src/cli/repository.ts` (CLI-only, not core)

**Purpose:** Git-style walk-up detection of `.backmail/` directory marker

**Signature:**
```typescript
export function findRepositoryRoot(startPath?: string): string {
  // startPath defaults to process.cwd()
  // Walks up from startPath looking for .backmail/
  // Throws if not found with helpful message
}
```

**Behavior:**
- Starts at `startPath` (default: `process.cwd()`)
- Checks for `.backmail/` directory
- If not found, walks up to parent
- Throws `RepoNotFound` error if reaches filesystem root
- Returns absolute path to repository root (the directory containing `.backmail/`)

**Example Flow:**
```
User runs: cd /home/jan/mail/gmail && backmail sync
startPath = /home/jan/mail/gmail
findRepositoryRoot(/home/jan/mail/gmail)
  → Check /home/jan/mail/gmail/.backmail/ ✗
  → Check /home/jan/mail/.backmail/ ✓
  → Return /home/jan/mail/
```

**Constraint:** Lives in CLI layer because it accesses `process.cwd()` and uses `--workdir` override. Core functions receive the discovered path as an argument.

**Why NOT in core:** Repository discovery is inherently tied to the process working directory, which core functions should not depend on. Electron will have a different discovery mechanism (file dialog, workspace config).

---

### 2. Repository Config Loading: `loadRepositoryConfig(repoRoot: string): RepositoryConfig`

**Location:** `src/core/repository.ts` (NEW, core-owned)

**Purpose:** Load and validate `.backmail/config.json` from a discovered repository

**New Types:**
```typescript
// src/core/index.ts
export interface RepositoryConfig {
  host: string
  port: number
  username: string
  tls: boolean
  passwordRef: string  // NEW: "keyring:service=X;account=Y" or "env:VAR_NAME"
  // archive/ path is derived (repoRoot + '/archive/')
}

// Extends old AccountConfig which will be deprecated in v1.1
// Old config.accounts[name] becomes new RepositoryConfig
```

**Zod Schema:**
```typescript
// src/core/repository.ts
const RepositoryConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  tls: z.boolean(),
  passwordRef: z.string().min(1),
  // passwordRef examples: "keyring:service=backmail;account=user@gmail.com"
  //                       "env:BACKMAIL_PASSWORD"
})
```

**Function Signature:**
```typescript
export async function loadRepositoryConfig(
  repoRoot: string
): Promise<RepositoryConfig> {
  // Reads repoRoot + '/.backmail/config.json'
  // Parses and validates with Zod
  // Throws with helpful message on missing/invalid file
  // Returns RepositoryConfig object
}
```

**Differences from old loadConfig():**
- Takes an explicit `repoRoot` parameter (no process.cwd() dependency)
- Loads from `.backmail/config.json` instead of global config dir
- Returns single `RepositoryConfig` instead of map of accounts
- Includes new `passwordRef` field

---

### 3. Password Reference Parser: `parsePasswordRef(ref: string): { type: 'keyring' | 'env'; service?: string; account?: string; envVar?: string }`

**Location:** `src/core/config.ts` (extend existing)

**Purpose:** Parse `passwordRef` string into actionable credential lookup instructions

**Format Spec:**
```
keyring:service=<service>;account=<account>
env:<VAR_NAME>
```

**Examples:**
```
"keyring:service=backmail;account=user@gmail.com"
"keyring:service=backmail;account=jan"
"env:BACKMAIL_PASSWORD"
"env:MY_CUSTOM_VAR"
```

**Parser Function:**
```typescript
export interface PasswordRef {
  type: 'keyring' | 'env'
  service?: string    // For keyring only
  account?: string    // For keyring only
  envVar?: string     // For env only
}

export function parsePasswordRef(ref: string): PasswordRef {
  if (ref.startsWith('keyring:')) {
    const params = new URLSearchParams(ref.slice(8))
    return {
      type: 'keyring',
      service: params.get('service') ?? undefined,
      account: params.get('account') ?? undefined,
    }
  } else if (ref.startsWith('env:')) {
    return {
      type: 'env',
      envVar: ref.slice(4),
    }
  }
  throw new Error(`Invalid passwordRef format: ${ref}. Expected 'keyring:...' or 'env:...'`)
}
```

**Robustness:** URLSearchParams handles semicolon parsing correctly. Backwards compatible: old config.json can be migrated by writing passwordRef during init.

---

### 4. Enhanced Password Resolution: `getPassword(passwordRef: string): Promise<string>`

**Location:** `src/core/config.ts` (extend existing)

**Purpose:** Resolve passwordRef to actual password from keyring or env var

**Current Signature (v1.0):**
```typescript
export async function getPassword(accountName: string): Promise<string>
  // Looks up 'backmail' service, accountName in keyring
  // Fallback: BACKMAIL_<ACCOUNTNAME>_PASSWORD env var
```

**New Signature (v1.1):**
```typescript
export async function getPassword(passwordRef: string): Promise<string>
  // Parses passwordRef
  // If keyring: looks up service and account in keyring
  // If env: returns process.env[envVar]
  // Throws if not found in either
```

**Decision:** Overload or rename?
- **Recommendation: Keep both functions**, add `getPasswordByRef()` as new function
- `getPassword(accountName)` stays for backward compatibility (used by old config loader)
- `getPasswordByRef(passwordRef)` is the new v1.1 function
- Or: Add optional type parameter to `getPassword()` to detect which format was passed

**Implementation Pattern:**
```typescript
export async function getPasswordByRef(passwordRef: string): Promise<string> {
  const parsed = parsePasswordRef(passwordRef)
  
  if (parsed.type === 'keyring') {
    // Same keyring logic as before
    const entry = new Entry(parsed.service!, parsed.account!)
    const password = entry.getPassword() // handles Promise/sync
    if (password) return password
    // Fallback to env var derived from service+account
  }
  
  if (parsed.type === 'env') {
    const envValue = process.env[parsed.envVar!]
    if (envValue) return envValue
  }
  
  throw new Error(`No credential found for passwordRef: ${passwordRef}`)
}
```

---

### 5. Archive Path Derivation

**Question:** How does `archive/` get derived from repo root?

**Answer:** It's always a relative path.

```typescript
// In every core function that needs the git repo:
const archivePath = path.join(repoRoot, 'archive')

// Before: config.accounts[name].repoPath held the git repo path directly
// After: archivePath is derived from repoRoot at call time
```

**Why:** Keeps `.backmail/` and `archive/` outside version control naturally. The `.backmail/config.json` references only itself (implicitly at its own directory); the git repo is always assumed to be at `<repoRoot>/archive/`.

**Layout:**
```
/home/jan/mail/gmail/
  ├── .backmail/
  │   ├── config.json          (host, port, username, tls, passwordRef)
  │   └── log                  (future: sync journal)
  ├── archive/                 (git repo — .gitignore excludes .backmail + worktrees)
  │   ├── .git/
  │   ├── messages/
  │   ├── folders/
  │   └── .gitignore
  └── worktrees/               (checked out via git worktree)
      ├── 2024-01-15/
      └── 2024-02-20/
```

---

## Integration Points

### Flow 1: User runs `backmail sync`

```
cli/index.ts (CLI layer)
├─ Parse --workdir flag (if present)
├─ cwd = --workdir || process.cwd()
├─ repoRoot = findRepositoryRoot(cwd)
│  └─ Returns /home/jan/mail/gmail/
├─ config = await loadRepositoryConfig(repoRoot)
│  ├─ Reads /home/jan/mail/gmail/.backmail/config.json
│  └─ Returns RepositoryConfig { host, port, username, tls, passwordRef }
├─ password = await getPasswordByRef(config.passwordRef)
├─ Call core.syncAccount({
│    host: config.host,
│    port: config.port,
│    username: config.username,
│    tls: config.tls,
│    password: password,          // NEW: password resolved before core
│    archivePath: path.join(repoRoot, 'archive')
│  })
└─ Print results
```

**Key change:** CLI now passes resolved `password` string to sync, rather than asking core to fetch it.

---

### Flow 2: User runs `backmail view <message-id>`

```
cli/index.ts
├─ repoRoot = findRepositoryRoot()
├─ config = await loadRepositoryConfig(repoRoot)
├─ Call core.viewMessage({
│    archivePath: path.join(repoRoot, 'archive'),
│    messageId: '<message-id>',
│    format: 'plaintext'
│  })
└─ Print result
```

**Note:** `viewMessage()` only needs `archivePath` (read-only filesystem access), not credentials.

---

### Flow 3: User runs `backmail init`

```
cli/index.ts (new init command)
├─ Prompt for: host, port, username, tls, password (interactively)
├─ (Or accept all as --flags for automation)
├─ Create directory structure:
│    repoRoot/.backmail/
│    repoRoot/archive/
│    repoRoot/worktrees/
├─ Store password in keyring:
│    Entry('backmail', username).setPassword(password)
├─ Write repoRoot/.backmail/config.json:
│    {
│      "host": "imap.gmail.com",
│      "port": 993,
│      "username": "jan@gmail.com",
│      "tls": true,
│      "passwordRef": "keyring:service=backmail;account=jan@gmail.com"
│    }
├─ Initialize git repo at repoRoot/archive/
└─ Create initial commit: "Initial repository"
```

**Init is CLI-only** (interactive prompting, filesystem operations) with one core helper: `initRepository(repoRoot, config)` to set up git and directory structure.

---

## Core vs CLI Responsibility Matrix

| Task | v1.0 | v1.1 | Owner | Reason |
|------|------|------|-------|--------|
| Detect .backmail/ directory | N/A | ✓ | CLI | Depends on CWD; Electron will replace with file dialog |
| Parse global config path | ✓ | ✗ | N/A | Deleted; replaced by repo-local config |
| Read .backmail/config.json | N/A | ✓ | Core | Stateless, testable, no CWD dependency |
| Validate config with Zod | ✓ | ✓ | Core | Reusable across CLI/Electron |
| Parse passwordRef string | N/A | ✓ | Core | Stateless parser; used by multiple callers |
| Look up password in keyring | ✓ | ✓ | Core | Stateless; testable with mocked keyring |
| Handle env var fallback | ✓ | ✓ | Core | Same logic; passwordRef makes it explicit |
| Print error messages | ✓ | ✓ | CLI | Only CLI should console.error() |
| Exit on error | ✓ | ✓ | CLI | Only CLI should process.exit() |

---

## Build Order Suggestion

Given that `--workdir` must work for all existing commands and the new `init` command, this is the recommended build sequence:

### Phase 1: Core Infrastructure (no tests pass yet, but structure is in place)

**Step 1.1: Create `src/core/repository.ts`**
- Define `RepositoryConfig` interface
- Implement `loadRepositoryConfig(repoRoot: string)` with Zod schema
- Add to `src/core/index.ts` exports
- Tests: Unit tests for Zod validation, error cases

**Step 1.2: Extend `src/core/config.ts`**
- Add `parsePasswordRef(ref: string)` function
- Add `getPasswordByRef(passwordRef: string)` function
- Keep `getPassword(accountName)` for backward compatibility
- Tests: Unit tests for passwordRef parsing, keyring + env fallback

**Why first:** These are pure functions with no CLI dependencies. They can be tested in isolation. Later CLI code depends on them.

---

### Phase 2: CLI Repository Detection (in `src/cli/index.ts`)

**Step 2.1: Add global `--workdir` flag**
```typescript
program
  .option('--workdir <path>', 'override repository root detection')
```

**Step 2.2: Create `findRepositoryRoot(startPath?: string): string`**
- Implement walk-up logic
- Place in `src/cli/repository.ts` (helper module)
- Used by all commands

**Step 2.3: Update all command handlers**
Replace:
```typescript
const config = getConfig()  // Old: loads global config
const accountConfig = config.accounts[accountName]
```

With:
```typescript
const repoRoot = findRepositoryRoot(opts.workdir)
const config = await loadRepositoryConfig(repoRoot)
const password = await getPasswordByRef(config.passwordRef)
```

**Why second:** Builds on core infrastructure; affects all commands. Each command must be updated to pass the new parameters.

---

### Phase 3: Verify Existing Commands Work

Update `sync`, `log`, `checkout`, `ls`, `view`, `restore` subcommands to:
1. Use `findRepositoryRoot()` → `--workdir` override
2. Call `loadRepositoryConfig()` for the single repo config
3. Pass `archivePath: path.join(repoRoot, 'archive')` instead of `repoPath` from config

**Tests:** Existing integration tests should pass after this. May need minor fixture adjustments.

---

### Phase 4: Implement `backmail init`

**Step 4.1: Create `src/cli/init-command.ts`**
- Interactive prompts for host, port, username, TLS, password
- Or all as --flags for automation

**Step 4.2: Create helper `src/core/init.ts`**
```typescript
export async function initRepository(
  repoRoot: string,
  config: RepositoryConfig
): Promise<void> {
  // Create .backmail/ directory
  // Write config.json
  // Initialize git repo at archive/
  // Create .gitignore
  // Create initial commit
}
```

**Step 4.3: Wire init into CLI**
```typescript
program
  .command('init [path]')
  .description('Create a new backmail repository')
  .option('--host <host>', 'IMAP host')
  .option('--port <port>', 'IMAP port')
  // ... more flags
  .action(async (path, opts) => {
    const repoRoot = path || process.cwd()
    const config = opts.interactive ? await promptForConfig() : buildConfigFromFlags(opts)
    await initRepository(repoRoot, config)
  })
```

**Tests:** Unit tests for initRepository; integration tests for full `backmail init` flow.

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CLI Layer (src/cli/index.ts)                    │
│                                                                     │
│  Command Handler                                                    │
│  ├─ Parse --workdir flag                                           │
│  ├─ repoRoot = findRepositoryRoot(--workdir || cwd)               │
│  │   └─ Walks up looking for .backmail/                           │
│  └─ await loadRepositoryConfig(repoRoot)                          │
│     └─ Returns RepositoryConfig with passwordRef                  │
│                                                                     │
│  password = await getPasswordByRef(config.passwordRef)            │
│  │  └─ Parses "keyring:..." or "env:..." format                   │
│  │  └─ Looks up in keyring or process.env                         │
│  │                                                                  │
│  archivePath = path.join(repoRoot, 'archive')                     │
│                                                                     │
│  Call core function with:                                          │
│  {                                                                  │
│    host, port, username, tls,                                      │
│    password (resolved),                                            │
│    archivePath                                                      │
│  }                                                                  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│                      Core Layer (src/core/)                         │
│                                                                     │
│  syncAccount(config, password, archivePath, opts)                  │
│  ├─ Connect to IMAP server (host, port, username, password, tls)  │
│  ├─ Fetch messages into archivePath/messages/                     │
│  ├─ Update archivePath/folders/*.json                             │
│  ├─ Git commit in archivePath                                      │
│  └─ Return SyncResult                                              │
│                                                                     │
│  (Similar flow for viewMessage, checkoutCommit, restoreAccount)   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

### Decision 1: `--workdir` as Global Flag

**Question:** Should `--workdir` be global (affects all commands) or per-command?

**Decision:** Global flag.

**Rationale:**
- Git-like: `git --work-tree=<path> <command>`
- Makes sense: all commands operate on the same repo
- Avoids flag repetition: `backmail --workdir X sync; backmail --workdir X log`
- Commander.js pattern: `program.option()` before `.command()`

```typescript
program.option('--workdir <path>', 'override repository root')

program.command('sync').action(async (opts) => {
  const repoRoot = findRepositoryRoot(opts.parent?.workdir)
  // ...
})
```

---

### Decision 2: Separate `getPasswordByRef()` vs Overload `getPassword()`

**Question:** Should we overload `getPassword()` to handle both old and new formats, or add a new function?

**Decision:** Add `getPasswordByRef()` as a new function; keep `getPassword(accountName)` for backward compatibility.

**Rationale:**
- `getPassword(accountName)` is used in old config loader; some external code may call it directly
- `getPasswordByRef()` is the new v1.1 pattern; explicit name signals the change
- No breaking change for existing usage
- Tests can cover both functions independently

```typescript
// Old (still supported):
const password = await getPassword('jan@gmail.com')

// New (v1.1):
const password = await getPasswordByRef('keyring:service=backmail;account=jan@gmail.com')
```

---

### Decision 3: CLI-Only Repository Discovery

**Question:** Should `findRepositoryRoot()` live in core or CLI?

**Decision:** CLI-only (`src/cli/repository.ts`).

**Rationale:**
- Depends on `process.cwd()` (Node.js specific)
- Depends on `--workdir` flag parsing (CLI concern)
- Electron will need a different discovery mechanism (file dialog)
- Core functions receive the discovered path as input, not responsible for finding it

**Future:** When Electron support arrives, it can call core functions with a path selected by the user, without needing to change core code.

---

### Decision 4: `archivePath` vs `repoPath`

**Question:** Should we rename `repoPath` to `archivePath` in AccountConfig?

**Decision:** Yes, rename; it's clearer.

**Rationale:**
- Old name was confusing: is it the repo root or the git repo?
- New name is explicit: path to the `archive/` directory (the git repo)
- Consistency: new code uses `archivePath = path.join(repoRoot, 'archive')`

**Migration:** Update type definition; existing tests will need minor fixes.

---

### Decision 5: Backward Compatibility with Old Config Format

**Question:** Should v1.1 support reading old `~/.config/backmail/config.json` files with `repoPath` instead of `passwordRef`?

**Decision:** No; v1.1 is a breaking change. Users must run `backmail init` to create the new structure.

**Rationale:**
- Migration is non-destructive: existing `.eml` files and git repos are not deleted
- `init` command handles the conversion
- Keeping both config formats adds test burden and confusion
- v1.1 is a user-facing change (new UX); users expect to reconfigure

**Exception:** If a user has `~/.config/backmail/config.json` from v1.0, they can manually migrate:
```bash
cd /path/to/repo
backmail init --host ... --port ... --username ... --tls true  # Recreates .backmail/config.json
```

Or we provide a migration script (defer to v1.1 patch if needed).

---

## Type Changes Summary

### Before (v1.0)
```typescript
// src/core/config.ts
export interface AccountConfig {
  host: string
  port: number
  username: string
  tls: boolean
  repoPath: string  // ← Git repo path (e.g., /home/jan/mail/gmail/.git)
}

export interface BackmailConfig {
  accounts: Record<string, AccountConfig>  // Named accounts
}

export async function getPassword(accountName: string): Promise<string>
```

### After (v1.1)
```typescript
// src/core/repository.ts (NEW)
export interface RepositoryConfig {
  host: string
  port: number
  username: string
  tls: boolean
  passwordRef: string  // "keyring:service=X;account=Y" or "env:VAR"
}

// src/core/config.ts
export interface PasswordRef {
  type: 'keyring' | 'env'
  service?: string
  account?: string
  envVar?: string
}

export function parsePasswordRef(ref: string): PasswordRef
export async function getPasswordByRef(passwordRef: string): Promise<string>

// Deprecated but still available for backward compatibility:
export async function getPassword(accountName: string): Promise<string>
```

### CLI Integration Changes
```typescript
// Before (v1.0)
const config = loadConfig()  // → BackmailConfig with accounts{}
const accountConfig = config.accounts[accountName]
const password = await getPassword(accountName)

// After (v1.1)
const repoRoot = findRepositoryRoot(opts.workdir)
const config = await loadRepositoryConfig(repoRoot)  // → RepositoryConfig
const password = await getPasswordByRef(config.passwordRef)
const archivePath = path.join(repoRoot, 'archive')

// Pass to sync:
await syncAccount(
  {
    host: config.host,
    port: config.port,
    username: config.username,
    tls: config.tls,
    password,      // NEW: password already resolved
    archivePath    // NEW: derived path instead of repoPath
  },
  opts
)
```

---

## Testing Strategy

### Unit Tests (no filesystem, no keyring)

**`tests/unit/repository.test.ts`**
- Zod schema validation (valid, missing field, invalid field)
- loadRepositoryConfig() error cases (missing file, invalid JSON, invalid schema)

**`tests/unit/config.test.ts` (extend existing)**
- `parsePasswordRef()` with valid formats
- `parsePasswordRef()` with invalid formats
- `getPasswordByRef()` with mocked keyring + env var

**`tests/unit/cli-repository.test.ts`**
- `findRepositoryRoot()` walk-up logic
- `findRepositoryRoot()` error case (not found)
- `findRepositoryRoot()` with override path

### Integration Tests (full CLI flow, Docker IMAP server)

**`tests/integration/cli-repository.test.ts`**
- `backmail init --host ... --port ... --username ... --tls` creates proper directory structure
- `backmail --workdir <path> sync` finds repo correctly
- `backmail sync` with CWD inside repo walks up correctly
- Password fetched from keyring during sync
- Password fetched from env var fallback during sync

**Existing tests (update fixtures as needed)**
- `tests/integration/sync.test.ts` — Update to use new config format
- `tests/integration/cli-browse.test.ts` — Update to find repo root first
- `tests/integration/restore.test.ts` — Update to use new config format

---

## Pitfalls and Mitigations

### Pitfall 1: CWD-Dependent Code Leaks into Core

**Risk:** Core function accidentally uses `process.cwd()`, breaks in Electron.

**Mitigation:**
- `src/core/` has no CLI imports
- `findRepositoryRoot()` is CLI-only, never imported by core
- Core functions receive absolute paths as arguments
- Unit test: verify core modules don't import CLI
- Lint rule: forbid `process.cwd()` in src/core/ (eslint-plugin-no-process-env)

---

### Pitfall 2: passwordRef Format Mismatch

**Risk:** User writes passwordRef manually, typo breaks credential lookup.

**Mitigation:**
- `init` command generates passwordRef; users never type it
- `parsePasswordRef()` has clear error messages
- Validation in Zod schema catches invalid formats early
- Documentation with examples

---

### Pitfall 3: Electron IPC Boundary Breakage

**Risk:** CLI layer changes don't carry through to Electron IPC later.

**Mitigation:**
- Core functions are IPC-boundary-safe by design
- `src/core/index.ts` is the IPC contract; changes are documented
- Tests verify no CLI imports in core
- Architecture comments in code (ARCH-01, ARCH-02)

---

### Pitfall 4: Windows Path Separators in passwordRef

**Risk:** User manually writes passwordRef with wrong format on Windows.

**Mitigation:**
- `init` command generates passwordRef; no manual entry
- Path separators not used in passwordRef (only `keyring:` and `env:` formats)
- Non-issue since format is auto-generated

---

### Pitfall 5: Migration from v1.0 Config Incomplete

**Risk:** User has old global config, tries to use new commands without `init`.

**Mitigation:**
- Clear error message from `findRepositoryRoot()`: "No .backmail/ directory found. Run `backmail init` to create a new repository."
- Migration guide in README
- Optional: `backmail migrate` command (future)

---

## Summary Table: Integration Checklist

| Task | Owner | File(s) | Depends On | Testing |
|------|-------|---------|-----------|---------|
| Define RepositoryConfig | Core | `src/core/repository.ts` | None | Unit: Zod validation |
| Implement loadRepositoryConfig() | Core | `src/core/repository.ts` | RepositoryConfig | Unit: error cases; Integration: real .backmail/config.json |
| parsePasswordRef() | Core | `src/core/config.ts` | None | Unit: valid/invalid formats |
| getPasswordByRef() | Core | `src/core/config.ts` | parsePasswordRef() | Unit: keyring + env fallback |
| findRepositoryRoot() | CLI | `src/cli/repository.ts` | None | Unit: walk-up logic |
| Add --workdir global flag | CLI | `src/cli/index.ts` | None | Unit: flag parsing |
| Update sync command | CLI | `src/cli/index.ts` | findRepositoryRoot, loadRepositoryConfig | Integration: full sync flow |
| Update log command | CLI | `src/cli/index.ts` | findRepositoryRoot, loadRepositoryConfig | Integration: log output |
| Update checkout command | CLI | `src/cli/index.ts` | findRepositoryRoot, loadRepositoryConfig | Integration: worktree creation |
| Update ls command | CLI | `src/cli/index.ts` | findRepositoryRoot, loadRepositoryConfig | Integration: list messages |
| Update view command | CLI | `src/cli/index.ts` | findRepositoryRoot, loadRepositoryConfig | Integration: message display |
| Update restore command | CLI | `src/cli/index.ts` | findRepositoryRoot, loadRepositoryConfig | Integration: restore flow |
| Implement init command | CLI | `src/cli/init-command.ts` + `src/core/init.ts` | loadRepositoryConfig | Integration: directory creation, keyring setup |

---

## Open Questions for Phase-Specific Research

1. **Should `.backmail/log` file exist?** (mentioned in PROJECT.md but not yet implemented)
   - Purpose: Sync journal / history metadata?
   - Or is git log sufficient?
   - Defer to Phase 4+ if needed.

2. **How should `archive/.gitignore` be initialized?**
   - Need to exclude `.worktrees/`?
   - Or keep `worktrees/` outside git entirely (current plan)?
   - Confirm in init implementation.

3. **Should users be able to override passwordRef at runtime?**
   - E.g., `BACKMAIL_PASSWORD` env var always takes precedence?
   - Or strict interpretation of passwordRef?
   - Current design: passwordRef is the source of truth; init handles the setup.

4. **How to handle password changes?**
   - User changes IMAP password in Gmail; keyring is stale
   - Provide `backmail config update-password` command?
   - Or tell user to delete keyring entry and run `init` again?
   - Defer to v1.1+ UX research.

---

## Conclusion

The v1.1 architecture cleanly separates repository discovery (CLI-owned, CWD-dependent) from repository configuration and credential management (Core-owned, testable, future-proof for Electron). The `--workdir` flag threads through all commands, enabling git-like `backmail --workdir <path> <command>` usage. The passwordRef format is extensible and self-documenting, supporting both keyring and env var credential sources. No breaking changes to core module boundaries; ARCH-01 and ARCH-02 remain enforced.

**Recommended first step:** Implement `src/core/repository.ts` with `loadRepositoryConfig()` and extend `src/core/config.ts` with `parsePasswordRef()` and `getPasswordByRef()`. These are pure functions with no external dependencies and serve as the foundation for CLI updates.
