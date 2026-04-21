# Phase 3: Sync - Research

**Researched:** 2026-04-21
**Domain:** IMAP sync, Git operations, file I/O, TypeScript ESM
**Confidence:** HIGH

## Summary

Phase 3 implements `backmail sync [<account>]` and `backmail sync --all`. The core loop is: connect to IMAP via imapflow, list all folders, per-folder read the local `folders/<name>.json` state, fetch new messages by UID range (`${lastUid+1}:*`), write `.eml` files, mirror deletions, update the JSON, then commit the delta to git via simple-git.

The two key libraries — imapflow (CJS) and simple-git (dual ESM+CJS) — are both compatible with the project's `"type": "module"` ESM setup. imapflow uses the `require()` CJS format without an `exports` field, but Node.js allows ESM modules to `import` CJS packages via default import. simple-git ships a dedicated ESM entry (`dist/esm/index.js`) and its named export `simpleGit` works correctly in `"moduleResolution": "nodenext"` contexts.

The incremental fetch pattern is: on mailbox open, read `client.mailbox.uidValidity` and `client.mailbox.uidNext`; compare uidValidity against stored value to detect re-index events; fetch range `"${storedMaxUid + 1}:*"` with `{ uid: true }` to get only new messages; use `source: true` in the query object to get full RFC822 body. Deletion mirroring compares the set of UIDs currently on the server (via `client.search({ all: true }, { uid: true })`) against the UIDs in the local folder JSON and removes `.eml` files for UIDs no longer present.

**Primary recommendation:** One imapflow connection per account (not per folder) — open it, iterate folders with a lock-per-folder, close when done. Use simple-git scoped to `repoPath` for all git operations.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Sync all IMAP folders the server exposes by default — no opt-in needed.
- **D-02:** `--exclude-folder=<name>` flag (repeatable) to skip specific folders. `--only-folder=<name>` flag (repeatable) to restrict sync to specific folders. Both flags are mutually exclusive of each other.
- **D-03:** Folder matching supports both full IMAP path (e.g. `[Gmail]/Sent Mail`) and leaf folder name (e.g. `Sent Mail`). No wildcards or glob patterns.
- **D-04:** When `repoPath` does not contain a git repository, auto-initialize it with `git init` and print a note to stdout: `Initialized git repo at <path>`. The directory is created if it doesn't exist.
- **D-05:** Default output: one summary line per account — format: `<account>: +N added / -N removed`. Errors go to stderr.
- **D-06:** `--verbose` flag enables one log line per folder and per message.
- **D-07:** Normal sync commit: `YYYY-MM-DD: +N added / -N removed`
- **D-08:** Partial sync commit: `YYYY-MM-DD [partial]: +N added / -N removed`
- **D-09:** If sync fails mid-run and at least one message was written, commit what was fetched with the `[partial]` commit message. If nothing was fetched before failure, no commit is made.

