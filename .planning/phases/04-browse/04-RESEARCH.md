# Phase 4: Browse — Research

**Written:** 2026-04-22
**Status:** Complete

## Summary

Phase 4 adds five read-only CLI commands that browse a synced mail archive. The key technical questions are: (1) which MIME library to use for .eml parsing, (2) how to call git worktree operations via simple-git, (3) how to query git log efficiently, and (4) how to defensively handle the CR-01 BigInt issue in sync.ts.

---

## 1. MIME Parsing Library

### Options evaluated

| Library | ESM | TS types | API |
|---------|-----|---------|-----|
| `mailparser` (nodemailer) | CJS, Node ESM interop works | `@types/mailparser` | `simpleParser(source)` → `ParsedMail` |
| `postal-mime` | ESM native | built-in | `new PostalMime().parse(source)` → `Email` |

### Recommendation: `mailparser`

**Why:** `mailparser` is the most battle-tested RFC822 parser in the Node ecosystem. It handles encoding, charsets, MIME multipart, and inline attachments. The `simpleParser()` API returns:

```typescript
import { simpleParser } from 'mailparser'

const parsed = await simpleParser(emlBuffer)
// parsed.text       — decoded text/plain body (undefined if absent)
// parsed.html       — decoded text/html body (undefined if absent)
// parsed.subject    — string
// parsed.from       — AddressObject with .text
// parsed.date       — Date object
// parsed.headers    — Map<string, HeaderValue> — use headers.get('x-custom')
// parsed.attachments — array
```

**JSON format mapping** (from D-18, `{headers, parts[]}`):

```typescript
// headers: Record<string, string>
const headers: Record<string, string> = {}
for (const [key, val] of parsed.headers) {
  headers[key] = typeof val === 'string' ? val : JSON.stringify(val)
}

// parts: Array<{type, content}>
const parts: {type: string; content: string}[] = []
if (parsed.text !== undefined) parts.push({type: 'text/plain', content: parsed.text})
if (parsed.html !== undefined) parts.push({type: 'text/html', content: parsed.html})
for (const att of parsed.attachments ?? []) {
  parts.push({type: att.contentType, content: att.content.toString('base64')})
}
```

**Install:** `npm install mailparser && npm install -D @types/mailparser`

### Fast header extraction for `ls` (without full MIME parse)

When listing messages (`backmail ls <folder>`), we only need From/Date/Subject. Parsing the full MIME body for thousands of messages is wasteful. RFC822 headers end at the first blank line (`\n\n` or `\r\n\r\n`). Read only the header section:

```typescript
import fs from 'node:fs/promises'

async function readEmlHeaders(emlPath: string): Promise<Record<string, string>> {
  // Read enough bytes for headers (4KB covers all realistic header sections)
  const fd = await fs.open(emlPath, 'r')
  const buf = Buffer.alloc(4096)
  const { bytesRead } = await fd.read(buf, 0, 4096, 0)
  await fd.close()
  const raw = buf.subarray(0, bytesRead).toString('utf-8')
  
  // Split at first blank line
  const headerSection = raw.split(/\r?\n\r?\n/)[0] ?? raw
  
  // Parse folded headers (RFC 2822 — continuation lines start with whitespace)
  const headers: Record<string, string> = {}
  const unfolded = headerSection.replace(/\r?\n([ \t])/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      const key = line.slice(0, colon).toLowerCase().trim()
      const val = line.slice(colon + 1).trim()
      if (!(key in headers)) headers[key] = val  // keep first occurrence
    }
  }
  return headers
}
```

This reads ≤4KB per file instead of the full body — critical for listing thousands of messages.

---

## 2. simple-git Worktree Operations

simple-git 3.x (installed: 3.36.0) does **not** have a typed worktree API. Use `git.raw()` for all worktree operations:

```typescript
import { simpleGit } from 'simple-git'

const git = simpleGit(repoPath)

// Create worktree (git worktree add <path> <commit-ish>)
await git.raw(['worktree', 'add', worktreePath, commitRef])

// Remove worktree (--force allows removal even with dirty state)
await git.raw(['worktree', 'remove', '--force', worktreePath])

// List worktrees (machine-readable)
const output = await git.raw(['worktree', 'list', '--porcelain'])
// Parse output: each worktree block has "worktree <path>", "HEAD <sha>", "branch <ref>" lines

// Add .worktrees/ to .gitignore (if not already present)
// Read .gitignore, append if missing, write back
```

