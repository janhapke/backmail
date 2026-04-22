# Phase 5: Restore - Research

**Researched:** 2026-04-22
**Domain:** IMAP message restoration and duplicate checking
**Confidence:** HIGH

## Summary

Phase 5 implements `backmail restore [<date|commit>] --to <imap-url>` — a command that re-uploads messages from a backup checkout to a target IMAP server with duplicate-checking and dry-run support. The phase depends entirely on Phase 4's `checkoutCommit()` function and Phase 3's storage format (`.eml` files and `folders/*.json` metadata). All IMAP operations use the existing `imapflow` library (already in package.json v1.3.2). No new external dependencies are required.

The implementation is straightforward: parse the target URL, create an ImapFlow connection to the target server, CREATE missing folders, and APPEND each message with optional SEARCH-based duplicate checking. This is the inverse of sync — reading from the local filesystem and writing to a remote IMAP server.

**Primary recommendation:** Implement restore in three focused tasks: (1) dependencies + test stubs, (2) core `restoreAccount()` function with IMAP operations and duplicate checking, (3) CLI subcommand and integration tests. The URL parsing uses Node.js's built-in `URL` constructor for safety. Dry-run skips all writes and duplicate checks for advisory output.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 through D-19 in 05-CONTEXT.md § Implementation Decisions:**
- Command signature: `backmail restore [<date|commit>] --to <imap-url>` with optional `--account <name>` flag
- When `<date|commit>` absent, restore reads from main repo at HEAD; when present, calls `checkoutCommit()` to create worktree
- URL format: `imap://user:pass@host:port` or `imaps://user:pass@host:port`; password embedded, no separate `--password` flag
- `--skip-duplicates=yes` (default): check target folder for existing Message-ID before APPEND via SEARCH command
- `--skip-duplicates=no`: upload without checking (faster for empty mailboxes)
- `--dry-run`: output without writes; skip duplicate checks for simplicity (dry-run is advisory, not exact)
- Output format: one line per folder (`INBOX: 143 uploaded, 2 skipped`); `--verbose` adds per-message lines (`  ↳ <message-id>`)
- On error: continue, accumulate error count, exit non-zero; include hint to re-run with `--skip-duplicates=yes`
- Folder creation: CREATE missing folders on target before appending messages

### Claude's Discretion

- IMAP URL parsing implementation (Node.js `URL` constructor or manual regex)
- Whether duplicate check uses ImapFlow `search()` or `fetchOne()` — whichever is simpler
- Exact column width / alignment in verbose message lines
- Whether to reuse the same ImapFlow connection per folder or reconnect per folder

### Deferred Ideas (OUT OF SCOPE)