### Claude's Discretion
- Git library choice (simple-git vs isomorphic-git vs execa + git shell) — recommend simple-git
- imapflow connection strategy (one connection per folder or one connection iterate folders)
- Fetch scope per message (full RFC822 body)
- uidvalidity change handling implementation detail (full folder re-sync per SYNC-05)
- Internal module structure within `src/core/sync.ts`

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-01 | `backmail sync [<account>]` performs incremental IMAP fetch, writes new `.eml` files, updates folder JSONs, commits a delta | imapflow UID-range fetch + simple-git add/commit |
| SYNC-02 | Sync commit message format: `YYYY-MM-DD: +N added / -N removed` | simple-git commit() with formatted string |
| SYNC-03 | Mirror IMAP deletions — emails removed from IMAP removed from working tree | Search all UIDs + set difference + fs.unlink + git add -A |
| SYNC-04 | Folder state in `folders/<name>.json` with `uidvalidity` and `{uid, message-id, flags}` array | JSON read/write per folder; schema defined in research |
| SYNC-05 | Detect uidvalidity change, trigger full folder re-sync, record in git history | Compare `client.mailbox.uidValidity` against stored value |
| SYNC-06 | `backmail sync --all` syncs all configured accounts | Iterate `config.accounts` and call sync per account |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| IMAP connection + fetch | Core (`src/core/sync.ts`) | — | Business logic — not CLI concern |
| Folder JSON state management | Core (`src/core/sync.ts`) | — | Persistence logic belongs in core |
| .eml file writing | Core (`src/core/sync.ts`) | — | Core owns the storage layer |
| Git commit | Core (`src/core/sync.ts`) | — | Must be callable programmatically (eimerjs boundary) |
| CLI flag parsing + output | CLI (`src/cli/index.ts`) | — | Thin wrapper pattern; console.* allowed only here |
| Repo init (first run) | Core (returns init message) | CLI (prints it) | Core detects + performs init; CLI prints the message |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | 1.3.2 | IMAP client — connect, list folders, fetch messages by UID range | Project-mandated choice (PROJECT.md); modern promise API |
| simple-git | 3.36.0 | Git operations — init, add, commit, status, checkIsRepo | Wraps git binary user already has; dual ESM+CJS; bundled types |

### Supporting (Node built-ins — no install needed)
| Module | Purpose |
|--------|---------|
| `node:fs/promises` | Async .eml file writes; directory creation (`mkdir recursive`) |
| `node:path` | Cross-platform path construction for messages/ and folders/ |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| simple-git | isomorphic-git | isomorphic-git is pure-JS (no git binary required) but significantly more complex API and doesn't support all git features; simple-git is simpler for this use case |
| simple-git | execa + git CLI | execa works but no typed API; simple-git provides typed CommitResult, StatusResult |

**Installation:**
```bash
npm install imapflow simple-git
```

**Version verification:** [VERIFIED: npm registry 2026-04-21]
- imapflow: 1.3.2 (latest)
- simple-git: 3.36.0 (latest)

## Architecture Patterns

### System Architecture Diagram

```
backmail sync [account] [flags]
         │
         ▼
  CLI: src/cli/index.ts
  - parse --all, --exclude-folder, --only-folder, --verbose flags
  - validate flag mutual exclusion
  - call syncAccount() per account
  - print summary to stdout; errors to stderr
         │
         ▼
  Core: src/core/sync.ts
  syncAccount(accountName, config, opts) → SyncResult
         │
         ├─ getPassword(accountName)   [config.ts]
         ├─ ensureRepo(repoPath)       [git init if needed]
         │
         ▼
  ImapFlow client.connect()
         │
         ▼
  client.list() → mailbox[]           [filter \Noselect]
         │
         ├── apply --only-folder / --exclude-folder filter
         │
         ▼
  for each folder:
    client.getMailboxLock(folder.path)
         │
         ├── read folders/<name>.json  [stored state]
         ├── compare uidValidity       → full re-sync if changed
         ├── fetch "${lastUid+1}:*" {uid:true, source:true, envelope:true}
         │     └── write messages/<messageId>.eml
         │     └── update added count
         ├── client.search({all:true}, {uid:true}) → currentUids[]
         │     └── compare vs stored UIDs → delete stale .eml files
         │     └── update removed count
         ├── write folders/<name>.json [uidvalidity, uidnext, messages[]]
         lock.release()
         │
         ▼
  client.logout()
         │
         ▼
  simple-git: add all → commit(message)
  return SyncResult { added, removed, partial }
         │
         ▼
  CLI prints: "<account>: +N added / -N removed"
```

### Recommended Project Structure
```
src/
├── core/
│   ├── index.ts          # Re-export sync() and SyncResult
│   ├── config.ts         # Existing — unchanged
│   └── sync.ts           # All sync logic (new)
├── cli/
│   └── index.ts          # Add 'sync' subcommand (thin wrapper)
tests/
├── unit/
│   └── sync.test.ts      # Unit: filename sanitization, folder matching, commit message format
├── integration/
│   └── sync.test.ts      # Integration: full sync against Dovecot container
└── fixtures/
    ├── fixture-001.eml   # Existing
    └── fixture-002.eml   # Existing
```