**Overwrite flow (D-07):**
```typescript
async function createWorktree(git: SimpleGit, worktreePath: string, commitRef: string) {
  // Remove existing worktree if present
  try {
    await git.raw(['worktree', 'remove', '--force', worktreePath])
  } catch {
    // Worktree didn't exist — ignore
  }
  // Also remove the directory if git worktree remove didn't clean it
  await fs.rm(worktreePath, { recursive: true, force: true })
  // Create new worktree
  await git.raw(['worktree', 'add', worktreePath, commitRef])
}
```

**Worktree path convention (D-06, D-10):**
- Date input `2026-04-22` → `<repoPath>/.worktrees/2026-04-22`
- Hash input `abc1234f` → `<repoPath>/.worktrees/abc1234` (first 7 chars)

**.gitignore management:**
```typescript
import path from 'node:path'
import fs from 'node:fs/promises'

async function ensureWorktreesIgnored(repoPath: string) {
  const gitignorePath = path.join(repoPath, '.gitignore')
  let content = ''
  try { content = await fs.readFile(gitignorePath, 'utf-8') } catch {}
  if (!content.includes('.worktrees/')) {
    await fs.appendFile(gitignorePath, content.endsWith('\n') ? '.worktrees/\n' : '\n.worktrees/\n')
  }
}
```

---

## 3. simple-git Log for `backmail log`

```typescript
import { simpleGit } from 'simple-git'
import type { LogResult } from 'simple-git'

const git = simpleGit(repoPath)

// Get last N commits (newest first by default)
const log = await git.log({ maxCount: 20 })
// log.all — array of DefaultLogFields objects:
// { hash, date, message, author_name, author_email, refs }

// For unlimited:
const log = await git.log({})

// Filter to sync commits only (message matches our format)
const syncCommits = log.all.filter(c =>
  /^\d{4}-\d{2}-\d{2}(\s\[partial\])?:\s+\+\d+\s+added\s+\/\s+-\d+\s+removed$/.test(c.message)
)
```

**Output format (D-04):** The commit message IS the display string — output verbatim from `c.message`.

**`--limit unlimited`:** Pass `maxCount: 0` or omit `maxCount` to get all commits. simple-git's `maxCount: 0` maps to `--max-count=0` which returns nothing — instead omit the option entirely for unlimited.

```typescript
// In core:
export async function getLog(repoPath: string, limit: number | 'unlimited'): Promise<string[]> {
  const git = simpleGit(repoPath)
  const opts = limit === 'unlimited' ? {} : { maxCount: limit }
  const log = await git.log(opts)
  return log.all
    .filter(c => /^\d{4}-\d{2}-\d{2}/.test(c.message))  // sync commits only
    .map(c => c.message)
}
```

---

## 4. Date-to-Commit Resolution for `backmail checkout`

**Detection:** Whether `<date|commit>` is a date or a commit ref:
```typescript
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isDate = DATE_RE.test(arg)
```

**Finding last commit on a date:**
```typescript
async function resolveDate(git: SimpleGit, dateStr: string): Promise<string> {
  // Get commits on this date: use --after day-before and --before day-after
  // "--until" is inclusive in git; "--after" is exclusive — use the day itself as the boundary
  const log = await git.log({
    '--after': `${dateStr} 00:00:00`,
    '--before': `${dateStr} 23:59:59`,
    '--max-count': '1',  // newest first, so first result = last commit of the day
  })
  if (log.total === 0) {
    throw new Error(`No sync commit found for date ${dateStr}`)
  }
  return log.latest!.hash
}
```

**Alternative (simpler):** Use `git log --format=%H --after="YYYY-MM-DD 00:00:00" --until="YYYY-MM-DD 23:59:59" --max-count=1`. Note git's `--until` (alias `--before`) is exclusive, but combined with `23:59:59` it captures the full day.

**Short hash for output (D-09):** `hash.slice(0, 7)`.

---

## 5. CR-01: BigInt Fix in sync.ts