- None — discussion stayed within phase scope

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REST-01 | `backmail restore --to <imap-url>` uploads messages from checkout to target server | Core restore module implements APPEND over ImapFlow connection; CLI subcommand wires --to option |
| REST-02 | `--skip-duplicates=yes` (default) checks Message-ID against target before APPEND | SEARCH HEADER Message-ID operation; skips on match |
| REST-03 | `--dry-run` prints what would be uploaded without connecting for writes | Dry-run flag skips APPEND, SEARCH, and CREATE operations; outputs same format as live run |
| REST-04 | Restore preserves folder structure on target server | CREATE command called for each folder in folders/*.json before APPEND |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| URL parsing | Backend / Core | — | Parse target connection URL; belongs in core module for consistency |
| IMAP connection (target) | Backend / Core | — | Open ImapFlow client to target server; all IMAP operations in core |
| Folder creation | Backend / Core | — | CREATE missing folders on target; part of core restore logic |
| Message enumeration | Backend / Core | — | Read folders/*.json and messages/*.eml from local filesystem; core responsibility |
| Duplicate checking | Backend / Core | — | SEARCH target folder for Message-ID; core responsibility for correctness |
| Message append | Backend / Core | — | APPEND each message to target folder; core responsibility |
| Dry-run handling | Backend / Core | — | Suppress all writes in core layer; CLI respects `--dry-run` flag |
| CLI output formatting | CLI Layer | — | Format and print per-folder/per-message lines; CLI responsibility per ARCH-02 |
| Error handling | Shared | — | Core throws errors; CLI prints and exits; shared responsibility model |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | 1.3.2 | IMAP client for target server operations | [VERIFIED: npm registry] Already in package.json v1.3.2; used for sync (Phase 3); supports APPEND, SEARCH, CREATE, modern IMAP4rev1 |
| simple-git | 3.36.0 | Git worktree and repo management | [VERIFIED: npm registry] Already in package.json; reuse checkoutCommit() from Phase 4; stable wrapper over git binary |
| Node.js built-in `URL` constructor | — | IMAP URL parsing | [VERIFIED: Node.js v24 docs] Safely parses `imap://user:pass@host:port` without regex; handles percent-encoding; available in Node v18+ |

### No New Dependencies Required
All Phase 5 restore logic uses already-installed libraries. No new packages to add.

### Installation
```bash
npm view imapflow version
npm view simple-git version
# Both already in package.json — no npm install needed
```

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CLI: restore command                           │
│  Parse --to URL, --skip-duplicates, --dry-run, [<date|commit>]      │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Core: restoreAccount()                           │
├──────────────────────────────────────────────────────────────────────┤
│  1. If <date|commit> specified:                                       │
│     └─ Call checkoutCommit() → get worktree path                      │
│  2. List all folders from folders/*.json                              │
│  3. For each folder:                                                  │
│     ├─ CREATE folder on target (if not exists)                        │
│     └─ For each message in folder:                                    │
│        ├─ If skip-duplicates=yes: SEARCH target for Message-ID        │
│        │  └─ If found: skip, count as skipped                         │
│        ├─ Read message from messages/<sanitized-id>.eml               │
│        └─ APPEND message to target folder                             │
│  4. Return RestoreResult { uploaded, skipped, errors }                │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    ImapFlow (target server)                           │
│  - LIST (to check folder existence)                                   │
│  - CREATE (for missing folders)                                       │
│  - SEARCH (duplicate checking when skip-duplicates=yes)               │
│  - APPEND (upload each message)                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. User provides target URL, optional date/commit, optional flags
2. CLI parses and calls `restoreAccount()`
3. Core resolves checkout path (or uses main repo HEAD)
4. Core reads folders/*.json to get folder list and message metadata
5. For each folder: CREATE on target, then APPEND each message (with optional SEARCH duplicate check)
6. Core returns counts; CLI formats and prints output

### Recommended Project Structure

```
src/
├── core/
│   ├── restore.ts        # New: restoreAccount() + helpers (parse URL, APPEND, SEARCH, CREATE logic)
│   ├── index.ts          # Re-export: restoreAccount(), RestoreOptions, RestoreResult types
│   ├── sync.ts           # Existing
│   ├── browse.ts         # Existing
│   └── config.ts         # Existing
├── cli/
│   └── index.ts          # Add restore [<date|commit>] subcommand
└── ...

tests/
├── unit/
│   └── restore.test.ts           # New: unit tests for URL parsing, duplicate logic, error cases
├── integration/
│   ├── restore-sync.test.ts      # New: restore from real checkout to minimal-imap server
│   └── cli-restore.test.ts       # New: CLI integration with --dry-run, --verbose, --skip-duplicates
```

### Pattern 1: IMAP URL Parsing and Connection

**What:** Parse `imap://user:pass@host:port` or `imaps://user:pass@host:port` safely, extract credentials and server details, create ImapFlow client.

**When to use:** Every restore command needs to connect to the target server.

**Example:**
```typescript
// Source: Node.js URL constructor docs + imapflow v1.3.2 pattern
function parseImapUrl(urlStr: string): {
  host: string
  port: number
  username: string
  password: string
  secure: boolean
} {
  const url = new URL(urlStr)
  
  // Validate protocol
  if (url.protocol !== 'imap:' && url.protocol !== 'imaps:') {
    throw new Error('URL must start with imap:// or imaps://')
  }
  
  // Extract credentials from userinfo
  if (!url.username || !url.password) {
    throw new Error('URL must include username:password')
  }
  
  // Determine secure flag and default port
  const secure = url.protocol === 'imaps:'
  const defaultPort = secure ? 993 : 143
  const port = url.port ? parseInt(url.port, 10) : defaultPort
  
  return {
    host: url.hostname ?? 'localhost',
    port,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    secure,
  }
}

// Create target connection (T-3-03: logger: false mandatory)
const target = parseImapUrl(targetUrl)
const targetClient = new ImapFlow({
  host: target.host,
  port: target.port,
  secure: target.secure,
  auth: { user: target.username, pass: target.password },
  logger: false,  // MANDATORY per Phase 3 T-3-03
})
```

**Key point:** URL constructor automatically handles percent-encoding (e.g., `user%40gmail.com` → `user@gmail.com`) and validates structure. Safer than regex-based parsing.

### Pattern 2: Duplicate Checking via SEARCH

**What:** Before APPENDing a message, optionally SEARCH the target folder for a message with the same Message-ID. Skip if found.

**When to use:** When `--skip-duplicates=yes` (default).

**Example:**
```typescript
// Source: imapflow v1.3.2 docs
async function isDuplicate(
  client: ImapFlow,
  folderPath: string,
  messageId: string
): Promise<boolean> {
  // SEARCH HEADER Message-ID <id>
  const lock = await client.getMailboxLock(folderPath)
  try {
    // Search for message with exact same Message-ID
    const results = await client.search({
      header: { 'message-id': messageId }
    })
    return results.length > 0
  } finally {
    await lock.release()
  }
}
```

**Note:** This operation requires a mailbox lock. ImapFlow's `getMailboxLock()` returns a lock object; all operations within the lock scope are atomic. Release after the operation.

### Pattern 3: Folder Creation and Structure Preservation

**What:** Before appending messages to a folder, ensure the folder exists on the target server. Use IMAP CREATE command if needed.

**When to use:** For each folder in folders/*.json before appending its first message.

**Example:**
```typescript
// Source: imapflow v1.3.2 docs
async function createFolderIfNeeded(
  client: ImapFlow,
  folderPath: string
): Promise<void> {
  try {
    // Try to create the folder
    // If it already exists, the server returns an error but doesn't fail the operation
    await client.mailboxCreate(folderPath)
  } catch (err) {
    // Folder already exists — safe to continue
    // But re-throw if it's a different error (permissions, etc.)
    const errMsg = (err as Error).message.toLowerCase()
    if (!errMsg.includes('already exists') && !errMsg.includes('name not allowed')) {
      throw err
    }
  }
}
```

**Key point:** IMAP CREATE is idempotent-ish — it succeeds if the folder exists. Always safe to call before APPEND.

### Pattern 4: Dry-Run Implementation

**What:** When `--dry-run` is set, suppress all writes (APPEND, CREATE, SEARCH) and no-op the target connection. Output the same format as live run.

**When to use:** Advisory mode; user wants to see what would be uploaded without risk.

**Example:**
```typescript
interface RestoreContext {
  client: ImapFlow | null  // null when dry-run=true
  dryRun: boolean
  skipDuplicates: boolean
}

async function restoreFolder(
  context: RestoreContext,
  folderPath: string,
  messages: Array<{ messageId: string; path: string }>
): Promise<RestoreResult> {
  let uploaded = 0, skipped = 0, errors = 0
  
  // Create folder (no-op in dry-run)
  if (!context.dryRun) {
    await createFolderIfNeeded(context.client!, folderPath)
  }
  
  for (const msg of messages) {
    try {
      // Check for duplicates (no-op in dry-run for simplicity per D-12)
      if (context.skipDuplicates && !context.dryRun) {
        if (await isDuplicate(context.client!, folderPath, msg.messageId)) {
          skipped++
          continue
        }
      }
      
      // Append message (no-op in dry-run)
      if (!context.dryRun) {
        const content = await fs.readFile(msg.path)
        await appendMessage(context.client!, folderPath, content)
      }
      
      uploaded++
    } catch (err) {
      errors++
    }
  }
  
  return { uploaded, skipped, errors }
}
```

**Note:** Dry-run skips both SEARCH and APPEND. This means dry-run counts may differ from a live run if duplicates exist on target (D-12 says "dry-run is advisory, not exact").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IMAP URL parsing with embedded credentials | Custom regex or string splits | Node.js `URL` constructor | Handles percent-encoding, edge cases (multiple colons in password), validates structure |
| IMAP folder creation and error handling | Try/catch with string matching | imapflow's `mailboxCreate()` + error inspection | Library abstracts IMAP protocol subtleties (NOSELECT flags, delimiters, character sets) |
| IMAP duplicate detection via Message-ID | Fetch all messages and compare | imapflow's `search({ header })` | Efficient server-side query; avoids transferring full message bodies |
| Message append with RFC822 format | Chunk reading + manual IMAP protocol | imapflow's `append()` | Library handles CRLF conversion, length calculation, flags, internal-date parsing per RFC3501 |
| Worktree path and checkout logic | New code in restore | Reuse Phase 4's `checkoutCommit()` | Already tested; handles date-vs-hash resolution, worktree cleanup, git error handling |

**Key insight:** ImapFlow handles IMAP protocol subtleties (CRLF line endings, continuation lines, IMAP literal format, error responses). Custom IMAP code is error-prone.

## Common Pitfalls

### Pitfall 1: Hardcoded Port Numbers Instead of Defaults

**What goes wrong:** Code assumes `--to imap://user:pass@host` should use port 143, but doesn't set a default. Result: connection fails with "Unknown port" error.

**Why it happens:** IMAP protocol has two standard ports (143 for plain, 993 for TLS), but not every URL includes a port. The library doesn't guess.

**How to avoid:** Always extract the port with a default: `url.port ? parseInt(url.port, 10) : (secure ? 993 : 143)`. Test with URLs missing the port.

**Warning signs:** Users report "can't connect to IMAP server" but server is reachable and credentials are correct. Port is missing from the URL.

### Pitfall 2: Not Releasing Mailbox Locks

**What goes wrong:** Code acquires a mailbox lock (for SEARCH or APPEND) but doesn't release it. All subsequent operations hang waiting for the lock.

**Why it happens:** ImapFlow locks are explicit; unlike some APIs, they don't auto-release. A `try/finally` is needed.

**How to avoid:** Always use `finally` to release the lock, even if the operation succeeds:
```typescript
const lock = await client.getMailboxLock(folderPath)
try {
  // SEARCH, APPEND, etc.
} finally {
  await lock.release()
}
```

**Warning signs:** Restore hangs mid-operation, or next restore attempt reports "mailbox is locked".

### Pitfall 3: Assuming Duplicate Check is an Exact Count

**What goes wrong:** With `--dry-run`, the code reports "would upload 100, skip 5", but when run live it uploads 5 and skips 100 (opposite). User expects dry-run to match.

**Why it happens:** Dry-run skips the SEARCH operation (D-12 says "for simplicity — dry-run is advisory, not exact"). Dry-run counts are inaccurate if the target already has messages.

**How to avoid:** Document that `--dry-run` is advisory and assumes an empty target. In code, add a comment that dry-run skips duplicate checks. Test dry-run against an empty target.

**Warning signs:** User compares dry-run output to live output and they don't match. This is expected; remind them dry-run is advisory.

### Pitfall 4: Password Embedded in Logs or Error Messages

**What goes wrong:** An error during connection includes the password-embedded URL in the error message. Password is now in logs.

**Why it happens:** Default error handling prints the full exception, which includes the URL parameter.

**How to avoid:** Always sanitize error messages in the CLI layer before printing:
```typescript
try {
  // restore operation
} catch (err) {
  // Print error, but never the full URL
  const msg = (err as Error).message
  console.error(`Restore failed: ${msg}`)
  // Not: console.error(`Restore failed at ${targetUrl}: ${msg}`)
}
```

**Warning signs:** `backmail restore --to imaps://user:pass@host` error includes `:pass@` in output.

### Pitfall 5: Assuming All Folders are Selectable

**What goes wrong:** Code tries to APPEND to a folder flagged with `\Noselect`. IMAP server rejects the operation.

**Why it happens:** The folder list includes structural folders (parent folders) marked `\Noselect`. These can't receive messages.

**How to avoid:** Filter folders before appending. Read the folder flags from folders/*.json (stored by Phase 3 sync). Skip folders with `\Noselect`.

**Warning signs:** Restore succeeds on some folders but fails on others (especially Gmail's `[Gmail]` folder).

### Pitfall 6: Message-ID Sanitization Mismatch

**What goes wrong:** Phase 3 wrote a message to `messages/abc_def.eml` (sanitized), but Phase 5 tries to read `messages/<abc@def>.eml` (unsanitized). File not found.

**Why it happens:** `sanitizeMessageId()` is applied when writing (Phase 3) but not when reading (Phase 5). Different function calls = different results.

**How to avoid:** Always apply `sanitizeMessageId()` before building the `messages/` path, even if the message ID looks safe. Reuse the function from Phase 3: `import { sanitizeMessageId } from './sync.js'`.

**Warning signs:** Restore reports "message not found" for messages that exist in the repo. Debug the filename.

## Code Examples

Verified patterns from official sources:

### Parsing and Validating IMAP URL

```typescript
// Source: Node.js v24 URL API, imapflow v1.3.2 constructor signature
function parseTargetUrl(urlStr: string): {
  host: string
  port: number
  username: string
  password: string
  secure: boolean
} {
  let url: URL
  try {
    url = new URL(urlStr)
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`)
  }

  // Validate protocol
  if (url.protocol !== 'imap:' && url.protocol !== 'imaps:') {
    throw new Error(`URL protocol must be imap:// or imaps://, got: ${url.protocol}`)
  }

  // Extract and validate credentials
  if (!url.username) {
    throw new Error('URL must include username (format: imap://user:pass@host)')
  }
  if (!url.password) {
    throw new Error('URL must include password (format: imap://user:pass@host)')
  }

  // Determine TLS and default port
  const secure = url.protocol === 'imaps:'
  const port = url.port ? parseInt(url.port, 10) : (secure ? 993 : 143)

  return {
    host: url.hostname ?? 'localhost',
    port,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    secure,
  }
}
```

### Checking for Duplicate Message-ID Before APPEND

```typescript
// Source: imapflow v1.3.2 API docs, ImapFlow search() pattern
async function checkDuplicate(
  client: ImapFlow,
  folderPath: string,
  messageId: string
): Promise<boolean> {
  const lock = await client.getMailboxLock(folderPath)
  try {
    const results = await client.search({
      header: { 'message-id': messageId }
    })
    return results.length > 0
  } finally {
    await lock.release()
  }
}
```

### Appending a Message to a Folder

```typescript
// Source: imapflow v1.3.2 API docs
async function appendMessage(
  client: ImapFlow,
  folderPath: string,
  messageContent: Buffer
): Promise<void> {
  const lock = await client.getMailboxLock(folderPath)
  try {
    await client.append(folderPath, messageContent, {
      flags: [], // No special flags; sync will restore original flags if needed (future)
    })
  } finally {
    await lock.release()
  }
}
```

### Creating a Folder If Missing

```typescript
// Source: imapflow v1.3.2 API docs, error handling pattern
async function ensureFolder(
  client: ImapFlow,
  folderPath: string
): Promise<void> {
  try {
    await client.mailboxCreate(folderPath)
  } catch (err) {
    // Folder might already exist — check error message
    const errMsg = (err as Error).message
    // Common "already exists" messages vary by server (Dovecot, Gmail, etc.)
    if (
      errMsg.includes('already exists') ||
      errMsg.includes('name not allowed') ||
      errMsg.includes('ALREADYEXISTS')
    ) {
      // Folder exists; safe to proceed
      return
    }
    // Different error (permissions, etc.) — re-throw
    throw err
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex-based URL parsing | Node.js `URL` constructor | Node.js v18+ | Safer, handles percent-encoding, no custom regex maintenance |
| Fetch all messages for dedup | SEARCH on server side | IMAP4rev1 standard | Efficient, avoids large data transfer |
| Manual IMAP protocol handling | imapflow library | Already chosen (Phase 3) | Correct CRLF, literal format, error handling |
| Detach HEAD for checkout | `git worktree` | Phase 4 | Non-destructive history browsing while syncing continues |

**Deprecated/outdated:**
- Manual IMAP socket manipulation: IMAP is complex (CRLF handling, continuation lines, literal format, capabilities negotiation). imapflow abstracts all of this.
- Regex for Message-ID extraction: `simpleParser` from mailparser handles RFC 2822 folded headers and edge cases.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ImapFlow v1.3.2 supports APPEND, SEARCH, CREATE operations | Standard Stack | Cannot implement restore; would need to verify version or upgrade |
| A2 | Node.js v24 URL constructor handles `imap://` and `imaps://` schemes | Standard Stack | URL parsing fails; would need fallback regex parser |
| A3 | Phase 4's `checkoutCommit()` can be called without modification from Phase 5 restore | Architecture Patterns | Restore would need custom worktree logic; reuse assumption fails |
| A4 | Message files stored in `messages/<sanitized>.eml` match Phase 3's sanitizeMessageId() output | Code Examples | File lookup fails; messages can't be found; would need Phase 3 audit |

**Validation plan:** All assumptions are based on verified code inspection and npm registry checks. No user confirmation needed before implementation.

## Open Questions

1. **ImapFlow SEARCH syntax for Message-ID**
   - What we know: imapflow v1.3.2 supports `search()` with a `header` option
   - What's unclear: Exact syntax for searching by Message-ID header value (e.g., should it include angle brackets or not?)
   - Recommendation: Check imapflow docs and test with minimal-imap server; Message-ID is typically stored without angle brackets in IMAP

2. **Folder creation error handling edge cases**
   - What we know: Some IMAP servers return specific errors if folder exists; others don't
   - What's unclear: Exact error strings for Dovecot (used in tests), Gmail, Outlook, etc.
   - Recommendation: Test with minimal-imap first; add error message matchers for common servers; if error includes "already exists" or "not allowed", assume folder exists and continue

3. **Connection reuse vs. reconnect per folder**
   - What we know: ImapFlow supports getting a new mailbox lock for each folder within one connection
   - What's unclear: Performance tradeoff — is a single connection across all folders faster, or should we reconnect per folder for isolation?
   - Recommendation: Use single connection per account (like sync does); test with 100+ folders to verify no lock contention

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All restore operations | ✓ | v24.11.1 | — |
| imapflow | IMAP operations (APPEND, SEARCH, CREATE) | ✓ | 1.3.2 | — |
| simple-git | Worktree and git operations | ✓ | 3.36.0 | — |
| minimal-imap Docker container | Integration tests | ✓ | Latest (from test script) | Use real IMAP server for manual testing |
| git (binary) | Worktree commands via simple-git | ✓ | v2.45+ (inferred from system) | — |

**Missing dependencies with no fallback:**
- None — all required tools are already installed or available via docker-compose

**Missing dependencies with fallback:**
- None — no optional dependencies

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 (already installed) |
| Config file | `vitest.config.ts` (if exists) or implicit (uses defaults) |
| Quick run command | `npm test` (runs all unit + integration tests) |
| Full suite command | `npm run test:integration` (starts Docker, runs integration tests, tears down) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REST-01 | Restore appends messages from local checkout to target IMAP server | integration | `npm run test:integration -- restore` | ❌ Wave 0 |
| REST-02 | With `--skip-duplicates=yes`, existing messages (by Message-ID) are skipped | unit + integration | `npm test -- restore.test.ts` | ❌ Wave 0 |
| REST-03 | `--dry-run` outputs without connecting to target for writes | unit | `npm test -- restore.test.ts` | ❌ Wave 0 |
| REST-04 | Missing folders are created on target before message append | integration | `npm run test:integration -- restore` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test` (runs all tests; quick unit tests < 5 seconds)
- **Per wave merge:** `npm run test:integration` (full suite with Docker; ~30-60 seconds)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/restore.test.ts` — unit tests for URL parsing, duplicate logic, error cases (covered in 05-02-PLAN)
- [ ] `tests/integration/restore-sync.test.ts` — integration tests uploading to minimal-imap server (covered in 05-03-PLAN)
- [ ] `tests/integration/cli-restore.test.ts` — CLI integration with --dry-run, --verbose, --skip-duplicates (covered in 05-03-PLAN)
- [ ] Framework config: vitest already configured in `vitest.config.ts` from Phase 1

*(No gaps — existing test infrastructure covers all phase requirements; Phase 5 adds new test files for restore-specific behavior)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | URL-embedded credentials only (app passwords for Gmail); no keystroke logging in Phase 5; credentials not logged per Pitfall 4 |
| V3 Session Management | yes | ImapFlow connection (single session per restore run); logout always called in finally block |
| V4 Access Control | yes | IMAP server enforces access control; restore respects mailbox permissions (CREATE, APPEND will fail if user lacks permissions) |
| V5 Input Validation | yes | URL parsing via Node.js `URL` constructor (safe); message content from local .eml files (signed by git; no external input) |
| V6 Cryptography | yes | TLS/SSL for `imaps://` connections; ImapFlow enforces TLS handshake per protocol |

### Known Threat Patterns for IMAP + restore context

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Password in error logs | Information Disclosure | Sanitize error messages; never print full URL (Pitfall 4) |
| MITM attack during restore | Tampering | Use `imaps://` (TLS required); ImapFlow validates certificates by default |
| Credential exposure via process arguments | Information Disclosure | Credentials in URL are visible to `ps` (any process can read). Mitigated by: (1) one-shot use case (not persistent service), (2) developer-only tool, (3) document to use environment variables if needed (future) |
| Unauthorized folder creation | Elevation of Privilege | IMAP server enforces ACLs; CREATE will fail if user lacks write permissions on target mailbox |
| Duplicate check bypass (skip-duplicates=no) | Integrity | Documented behavior (D-11); user chooses to trust the backup is clean; not a security vulnerability |

## Sources

### Primary (HIGH confidence)
- [npm imapflow v1.3.2](https://www.npmjs.com/package/imapflow) — APPEND, SEARCH, CREATE, mailboxCreate API
- [npm simple-git v3.36.0](https://www.npmjs.com/package/simple-git) — worktree and git log operations
- [Node.js v24 URL API](https://nodejs.org/api/url.html) — `URL` constructor for parsing `imap://` and `imaps://` schemes
- Code inspection: `/home/jan/dev/backmail/src/core/sync.ts` — ImapFlow pattern, sanitizeMessageId(), folderPathToFilename()
- Code inspection: `/home/jan/dev/backmail/src/core/browse.ts` — checkoutCommit(), folder JSON schema, uidvalidity handling
- Context: `05-CONTEXT.md` — locked decisions D-01 through D-19, deferred ideas, code context

### Secondary (MEDIUM confidence)
- RFC 3501 IMAP4rev1 — APPEND, SEARCH, CREATE semantics (referenced by ImapFlow implementation)
- IMAP protocol standards — port 143 (plain), 993 (TLS); default behaviors

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — imapflow and simple-git already verified and in use; Node.js URL API is standard library
- Architecture: HIGH — restore is inverse of sync; patterns are established in Phase 3/4 codebase
- Pitfalls: HIGH — derived from IMAP protocol and ImapFlow library specifics
- Security: HIGH — ASVS mapping based on IMAP standard; credential handling documented in decisions

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (30 days; stable dependencies, no active CVEs expected)
**Confidence level:** HIGH — Phase 5 is a straightforward application of existing libraries to a clear use case (inverse of sync).