### Pattern 1: Incremental UID Fetch
**What:** Fetch only messages with UID >= lastStoredUid + 1
**When to use:** Every sync after the first run

```typescript
// Source: https://imapflow.com/docs/api/imapflow-client
// After getMailboxLock:
const lastUid = storedState ? Math.max(...storedState.messages.map(m => m.uid)) : 0
const range = `${lastUid + 1}:*`

for await (const msg of client.fetch(range, { uid: true, source: true, envelope: true }, { uid: true })) {
  const messageId = msg.envelope.messageId ?? generateFallbackId(msg.uid)
  const filename = sanitizeMessageId(messageId)
  await fs.writeFile(path.join(repoPath, 'messages', `${filename}.eml`), msg.source)
  // accumulate to folder state
}
```

**Note:** When `lastUid === 0` (first sync or uidvalidity re-sync), use range `'1:*'` to fetch all.

### Pattern 2: UIDVALIDITY Detection (SYNC-05)
**What:** Compare stored uidvalidity against server's `client.mailbox.uidValidity`
**When to use:** On every folder open

```typescript
// Source: https://imapflow.com/docs/api/imapflow-client (uidValidity is BigInt)
const lock = await client.getMailboxLock(folder.path)
try {
  const serverValidity = client.mailbox.uidValidity  // BigInt
  const storedValidity = folderState?.uidvalidity     // string (serialized BigInt)

  if (storedValidity && BigInt(storedValidity) !== serverValidity) {
    // Full re-sync: delete all local .eml files for this folder's UIDs,
    // reset storedState to empty, proceed with range '1:*'
    // Record the event — the updated folders/<name>.json in git IS the record
  }
} finally {
  lock.release()
}
```

**BigInt serialization:** JSON.stringify cannot serialize BigInt directly — store as string in JSON (`uidvalidity: serverValidity.toString()`).

### Pattern 3: Deletion Mirroring (SYNC-03)
**What:** Find UIDs in local state that no longer exist on server; delete their .eml files
**When to use:** After fetching new messages, before writing the updated folder state

```typescript
// Source: https://imapflow.com/docs/api/imapflow-client
const serverUids = await client.search({ all: true }, { uid: true })
const serverUidSet = new Set(serverUids)

for (const entry of storedState.messages) {
  if (!serverUidSet.has(entry.uid)) {
    const filepath = path.join(repoPath, 'messages', `${sanitizeMessageId(entry['message-id'])}.eml`)
    await fs.unlink(filepath).catch(() => {})  // tolerate already-deleted
    removedCount++
  }
}
// Filter storedState.messages to only serverUidSet members
```

### Pattern 4: imapflow Connection (ESM from CJS package)
**What:** Import imapflow (CJS) from ESM module
**When to use:** In `src/core/sync.ts`

```typescript
// Source: imapflow npm package (CJS default, no exports field)
// Node.js ESM CAN import CJS packages via default import
import { ImapFlow } from 'imapflow'

// With "moduleResolution": "nodenext", TypeScript needs type definitions.
// imapflow ships its own typings — this import works as-is.
const client = new ImapFlow({
  host: config.host,
  port: config.port,
  secure: config.tls,
  auth: { user: config.username, pass: password },
  logger: false,  // suppress pino logs in production; verbose mode sets a custom logger
})
```

### Pattern 5: simple-git Operations
**What:** Init repo if needed, stage all changes, commit
**When to use:** End of each account sync