**Location:** `src/core/sync.ts` lines 286-289:
```typescript
try {
  storedValidity = BigInt(storedState.uidvalidity)
} catch {
  // Corrupted state file...
```

**Risk:** If `uidvalidity` is `""`, `null`, or any non-numeric string, `BigInt()` throws. The catch block handles it but the pattern is fragile and flagged by the code reviewer.

**Fix:** The server's `uidValidity` from imapflow is a `bigint` (line 281: `client.mailbox.uidValidity ?? 0n`). The stored value is a `string` (written as `serverValidity.toString()`). Comparison just needs string equality — no BigInt conversion required for browse code.

**For sync.ts fix:** Replace BigInt() conversion with string comparison:
```typescript
// Before (unsafe):
storedValidity = BigInt(storedState.uidvalidity)
// ... later:
if (storedState && storedValidity !== null && storedValidity !== serverValidity) {

// After (safe):
const storedValidityStr = storedState.uidvalidity
const serverValidityStr = serverValidity.toString()
if (storedState && storedValidityStr !== serverValidityStr) {
  // ... re-sync
}
```

This eliminates the BigInt() call entirely. `uidvalidity` stored as string, compared as string — no precision loss, no parse error.

**Browse code:** Never construct BigInt from folder JSON. Just read `uidvalidity` as a string for any display purposes (or ignore it entirely in browse commands, which don't need it).

---

## 6. Folder JSON Parsing for `backmail ls`

The folder JSON schema (written by sync):
```typescript
interface FolderState {
  uidvalidity: string     // stored as toString() of bigint
  uidnext: number
  messages: Array<{
    uid: number
    'message-id': string  // raw message-id (NOT sanitized)
    flags: string[]
  }>
}
```

**ls <folder> flow:**
1. Map folder name to filename via `folderPathToFilename()` (reuse from sync.ts)
2. Read `folders/<filename>.json`
3. For each message in `state.messages`, construct EML path: `messages/${sanitizeMessageId(msg['message-id'])}.eml`
4. Read EML headers using fast header extraction (section 1 above)
5. Output columns: message-id | date | from | subject

**ls (no folder) flow:**
1. Read all files in `folders/` directory
2. Strip `.json` extension from filename
3. Output one line per folder

---

## 7. Account Resolution Helper

All browse commands share the same `--account` resolution logic (D-01, D-02):

```typescript
// In src/core/browse.ts or src/core/accounts.ts
import type { BackmailConfig, AccountConfig } from './config.js'

export function resolveAccount(config: BackmailConfig, accountName?: string): [string, AccountConfig] {
  if (accountName) {
    const acc = config.accounts[accountName]
    if (!acc) throw new Error(`Unknown account: ${accountName}`)
    return [accountName, acc]
  }
  const names = Object.keys(config.accounts)
  if (names.length === 1) return [names[0], config.accounts[names[0]]]
  throw new Error(
    `Multiple accounts configured. Specify one with --account:\n  ${names.join('\n  ')}`
  )
}
```

This lives in core (no console.*), CLI catches the error and prints to stderr.

---

## 8. Module Structure Recommendation

Based on the established patterns (ARCH-01, ARCH-02):

```
src/core/
  browse.ts      — all browse functions: getLog(), checkoutCommit(), listFolders(),
                   listMessages(), viewMessage(), resolveAccount()
  sync.ts        — existing (CR-01 fix applied here)
  index.ts       — re-export browse functions alongside existing exports

src/cli/index.ts — add accounts, log, checkout, ls, view subcommands (thin wrappers)
```

One file `src/core/browse.ts` is cleaner than splitting into 4 files for 5 small functions.

---

## 9. Dependencies to Add

```bash
npm install mailparser
npm install -D @types/mailparser
```

No other new dependencies needed. simple-git is already installed (3.36.0).

---

## RESEARCH COMPLETE

Key findings:
- Use `mailparser` for .eml parsing — `simpleParser()` handles all MIME complexities
- Use fast 4KB header read for `ls` to avoid full-body parsing per message
- simple-git has no typed worktree API — use `git.raw(['worktree', ...])` for all worktree ops
- CR-01 fix: replace `BigInt(storedState.uidvalidity)` with string comparison — eliminates the unsafe conversion entirely
- All browse logic in `src/core/browse.ts`, one `resolveAccount()` helper shared by all commands