```typescript
// Source: https://github.com/steveukx/git-js (ESM named export)
import { simpleGit } from 'simple-git'

const git = simpleGit(repoPath)

// Repo init check (D-04)
const isRepo = await git.checkIsRepo()
if (!isRepo) {
  await git.init()
  // Caller (CLI) prints "Initialized git repo at <path>"
}

// Stage and commit
const status = await git.status()
if (!status.isClean()) {
  await git.add('.')
  const date = new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
  const msg = partial
    ? `${date} [partial]: +${added} added / -${removed} removed`
    : `${date}: +${added} added / -${removed} removed`
  await git.commit(msg)
}
```

### Pattern 6: Folder Name Sanitization
**What:** Convert IMAP folder path to filesystem-safe JSON filename
**When to use:** When reading/writing `folders/<name>.json`

```typescript
// [ASSUMED] — standard approach, no specific API to cite
function folderPathToFilename(imapPath: string): string {
  // Replace path separator and filesystem-special chars
  // "[Gmail]/Sent Mail" → "[Gmail]_Sent Mail" or use full path with slash replaced
  return imapPath.replace(/[/\\:*?"<>|]/g, '_')
}
```

**Alternative:** URL-encode the path. Either works — consistency matters more than the specific scheme.

### Pattern 7: Message-ID Filename Sanitization
**What:** Derive safe `.eml` filename from RFC 2822 Message-ID header
**When to use:** When writing `messages/<messageId>.eml`

```typescript
// [ASSUMED] — derived from PROJECT.md "Message-ID as filename" decision
function sanitizeMessageId(messageId: string): string {
  // Strip angle brackets: <abc@example.com> → abc@example.com
  // Replace filesystem-unsafe chars
  return messageId
    .replace(/^<|>$/g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .slice(0, 200)  // Guard against absurdly long IDs
}

function generateFallbackId(uid: number, folderPath: string): string {
  // When Message-ID header is absent (rare but occurs)
  return `no-message-id_uid-${uid}_${folderPath.replace(/\W/g, '_')}`
}
```

### Anti-Patterns to Avoid
- **Sequence numbers instead of UIDs:** imapflow `fetch()` without `{ uid: true }` in the third argument uses sequence numbers. Sequence numbers change when messages are expunged — always use UIDs.
- **One IMAP connection per folder:** Expensive — TCP handshake and TLS per folder. Open one connection per account and iterate folders with `getMailboxLock()`.
- **Storing uidValidity as number:** BigInt exceeds JavaScript's safe integer range. Store as string in JSON, compare via `BigInt(stored) !== serverValidity`.
- **Committing empty delta:** Check `status.isClean()` before commit — git errors on empty commits. Skip commit (and print `+0 added / -0 removed`) when nothing changed.
- **process.exit() in core:** Forbidden by ARCH-01. Throw errors; let CLI catch and print.
- **console.* in core:** Forbidden. Return log entries as part of SyncResult or accept a logger callback.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IMAP protocol | Custom IMAP client | imapflow | RFC 3501 is large and complex; TLS, STARTTLS, IDLE, UID semantics all handled |
| Git operations | Shell exec strings | simple-git | Proper quoting, cross-platform paths, typed responses |
| Commit message dedup | Custom dirty-check | simple-git `status().isClean()` | Handles staged + unstaged; race-condition safe |

**Key insight:** The IMAP UID protocol has many edge cases (UIDVALIDITY resets, UID gaps, expunge ordering) — imapflow handles all of these; hand-rolling even a subset would re-introduce them.

## Common Pitfalls

### Pitfall 1: BigInt JSON Serialization
**What goes wrong:** `JSON.stringify({ uidvalidity: client.mailbox.uidValidity })` throws `TypeError: Do not know how to serialize a BigInt`.
**Why it happens:** `client.mailbox.uidValidity` is a JavaScript `BigInt` and JSON has no BigInt type.
**How to avoid:** Always convert to string before serializing: `uidvalidity: client.mailbox.uidValidity.toString()`. When comparing on next sync: `BigInt(stored.uidvalidity) !== client.mailbox.uidValidity`.
**Warning signs:** TypeError at JSON.stringify time; type-check with `typeof client.mailbox.uidValidity === 'bigint'`.

### Pitfall 2: UID Range When mailbox is Empty
**What goes wrong:** `client.search({ all: true }, { uid: true })` returns `[]` for an empty mailbox; `Math.max(...[])` returns `-Infinity`.
**Why it happens:** Spread of empty array into Math.max.
**How to avoid:** Guard: `const lastUid = messages.length > 0 ? Math.max(...messages.map(m => m.uid)) : 0`.
**Warning signs:** `Infinity` or `NaN` appearing in UID range string.

### Pitfall 3: Fetch Range `"0:*"` vs `"1:*"`
**What goes wrong:** IMAP UIDs start at 1, not 0. A range of `"0:*"` may behave unexpectedly or be rejected by some servers.
**Why it happens:** Off-by-one when `lastUid = 0`.
**How to avoid:** When `lastUid === 0`, use `'1:*'` not `'${0+1}:*'` — same result, but explicit. Condition: `const range = lastUid === 0 ? '1:*' : '${lastUid + 1}:*'`.

### Pitfall 4: `\Noselect` Folders
**What goes wrong:** Trying to `getMailboxLock('[Gmail]')` on Gmail's `[Gmail]` namespace folder throws because it is a container, not a selectable mailbox.
**Why it happens:** IMAP LIST response includes namespace containers with the `\Noselect` attribute.
**How to avoid:** Filter `client.list()` result: `mailboxes.filter(m => !m.flags.has('\\Noselect'))`.
**Warning signs:** ImapFlow throws error when opening folder with `\Noselect` flag set.

### Pitfall 5: Commit With No Changes
**What goes wrong:** `git.commit(message)` throws `nothing to commit` when the working tree is already clean.
**Why it happens:** Calling commit unconditionally even when no files changed (e.g., zero new messages and zero deletions).
**How to avoid:** Check `(await git.status()).isClean()` before calling commit; skip commit if clean.

### Pitfall 6: Missing Messages Directory
**What goes wrong:** `fs.writeFile('messages/abc.eml', ...)` throws ENOENT if the `messages/` directory doesn't exist yet (first sync).
**Why it happens:** First run against empty repo.
**How to avoid:** `await fs.mkdir(path.join(repoPath, 'messages'), { recursive: true })` and `await fs.mkdir(path.join(repoPath, 'folders'), { recursive: true })` at the start of each account sync.

### Pitfall 7: Leaf-Name Folder Matching (D-03)
**What goes wrong:** `--only-folder="Sent Mail"` should match `[Gmail]/Sent Mail` but a naive string equality check fails.
**Why it happens:** IMAP paths include namespace prefixes.
**How to avoid:** For each filter name, check BOTH `folder.path === filterName` (full path match) AND `folder.path.endsWith(delimiter + filterName)` (leaf match). Use the server's actual `delimiter` from the list response.

### Pitfall 8: imapflow logger: false Required
**What goes wrong:** imapflow defaults to pino logger which outputs JSON to stdout, polluting CLI output.
**Why it happens:** imapflow uses pino for debug logging by default.
**How to avoid:** Always pass `logger: false` in the ImapFlow constructor, or pass a custom logger in verbose mode that writes to the verbose callback.

## Code Examples

### Folder State Schema (SYNC-04)

```typescript
// Source: .planning/REQUIREMENTS.md SYNC-04 + PROJECT.md storage layout
interface FolderMessage {
  uid: number
  'message-id': string
  flags: string[]
}

interface FolderState {
  uidvalidity: string       // BigInt serialized as string
  uidnext: number           // From client.mailbox.uidNext after sync
  messages: FolderMessage[]
}
```

**File path:** `<repoPath>/folders/<sanitized-imap-path>.json`

### SyncResult Type (public API)

```typescript
// [ASSUMED] — derived from CONTEXT.md D-05, D-07, D-08, D-09
interface SyncResult {
  added: number
  removed: number
  partial: boolean
  repoInitialized: boolean  // true if git init was run (D-04)
  folderResults: FolderSyncResult[]
}

interface FolderSyncResult {
  path: string              // IMAP folder path
  added: number
  removed: number
  error?: Error             // present if this folder failed
}
```

### Full ImapFlow Client Setup

```typescript
// Source: https://imapflow.com/docs/api/imapflow-client [VERIFIED]
import { ImapFlow } from 'imapflow'
import type { AccountConfig } from './index.js'

function createImapClient(config: AccountConfig, password: string, verbose: boolean): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: {
      user: config.username,
      pass: password,
    },
    logger: false,  // suppress pino stdout pollution
  })
}
```

### Incremental Fetch Per Folder (Full Pattern)

```typescript
// Source: https://imapflow.com/docs/api/imapflow-client [VERIFIED]
async function syncFolder(
  client: ImapFlow,
  folder: ListResponse,
  repoPath: string,
  storedState: FolderState | null
): Promise<FolderSyncResult> {
  const lock = await client.getMailboxLock(folder.path)
  try {
    const serverValidity = client.mailbox.uidValidity  // BigInt

    // SYNC-05: uidvalidity change → full re-sync
    if (storedState && BigInt(storedState.uidvalidity) !== serverValidity) {
      // Clear stored state — will re-fetch all messages
      storedState = null
    }

    // Incremental fetch: only UIDs > last known
    const lastUid = storedState
      ? (storedState.messages.length > 0
          ? Math.max(...storedState.messages.map(m => m.uid))
          : 0)
      : 0
    const range = lastUid === 0 ? '1:*' : `${lastUid + 1}:*`

    const newMessages: FolderMessage[] = []
    for await (const msg of client.fetch(range, { uid: true, source: true, envelope: true }, { uid: true })) {
      const rawId = msg.envelope.messageId ?? `no-message-id_uid-${msg.uid}`
      const safeId = sanitizeMessageId(rawId)
      await fs.writeFile(path.join(repoPath, 'messages', `${safeId}.eml`), msg.source)
      newMessages.push({ uid: msg.uid, 'message-id': rawId, flags: Array.from(msg.flags) })
    }

    // SYNC-03: mirror deletions
    const serverUids = new Set(await client.search({ all: true }, { uid: true }))
    const existingMessages = storedState?.messages ?? []
    const kept = existingMessages.filter(m => serverUids.has(m.uid))
    const removed = existingMessages.filter(m => !serverUids.has(m.uid))
    for (const m of removed) {
      await fs.unlink(path.join(repoPath, 'messages', `${sanitizeMessageId(m['message-id'])}.eml`)).catch(() => {})
    }

    // Write updated folder state
    const updatedState: FolderState = {
      uidvalidity: serverValidity.toString(),
      uidnext: client.mailbox.uidNext,
      messages: [...kept, ...newMessages],
    }
    const folderFile = path.join(repoPath, 'folders', `${folderPathToFilename(folder.path)}.json`)
    await fs.writeFile(folderFile, JSON.stringify(updatedState, null, 2))

    return { path: folder.path, added: newMessages.length, removed: removed.length }
  } finally {
    lock.release()
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| imapflow CJS `require()` in `.cjs` file | `import { ImapFlow } from 'imapflow'` from ESM | Node.js 12+ | Node ESM can import CJS; no workaround needed |
| simple-git v2 (default export) | simple-git v3 named export `simpleGit` | v3.0 (2022) | Named export resolves TypeScript ESM callable issue |
| `git.add('.')` with string | `git.add(['.'])` or just `git.add('.')` | — | Both work; string is fine |

**Deprecated/outdated:**
- `import simpleGit from 'simple-git'` (default import): Causes TypeScript error in nodenext moduleResolution — use named import `{ simpleGit }` instead. [VERIFIED: GitHub issue #804]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Folder filename sanitization: replace `/\\/:\\*?"<>|/g` with `_` | Pattern 6 | Filename collision if two IMAP paths sanitize to the same string — mitigatable with a collision check |
| A2 | Message-ID fallback: `no-message-id_uid-${uid}_...` | Pattern 7 | If two messages in same folder lack Message-ID, could collide — uid makes it unique per folder |
| A3 | `SyncResult` type shape including `repoInitialized` and `folderResults[]` | Code Examples | Planner may choose different shape — these are discretionary |
| A4 | `logger: false` suppresses all pino output | Pitfall 8 | Some imapflow versions may still emit; test during integration |
| A5 | simple-git `simpleGit(path)` with path argument scopes all git ops to that directory | Pattern 5 | Confirmed by readme but not tested against the installed version in this project |

## Open Questions

1. **Flags update on existing messages**
   - What we know: `SYNC-04` stores flags per message; `SYNC-03` only handles deletions
   - What's unclear: Should flags on existing messages be updated on each sync? (e.g., `\Seen` added after first fetch)
   - Recommendation: Update flags on all messages present in both local state and server UIDs — requires fetching `{ uid: true, flags: true }` for `1:*` (just flags, not source) then merging. This is a minor addition; planner should decide scope.

2. **git user.name / user.email for commits**
   - What we know: `git commit` on a fresh `git init` requires a configured identity
   - What's unclear: Does the user's global git config cover this? On CI/headless systems it may not be set
   - Recommendation: Try commit; catch error containing `Please tell me who you are`; if thrown, re-throw with a helpful message: `Git identity not configured. Run: git config --global user.email "you@example.com"`

3. **Dovecot container: pre-seeded mailboxes for integration tests**
   - What we know: The `gmitirol/minimal-imap:v1` container starts with one user `testuser/testpass` and an empty mailbox
   - What's unclear: Can messages be pre-seeded via IMAP APPEND in test setup, or does the container support a pre-seeded Maildir mount?
   - Recommendation: Use imapflow itself in the test `beforeAll()` to APPEND fixture `.eml` files to the container — this is the pattern imapflow's own tests use and avoids Docker volume complexity.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v24.11.1 | — |
| git binary | simple-git | Yes | 2.51.0 | — |
| Docker | Integration tests | Yes | 28.3.3 | — |
| Docker Compose | Integration tests | Yes | v2.39.1 | — |
| imapflow | IMAP operations | Not installed | 1.3.2 (target) | — |
| simple-git | Git operations | Not installed | 3.36.0 (target) | — |

**Missing dependencies with no fallback:**
- `imapflow` and `simple-git` must be installed (`npm install imapflow simple-git`) — Wave 0 task.

**Missing dependencies with fallback:**
- None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Unit config | `vitest.config.ts` (covers `tests/unit/**`) |
| Integration config | `vitest.integration.config.ts` (covers `tests/integration/**`) |
| Quick run command | `npx vitest run --config vitest.config.ts` |
| Full suite command | `npm run test:integration` (starts Docker + runs integration tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-01 | Incremental fetch writes .eml files and updates folder JSON | integration | `npm run test:integration` | No — Wave 0 |
| SYNC-01 | UID range calculation (lastUid+1:*) | unit | `npx vitest run --config vitest.config.ts tests/unit/sync.test.ts` | No — Wave 0 |
| SYNC-02 | Commit message format YYYY-MM-DD: +N added / -N removed | unit | `npx vitest run --config vitest.config.ts tests/unit/sync.test.ts` | No — Wave 0 |
| SYNC-03 | Deletion mirroring removes .eml files | integration | `npm run test:integration` | No — Wave 0 |
| SYNC-04 | Folder JSON schema with uidvalidity, messages array | unit | `npx vitest run --config vitest.config.ts tests/unit/sync.test.ts` | No — Wave 0 |
| SYNC-05 | uidvalidity change triggers full re-sync | integration | `npm run test:integration` | No — Wave 0 |
| SYNC-06 | --all flag iterates all accounts | unit | `npx vitest run --config vitest.config.ts tests/unit/sync.test.ts` | No — Wave 0 |
| D-02/D-03 | --exclude-folder / --only-folder filtering + leaf match | unit | `npx vitest run --config vitest.config.ts tests/unit/sync.test.ts` | No — Wave 0 |
| D-04 | Auto git init when repo not present | unit (tmp dir) | `npx vitest run --config vitest.config.ts tests/unit/sync.test.ts` | No — Wave 0 |
| D-08/D-09 | Partial commit on mid-run failure | unit | `npx vitest run --config vitest.config.ts tests/unit/sync.test.ts` | No — Wave 0 |
| ARCH-01 | sync module importable without CLI context | unit | `npx vitest run --config vitest.config.ts tests/unit/core-api-boundary.test.ts` | Exists — needs extension |

### Sampling Rate
- **Per task commit:** `npx vitest run --config vitest.config.ts`
- **Per wave merge:** `npm run test:integration`
- **Phase gate:** Full integration suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/sync.test.ts` — covers SYNC-01 (UID calc), SYNC-02 (commit message), SYNC-04 (schema), D-02/D-03 (folder filtering), D-04 (auto-init), D-08/D-09 (partial commit)
- [ ] `tests/integration/sync.test.ts` — covers SYNC-01 (end-to-end), SYNC-03 (deletions), SYNC-05 (uidvalidity)
- [ ] Install dependencies: `npm install imapflow simple-git`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | IMAP credentials fetched via `getPassword()` from Phase 2 — already handled |
| V3 Session Management | No | No user sessions; IMAP connections are per-sync lifetime |
| V4 Access Control | No | Single-user CLI tool; no multi-tenant |
| V5 Input Validation | Yes | IMAP folder path and Message-ID used in filesystem paths — sanitize before use |
| V6 Cryptography | No | TLS managed by imapflow; no custom crypto |

### Known Threat Patterns for IMAP + filesystem

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via crafted Message-ID | Tampering | `sanitizeMessageId()` strips `/`, `..`, and special chars before writing to `messages/` |
| Path traversal via IMAP folder path | Tampering | `folderPathToFilename()` strips `/` and path chars before writing to `folders/` |
| Credential leak in verbose output | Information Disclosure | Never log password; logger: false suppresses imapflow debug which could include auth |

## Sources

### Primary (HIGH confidence)
- `/postalsys/imapflow` (Context7) — mailbox lock, fetch, list, uidValidity, uidNext, source field, Noselect filter
- https://imapflow.com/docs/api/imapflow-client — fetch() range syntax, uid: true option, uidValidity BigInt type
- https://imapflow.com/docs/guides/mailbox-management — Noselect detection, list() response structure
- https://github.com/steveukx/git-js/blob/main/simple-git/typings/simple-git.d.ts — init, add, commit, status, checkIsRepo signatures
- npm registry (2026-04-21) — imapflow@1.3.2, simple-git@3.36.0

### Secondary (MEDIUM confidence)
- https://imapflow.com/docs/guides/fetching-messages — uid: true in third argument position confirmed
- https://github.com/steveukx/git-js/issues/804 — confirmed named import `{ simpleGit }` resolves TypeScript ESM callable issue

### Tertiary (LOW confidence)
- None — all critical claims verified with official sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm registry verified; both libraries actively maintained
- Architecture: HIGH — imapflow API verified via Context7 and official docs; patterns follow documented examples
- Pitfalls: HIGH — BigInt JSON, Noselect, and simple-git default import issues are all confirmed via official sources
- Test patterns: HIGH — existing test infrastructure reviewed in source; gaps explicitly listed

**Research date:** 2026-04-21
**Valid until:** 2026-07-21 (stable libraries, 90-day horizon)
